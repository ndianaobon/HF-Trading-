// Production setup: loads the market catalogue (assets, networks, markets,
// default trading fees) and creates the first Super Admin. Safe to re-run: it
// only adds what is missing and never creates demo data.
//
//   npm run setup:prod                       (prompts for the admin email and password)
//   ADMIN_EMAIL=you@domain.com ADMIN_COUNTRY=NG npm run setup:prod
import { PrismaClient, Prisma } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
import { ASSETS, NETWORKS } from "../prisma/catalog.js";

const prisma = new PrismaClient();
const D = (v) => new Prisma.Decimal(v);
// Same Argon2id parameters as lib/auth/password.js.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : "*");
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), hidden && process.stdout.write("\n"), resolve(a.trim()))));
}

async function catalogue() {
  const assetIds = {};
  let added = { assets: 0, networks: 0, markets: 0 };
  for (const [i, a] of ASSETS.entries()) {
    const existing = await prisma.asset.findUnique({ where: { symbol: a.symbol } });
    const row =
      existing ??
      (await prisma.asset.create({
        data: {
          symbol: a.symbol,
          name: a.name,
          type: a.type,
          categories: a.categories,
          color: a.color,
          decimals: a.type === "STABLECOIN" ? 6 : 8,
          sortOrder: i,
          depositEnabled: NETWORKS.some((n) => n.asset === a.symbol),
          withdrawEnabled: NETWORKS.some((n) => n.asset === a.symbol),
        },
      }));
    if (!existing) added.assets++;
    assetIds[a.symbol] = row.id;
  }
  for (const n of NETWORKS) {
    const exists = await prisma.network.findFirst({ where: { assetId: assetIds[n.asset], code: n.code } });
    if (exists) continue;
    await prisma.network.create({
      data: {
        assetId: assetIds[n.asset],
        code: n.code,
        name: n.name,
        minDeposit: D(n.minDeposit),
        minWithdrawal: D(n.minWithdrawal),
        withdrawalFee: D(n.withdrawalFee),
        confirmations: n.confirmations,
        addressPattern: n.addressPattern,
        memoRequired: n.memoRequired ?? false,
      },
    });
    added.networks++;
  }
  for (const [i, a] of ASSETS.entries()) {
    if (a.symbol === "USDT") continue;
    const symbol = `${a.symbol}-USDT`;
    if (await prisma.market.findUnique({ where: { symbol } })) continue;
    await prisma.market.create({
      data: {
        symbol,
        providerSymbol: `${a.symbol}USDT`,
        baseAssetId: assetIds[a.symbol],
        quoteAssetId: assetIds.USDT,
        pricePrecision: a.pricePrecision,
        quantityPrecision: a.quantityPrecision,
        minQuantity: D(10 ** -a.quantityPrecision),
        minNotional: D(5),
        categories: ["SPOT", ...a.categories],
        isFeatured: !!a.featured,
        sortOrder: i,
      },
    });
    added.markets++;
  }
  if (!(await prisma.feeConfiguration.count())) {
    await prisma.feeConfiguration.createMany({
      data: [
        { type: "TRADING_MAKER", rate: D("0.001"), note: "Default maker fee 0.10%" },
        { type: "TRADING_TAKER", rate: D("0.001"), note: "Default taker fee 0.10%" },
      ],
    });
    console.log("  · default trading fees 0.10% maker / taker");
  }
  console.log(`  · catalogue: ${added.assets} assets, ${added.networks} networks, ${added.markets} markets added (existing ones kept)`);
}

async function superAdmin() {
  const email = (process.env.ADMIN_EMAIL || (await ask("Super admin email: "))).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error("That is not a valid email address.");
  const existing = await prisma.user.findUnique({ where: { email }, include: { adminUser: true } });
  if (existing?.adminUser?.role === "SUPER_ADMIN" && existing.adminUser.isActive) {
    console.log(`  · ${email} is already a super admin`);
    return;
  }
  let passwordHash = existing?.passwordHash;
  if (!existing) {
    const pw = process.env.ADMIN_PASSWORD || (await ask("Password (min 12 chars, upper, lower, number, symbol): ", { hidden: true }));
    if (pw.length < 12 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) throw new Error("Password too weak.");
    passwordHash = await hash(pw, ARGON);
  }
  const country = existing ? null : (process.env.ADMIN_COUNTRY || (await ask("Country (2-letter code, e.g. NG): "))).toUpperCase();
  if (country !== null && !/^[A-Z]{2}$/.test(country)) throw new Error("Use a 2-letter country code, e.g. NG.");
  const code = "HF" + Array.from(randomBytes(6), (b) => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 32]).join("");
  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      referralCode: code,
      profile: { create: { firstName: "Platform", lastName: "Admin", country } },
      adminUser: { create: { role: "SUPER_ADMIN" } },
      portfolio: { create: {} },
    },
    update: {
      role: "ADMIN",
      status: "ACTIVE",
      adminUser: { upsert: { create: { role: "SUPER_ADMIN" }, update: { role: "SUPER_ADMIN", isActive: true } } },
    },
  });
  await prisma.auditLog.create({ data: { actorEmail: "setup-production", action: "admin.bootstrap", targetType: "User", metadata: { email } } });
  console.log(`  · ${email} is now a super admin. Sign in, then set up two-factor authentication (required for the admin console).`);
}

async function demoAccounts() {
  const demo = await prisma.user.findMany({ where: { OR: [{ isDemo: true }, { email: { endsWith: ".test" } }] }, select: { email: true } });
  if (demo.length) {
    console.warn(`\n  ! This database contains ${demo.length} demo/test account(s) (e.g. ${demo[0].email}) with publicly known passwords.`);
    console.warn("    Suspend or delete them in Admin → Users before going live, or start from an empty database.\n");
  }
}

try {
  console.log("HarborFinance production setup");
  await catalogue();
  await superAdmin();
  await demoAccounts();
  console.log("Done.");
} catch (err) {
  console.error(`Setup failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
