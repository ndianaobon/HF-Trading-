/**
 * DEVELOPMENT SEED DATA — HarborFinance Trading
 *
 * Everything created here is demo/development data: users are flagged
 * isDemo, and every order, trade, deposit, withdrawal, transaction and
 * snapshot is flagged isDemo=true. Copy-trader statistics are illustrative
 * and labelled "Demo statistics" in the UI. Refuses to run in production.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ASSETS, NETWORKS } from "./catalog.js";

if (process.env.NODE_ENV === "production" || process.env.APP_MODE === "live") {
  console.error("Refusing to seed demo data in production / live mode.");
  process.exit(1);
}

const prisma = new PrismaClient();
const D = (v) => new Prisma.Decimal(v);
const DAY = 86_400_000;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

const PASSWORDS = {
  demo: "DemoTrader!2026",
  admin: "AdminHarbor!2026",
  staff: "StaffHarbor!2026",
  user: "UserHarbor!2026",
};

function ref(prefix) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `${prefix}-${Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("")}`;
}

function referralCode() {
  return "HF" + Array.from(randomBytes(6), (b) => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 32]).join("");
}

// Deterministic PRNG so demo charts are stable between seeds.
let seedState = 42;
function rand() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}

async function fetchPrices() {
  const fallback = { BTC: 84000, ETH: 2700, SOL: 150, BNB: 600, XRP: 2.3, ADA: 0.7, DOGE: 0.2, USDC: 1 };
  try {
    const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "USDCUSDT"];
    const res = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const rows = await res.json();
    const out = { ...fallback };
    for (const r of rows) out[r.symbol.replace("USDT", "")] = Number(r.price);
    console.log("  · reference prices loaded from Binance (used only to make demo cost bases plausible)");
    return out;
  } catch {
    console.log("  · market data unreachable; using static reference prices for demo cost bases");
    return fallback;
  }
}

const DEMO_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 74>>stream
BT /F1 14 Tf 30 100 Td (HarborFinance DEMO DOCUMENT - development seed data) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

function writeDemoDoc(key) {
  const full = path.resolve(process.cwd(), "storage", key);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, DEMO_PDF);
}

async function wipe() {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

/** Tracks balances while generating ledger events so wallets always reconcile. */
class Ledger {
  bal = new Map();
  get(sym) {
    if (!this.bal.has(sym)) this.bal.set(sym, { available: D(0), locked: D(0) });
    return this.bal.get(sym);
  }
  credit(sym, amt) {
    this.get(sym).available = this.get(sym).available.plus(amt);
  }
  debit(sym, amt) {
    const b = this.get(sym);
    if (b.available.lt(amt)) throw new Error(`Seed ledger would overdraw ${sym}`);
    b.available = b.available.minus(amt);
  }
  lock(sym, amt) {
    this.debit(sym, amt);
    this.get(sym).locked = this.get(sym).locked.plus(amt);
  }
}

async function main() {
  console.log("Seeding HarborFinance development data …");
  await wipe();
  const prices = await fetchPrices();

  // ── Assets, networks, markets ───────────────────────────────
  const assetIds = {};
  for (const [i, a] of ASSETS.entries()) {
    const row = await prisma.asset.create({
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
    });
    assetIds[a.symbol] = row.id;
  }
  const networkIds = {};
  for (const n of NETWORKS) {
    const row = await prisma.network.create({
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
    networkIds[`${n.asset}:${n.code}`] = row.id;
  }
  const marketIds = {};
  for (const [i, a] of ASSETS.entries()) {
    if (a.symbol === "USDT") continue;
    const m = await prisma.market.create({
      data: {
        symbol: `${a.symbol}-USDT`,
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
    marketIds[a.symbol] = m.id;
  }
  console.log(`  · ${ASSETS.length} assets, ${NETWORKS.length} networks, ${Object.keys(marketIds).length} markets`);

  await prisma.feeConfiguration.createMany({
    data: [
      { type: "TRADING_MAKER", rate: D("0.001"), note: "Default maker fee 0.10%" },
      { type: "TRADING_TAKER", rate: D("0.001"), note: "Default taker fee 0.10%" },
    ],
  });

  // ── Staff accounts ─────────────────────────────────────────
  const staffHash = await hash(PASSWORDS.staff);
  const adminHash = await hash(PASSWORDS.admin);
  async function staff(email, first, last, role, pw) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: pw,
        role: "ADMIN",
        status: "ACTIVE",
        emailVerifiedAt: ago(120),
        referralCode: referralCode(),
        isDemo: true,
        createdAt: ago(120),
        profile: { create: { firstName: first, lastName: last, country: "GB" } },
        adminUser: { create: { role } },
        portfolio: { create: {} },
      },
    });
  }
  const admin = await staff("admin@harborfinance.test", "Platform", "Admin", "SUPER_ADMIN", adminHash);
  await staff("compliance@harborfinance.test", "Compliance", "Officer", "COMPLIANCE", staffHash);
  await staff("finance@harborfinance.test", "Finance", "Operations", "FINANCE", staffHash);
  const supportAgent = await staff("support@harborfinance.test", "Support", "Agent", "SUPPORT", staffHash);

  // ── Demo trader account ────────────────────────────────────
  const demo = await prisma.user.create({
    data: {
      email: "demo@harborfinance.test",
      passwordHash: await hash(PASSWORDS.demo),
      status: "ACTIVE",
      emailVerifiedAt: ago(90),
      referralCode: "HFDEMO01",
      isDemo: true,
      createdAt: ago(90),
      lastLoginAt: ago(1),
      profile: {
        create: {
          firstName: "Jordan",
          lastName: "Demo",
          phone: "+44 20 0000 0000",
          country: "GB",
          city: "London",
          preferences: { currency: "USDT", defaultMarket: "BTC-USDT", favorites: ["BTC-USDT", "ETH-USDT", "SOL-USDT"] },
        },
      },
      portfolio: { create: {} },
    },
  });
  await prisma.kycApplication.create({
    data: {
      userId: demo.id,
      status: "APPROVED",
      fullName: "Jordan Demo",
      dateOfBirth: new Date("1990-04-12"),
      country: "GB",
      addressLine: "1 Example Street",
      city: "London",
      postalCode: "EX1 1MP",
      idType: "PASSPORT",
      submittedAt: ago(88),
      reviewedAt: ago(87),
      reviewedById: admin.id,
    },
  });
  for (const s of ["BTC", "ETH", "SOL"]) await prisma.favoriteMarket.create({ data: { userId: demo.id, marketId: marketIds[s] } });

  const L = new Ledger();
  const PREFIX = {
    DEPOSIT: "DEP",
    WITHDRAWAL: "WDR",
    TRADE: "TRD",
    TRANSFER: "TRF",
    INVESTMENT: "INV",
    COPY_TRADING: "CPY",
    REFERRAL: "REF",
    FEE: "FEE",
    ADJUSTMENT: "ADJ",
  };
  const tx = async (data) => prisma.transaction.create({ data: { ...data, reference: ref(PREFIX[data.type]), isDemo: true } });

  // Deposits (simulated, completed)
  async function deposit(userId, L, asset, network, amount, when) {
    const net = NETWORKS.find((n) => n.asset === asset && n.code === network);
    const d = await prisma.deposit.create({
      data: {
        userId,
        assetId: assetIds[asset],
        networkId: networkIds[`${asset}:${network}`],
        amount: D(amount),
        status: "COMPLETED",
        confirmations: Math.min(net.confirmations, 12),
        requiredConfirmations: Math.min(net.confirmations, 12),
        provider: "demo-simulator",
        isDemo: true,
        creditedAt: when,
        createdAt: when,
      },
    });
    await tx({
      userId,
      type: "DEPOSIT",
      direction: "CREDIT",
      status: "COMPLETED",
      assetId: assetIds[asset],
      amount: D(amount),
      depositId: d.id,
      description: `Simulated ${asset} deposit (demo)`,
      createdAt: when,
    });
    L.credit(asset, D(amount));
  }
  await deposit(demo.id, L, "USDT", "TRC20", 30000, ago(85));
  await deposit(demo.id, L, "BTC", "BTC", 0.25, ago(60));
  await deposit(demo.id, L, "ETH", "ERC20", 3, ago(45));
  await deposit(demo.id, L, "USDC", "ERC20", 5000, ago(30));

  const positions = new Map();
  const pos = (s) => positions.get(s) ?? positions.set(s, { qty: D(0), cost: D(0), realized: D(0) }).get(s);
  pos("BTC").qty = D(0.25);
  pos("BTC").cost = D(0.25 * prices.BTC * 0.86);
  pos("ETH").qty = D(3);
  pos("ETH").cost = D(3 * prices.ETH * 0.93);

  // Filled orders with trades
  async function filledOrder(userId, L, asset, side, qty, price, when, type = "MARKET") {
    const q = D(qty);
    const p = D(price.toFixed(ASSETS.find((a) => a.symbol === asset).pricePrecision));
    const cost = q.mul(p).toDecimalPlaces(8);
    const fee = cost.mul("0.001").toDecimalPlaces(8);
    const order = await prisma.order.create({
      data: {
        userId,
        marketId: marketIds[asset],
        side,
        type,
        status: "FILLED",
        price: type === "LIMIT" ? p : null,
        quantity: q,
        filledQuantity: q,
        avgFillPrice: p,
        feeTotal: fee,
        isDemo: true,
        createdAt: when,
        updatedAt: when,
        closedAt: when,
        events: {
          create: [
            { status: "CREATED", createdAt: when },
            { status: "VALIDATED", createdAt: when },
            { status: "ACCEPTED", createdAt: when },
            { status: "FILLED", note: `Filled ${q} @ ${p}`, createdAt: when },
          ],
        },
      },
    });
    await prisma.trade.create({
      data: {
        orderId: order.id,
        userId,
        marketId: marketIds[asset],
        side,
        price: p,
        quantity: q,
        quoteQuantity: cost,
        fee,
        feeAsset: "USDT",
        isMaker: type === "LIMIT",
        isDemo: true,
        createdAt: when,
      },
    });
    const meta = { orderId: order.id, market: `${asset}-USDT`, price: p.toString(), quantity: q.toString() };
    if (side === "BUY") {
      L.debit("USDT", cost.plus(fee));
      L.credit(asset, q);
      await tx({
        userId,
        type: "TRADE",
        direction: "DEBIT",
        assetId: assetIds.USDT,
        amount: cost,
        fee,
        orderId: order.id,
        description: `Buy ${q} ${asset}`,
        metadata: meta,
        createdAt: when,
      });
      await tx({
        userId,
        type: "TRADE",
        direction: "CREDIT",
        assetId: assetIds[asset],
        amount: q,
        orderId: order.id,
        description: `Buy ${q} ${asset}`,
        metadata: meta,
        createdAt: when,
      });
      const ps = pos(asset);
      ps.qty = ps.qty.plus(q);
      ps.cost = ps.cost.plus(cost).plus(fee);
    } else {
      L.debit(asset, q);
      L.credit("USDT", cost.minus(fee));
      await tx({
        userId,
        type: "TRADE",
        direction: "DEBIT",
        assetId: assetIds[asset],
        amount: q,
        orderId: order.id,
        description: `Sell ${q} ${asset}`,
        metadata: meta,
        createdAt: when,
      });
      await tx({
        userId,
        type: "TRADE",
        direction: "CREDIT",
        assetId: assetIds.USDT,
        amount: cost.minus(fee),
        fee,
        orderId: order.id,
        description: `Sell ${q} ${asset}`,
        metadata: meta,
        createdAt: when,
      });
      const ps = pos(asset);
      const avg = ps.qty.gt(0) ? ps.cost.div(ps.qty) : D(0);
      ps.realized = ps.realized.plus(cost.minus(fee).minus(q.mul(avg)));
      ps.cost = ps.cost.minus(q.mul(avg));
      ps.qty = ps.qty.minus(q);
    }
    return order;
  }
  await filledOrder(demo.id, L, "BTC", "BUY", 0.1, prices.BTC * 0.9, ago(70));
  await filledOrder(demo.id, L, "SOL", "BUY", 40, prices.SOL * 1.04, ago(52), "LIMIT");
  await filledOrder(demo.id, L, "BNB", "BUY", 6, prices.BNB * 0.95, ago(40));
  await filledOrder(demo.id, L, "XRP", "BUY", 2500, prices.XRP * 0.8, ago(33), "LIMIT");
  await filledOrder(demo.id, L, "ETH", "SELL", 0.5, prices.ETH * 1.02, ago(20));
  await filledOrder(demo.id, L, "SOL", "SELL", 10, prices.SOL * 0.97, ago(9));
  await filledOrder(demo.id, L, "DOGE", "BUY", 5000, prices.DOGE * 0.93, ago(4));

  // Cancelled order (no balance effect)
  await prisma.order.create({
    data: {
      userId: demo.id,
      marketId: marketIds.ETH,
      side: "BUY",
      type: "LIMIT",
      status: "CANCELLED",
      price: D((prices.ETH * 0.8).toFixed(2)),
      quantity: D(1),
      isDemo: true,
      createdAt: ago(12),
      closedAt: ago(11),
      events: {
        create: [
          { status: "CREATED", createdAt: ago(12) },
          { status: "ACCEPTED", createdAt: ago(12) },
          { status: "CANCELLED", note: "Cancelled by user", createdAt: ago(11) },
        ],
      },
    },
  });
  // Open resting limit order (funds reserved)
  {
    const q = D(0.05);
    const p = D((prices.BTC * 0.9).toFixed(2));
    const reserve = q.mul(p).mul("1.001").toDecimalPlaces(8, Prisma.Decimal.ROUND_UP);
    L.lock("USDT", reserve);
    await prisma.order.create({
      data: {
        userId: demo.id,
        marketId: marketIds.BTC,
        side: "BUY",
        type: "LIMIT",
        status: "ACCEPTED",
        price: p,
        quantity: q,
        lockedAmount: reserve,
        isDemo: true,
        createdAt: ago(2),
        events: {
          create: [
            { status: "CREATED", createdAt: ago(2) },
            { status: "VALIDATED", createdAt: ago(2) },
            { status: "ACCEPTED", note: `Reserved ${reserve} USDT.`, createdAt: ago(2) },
          ],
        },
      },
    });
  }

  // ── Investment plans (no return promises) ───────────────────
  const plans = [
    {
      slug: "basic",
      name: "Basic Plan",
      tagline: "A measured first step into managed digital-asset exposure.",
      description: "Designed for users who want a simple, rules-based allocation without managing individual trades.",
      strategy: "Predominantly stablecoin reserves with a small, capped sleeve of BTC and ETH. Rebalanced weekly back to target weights.",
      risk: "LOW",
      riskDescription:
        "Lower volatility than a pure crypto allocation, but the crypto sleeve can still lose value and stablecoins carry issuer and de-peg risk.",
      min: 100,
      max: 999,
      days: 1,
      mgmt: 1,
      perf: 10,
      exitFee: 0,
    },
    {
      slug: "silver",
      name: "Silver Plan",
      tagline: "Core large-cap exposure with systematic rebalancing.",
      description: "A diversified basket of large-cap assets managed with volatility-aware position sizing.",
      strategy: "Target weights across BTC, ETH and selected large-cap Layer 1 assets, with a stablecoin buffer that expands when volatility rises.",
      risk: "MEDIUM",
      riskDescription: "Returns track broad crypto market conditions. Drawdowns of 20% or more are possible in adverse markets.",
      min: 1000,
      max: 4999,
      days: 2,
      mgmt: 1.5,
      perf: 15,
      exitFee: 1,
    },
    {
      slug: "gold",
      name: "Gold Plan",
      tagline: "Active trend-following across liquid markets.",
      description: "For experienced users comfortable with active management and higher volatility.",
      strategy: "Trend and momentum signals across the platform's most liquid spot markets, with stop-based risk controls on every position.",
      risk: "HIGH",
      riskDescription: "Active strategies can underperform in range-bound markets and may experience significant, rapid drawdowns.",
      min: 5000,
      max: 9999,
      days: 7,
      mgmt: 2,
      perf: 20,
      exitFee: 2,
    },
    {
      slug: "platinum",
      name: "Platinum Plan",
      tagline: "Tailored mandates for larger allocations.",
      description: "A higher-capacity mandate combining the Silver core with tactical satellite positions.",
      strategy: "Core-satellite portfolio: a rules-based large-cap core plus discretionary satellite positions in DeFi and Layer 2 assets.",
      risk: "VERY_HIGH",
      riskDescription:
        "Includes smaller-cap and sector-specific assets that can be highly volatile and less liquid. You could lose a substantial part of your allocation.",
      min: 10000,
      max: 50000,
      days: 14,
      mgmt: 1.25,
      perf: 20,
      exitFee: 3,
    },
  ];
  const planIds = {};
  for (const [i, p] of plans.entries()) {
    const row = await prisma.investmentPlan.create({
      data: {
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        strategy: p.strategy,
        riskLevel: p.risk,
        riskDescription: p.riskDescription,
        assetId: assetIds.USDT,
        minAllocation: D(p.min),
        maxAllocation: D(p.max),
        durationDays: p.days,
        managementFeePct: D(p.mgmt),
        performanceFeePct: D(p.perf),
        earlyExitAllowed: true,
        earlyExitFeePct: D(p.exitFee),
        sortOrder: i,
      },
    });
    planIds[p.slug] = row.id;
  }
  {
    const amt = D(2000);
    L.debit("USDT", amt);
    const sub = await prisma.investmentSubscription.create({
      data: {
        userId: demo.id,
        planId: planIds.silver,
        amount: amt,
        status: "ACTIVE",
        termsAcceptedAt: ago(1),
        isDemo: true,
        startedAt: ago(1),
        endsAt: new Date(ago(1).getTime() + 2 * DAY),
        createdAt: ago(1),
      },
    });
    await tx({
      userId: demo.id,
      type: "INVESTMENT",
      direction: "DEBIT",
      assetId: assetIds.USDT,
      amount: amt,
      description: "Allocation to Silver Plan",
      metadata: { subscriptionId: sub.id },
      createdAt: ago(1),
    });
    const amt2 = D(500);
    L.debit("USDT", amt2);
    const sub2 = await prisma.investmentSubscription.create({
      data: {
        userId: demo.id,
        planId: planIds.basic,
        amount: amt2,
        status: "COMPLETED",
        realizedPnl: D(0),
        feesCharged: D("0.41"),
        termsAcceptedAt: ago(75),
        isDemo: true,
        startedAt: ago(46),
        endsAt: ago(45),
        completedAt: ago(44),
        createdAt: ago(75),
      },
    });
    await tx({
      userId: demo.id,
      type: "INVESTMENT",
      direction: "DEBIT",
      assetId: assetIds.USDT,
      amount: amt2,
      description: "Allocation to Basic Plan",
      metadata: { subscriptionId: sub2.id },
      createdAt: ago(75),
    });
    L.credit("USDT", D("499.59"));
    await tx({
      userId: demo.id,
      type: "INVESTMENT",
      direction: "CREDIT",
      assetId: assetIds.USDT,
      amount: D("499.59"),
      fee: D("0.41"),
      description: "Basic Plan settlement",
      metadata: { subscriptionId: sub2.id, realizedPnl: "0" },
      createdAt: ago(44),
    });
  }

  // ── Lead traders (copy trading) ────────────────────────────
  // Profiles only: performance is calculated from signals issued in the admin console.
  const traders = [
    {
      slug: "northwind-quant",
      name: "Northwind Quant",
      color: "#4DA2FF",
      strategy: "Systematic trend following",
      tags: ["Trend", "Systematic"],
      assets: ["BTC", "ETH", "SOL"],
      risk: "MEDIUM",
      bio: "Rules-based trend model on major pairs with volatility-scaled sizing. Positions typically held for several days.",
    },
    {
      slug: "meridian-swing",
      name: "Meridian Swing",
      color: "#F2B544",
      strategy: "Swing trading",
      tags: ["Swing", "Discretionary"],
      assets: ["ETH", "BNB", "LINK", "AVAX"],
      risk: "HIGH",
      bio: "Discretionary swing trades around key weekly levels. Concentrated positions and wider stops.",
    },
    {
      slug: "tidewater-macro",
      name: "Tidewater Macro",
      color: "#2BC29A",
      strategy: "Macro rotation",
      tags: ["Macro", "Rotation"],
      assets: ["BTC", "ETH", "USDC"],
      risk: "LOW",
      bio: "Rotates between BTC, ETH and stablecoins based on macro and liquidity regimes. Low turnover.",
    },
    {
      slug: "keel-compass",
      name: "Keel & Compass",
      color: "#B86BC8",
      strategy: "Mean reversion",
      tags: ["Mean reversion", "Systematic"],
      assets: ["SOL", "XRP", "ADA", "DOT"],
      risk: "MEDIUM",
      bio: "Fades short-term extremes on liquid Layer 1 markets with strict time-based exits.",
    },
    {
      slug: "lowtide-scalper",
      name: "Lowtide Scalper",
      color: "#E84142",
      strategy: "Intraday scalping",
      tags: ["Scalping", "High frequency"],
      assets: ["BTC", "ETH"],
      risk: "VERY_HIGH",
      bio: "High-turnover intraday strategy. Results are sensitive to fees and slippage.",
    },
    {
      slug: "beacon-momentum",
      name: "Beacon Momentum",
      color: "#34A8F0",
      strategy: "Sector momentum",
      tags: ["Momentum", "DeFi", "Layer 2"],
      assets: ["ARB", "OP", "UNI", "AAVE", "LDO"],
      risk: "HIGH",
      bio: "Allocates to the strongest DeFi and Layer 2 names on a rolling basis.",
    },
  ];
  const traderIds = {};
  for (const t of traders) {
    const row = await prisma.copyTrader.create({
      data: {
        slug: t.slug,
        displayName: t.name,
        avatarColor: t.color,
        bio: t.bio,
        strategy: t.strategy,
        strategyTags: t.tags,
        assets: t.assets,
        riskLevel: t.risk,
        status: "ACTIVE",
        minAllocation: D(t.risk === "LOW" ? 100 : 250),
        maxAllocation: D(25_000),
      },
    });
    traderIds[t.slug] = row.id;
  }
  // The demo trader follows one lead trader; funds stay in their wallet until a signal executes.
  await prisma.copySubscription.create({
    data: {
      userId: demo.id,
      traderId: traderIds["tidewater-macro"],
      allocation: D(1000),
      amountPerTrade: D(100),
      stopLossPct: D(15),
      isDemo: true,
      startedAt: ago(18),
      createdAt: ago(18),
    },
  });

  // Pending withdrawal (funds locked)
  {
    const amount = D(500),
      fee = D(1);
    L.lock("USDT", amount.plus(fee));
    const w = await prisma.withdrawal.create({
      data: {
        userId: demo.id,
        assetId: assetIds.USDT,
        networkId: networkIds["USDT:TRC20"],
        amount,
        fee,
        totalDebit: amount.plus(fee),
        address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
        status: "PENDING_REVIEW",
        isDemo: true,
        requestedIp: "127.0.0.1",
        createdAt: ago(0, 5),
      },
    });
    await tx({
      userId: demo.id,
      type: "WITHDRAWAL",
      direction: "DEBIT",
      status: "PENDING",
      assetId: assetIds.USDT,
      amount,
      fee,
      withdrawalId: w.id,
      description: "USDT withdrawal via TRON (TRC20) (demo)",
      createdAt: ago(0, 5),
    });
  }

  // ── Other demo users (for admin views & referrals) ─────────
  const people = [
    ["Amara", "Okafor", "NG", "ACTIVE", "APPROVED"],
    ["Lucas", "Meyer", "DE", "ACTIVE", "PENDING"],
    ["Sofia", "Rossi", "IT", "ACTIVE", "NOT_STARTED"],
    ["Kenji", "Watanabe", "JP", "ACTIVE", "APPROVED"],
    ["Chloe", "Martin", "FR", "PENDING_VERIFICATION", "NOT_STARTED"],
    ["Diego", "Alvarez", "ES", "SUSPENDED", "REJECTED"],
    ["Priya", "Nair", "IN", "ACTIVE", "PENDING"],
    ["Ethan", "Brooks", "CA", "ACTIVE", "APPROVED"],
    ["Leila", "Haddad", "AE", "ACTIVE", "NOT_STARTED"],
    ["Noah", "Fischer", "CH", "ACTIVE", "APPROVED"],
  ];
  const userHash = await hash(PASSWORDS.user);
  const others = [];
  for (const [i, [first, last, country, status, kyc]] of people.entries()) {
    const created = ago(80 - i * 7);
    const u = await prisma.user.create({
      data: {
        email: `${first.toLowerCase()}.${last.toLowerCase()}@example.test`,
        passwordHash: userHash,
        status,
        emailVerifiedAt: status === "PENDING_VERIFICATION" ? null : created,
        referralCode: referralCode(),
        isDemo: true,
        createdAt: created,
        lastLoginAt: status === "ACTIVE" ? ago(i % 5) : null,
        profile: { create: { firstName: first, lastName: last, country } },
        portfolio: { create: {} },
      },
    });
    await prisma.loginHistory.create({
      data: { userId: u.id, ip: `203.0.113.${10 + i}`, userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/128", success: true, createdAt: ago(i % 5) },
    });
    if (i < 4)
      await prisma.referral.create({
        data: { referrerId: demo.id, referredId: u.id, status: i < 2 ? "ACTIVE" : "PENDING", activatedAt: i < 2 ? ago(40 - i * 5) : null, createdAt: created },
      });
    if (kyc !== "NOT_STARTED") {
      const app = await prisma.kycApplication.create({
        data: {
          userId: u.id,
          status: kyc,
          fullName: `${first} ${last}`,
          dateOfBirth: new Date(1985 + i, i % 12, 10 + i),
          country,
          addressLine: `${10 + i} Sample Road`,
          city: "Sample City",
          postalCode: `SC${100 + i}`,
          idType: i % 2 ? "NATIONAL_ID" : "PASSPORT",
          submittedAt: ago(10 - i / 2),
          reviewedAt: kyc === "PENDING" ? null : ago(8),
          reviewedById: kyc === "PENDING" ? null : admin.id,
          rejectionReason: kyc === "REJECTED" ? "Document image was unreadable." : null,
        },
      });
      for (const type of ["GOVERNMENT_ID", "PROOF_OF_ADDRESS"]) {
        const key = `kyc/${u.id}/seed-${type.toLowerCase()}.pdf`;
        writeDemoDoc(key);
        await prisma.kycDocument.create({
          data: {
            applicationId: app.id,
            type,
            storageKey: key,
            fileName: `${type.toLowerCase()}-demo.pdf`,
            mimeType: "application/pdf",
            size: DEMO_PDF.length,
          },
        });
      }
    }
    const UL = new Ledger();
    if (status === "ACTIVE") {
      await deposit(u.id, UL, "USDT", i % 2 ? "BEP20" : "TRC20", 2500 + i * 750, ago(60 - i * 4));
      if (i % 3 === 0) await filledOrder(u.id, UL, "BTC", "BUY", 0.01, prices.BTC * (0.92 + i / 100), ago(20 - i));
      if (i % 3 === 1) await filledOrder(u.id, UL, "ETH", "BUY", 0.3, prices.ETH * 0.97, ago(15 - i));
    }
    others.push({ id: u.id, L: UL });
  }

  // Pending (reported) deposits awaiting review — demo, placeholder hashes
  for (const [n, o] of [others[1], others[6]].entries()) {
    const amount = D(n === 0 ? 2500 : 800);
    const d = await prisma.deposit.create({
      data: {
        userId: o.id,
        assetId: assetIds.USDT,
        networkId: networkIds["USDT:ERC20"],
        amount,
        status: "PENDING",
        txHash: `demo-tx-${String(n + 1).padStart(4, "0")}`,
        requiredConfirmations: 12,
        provider: "manual",
        isDemo: true,
        expiresAt: new Date(Date.now() + 5 * DAY),
        createdAt: ago(0, 3 + n),
      },
    });
    await tx({
      userId: o.id,
      type: "DEPOSIT",
      direction: "CREDIT",
      status: "PENDING",
      assetId: assetIds.USDT,
      amount,
      depositId: d.id,
      description: "USDT deposit via Ethereum (ERC20) (demo)",
      createdAt: ago(0, 3 + n),
    });
  }
  // Withdrawals in various states for other users
  const wStates = [
    { o: others[0], status: "PENDING_REVIEW", amt: 300 },
    { o: others[3], status: "PROCESSING", amt: 150 },
    { o: others[7], status: "COMPLETED", amt: 200 },
    { o: others[9], status: "REJECTED", amt: 400 },
  ];
  for (const [n, w] of wStates.entries()) {
    const amount = D(w.amt),
      fee = D(1),
      total = amount.plus(fee);
    if (w.status === "PENDING_REVIEW" || w.status === "PROCESSING") w.o.L.lock("USDT", total);
    if (w.status === "COMPLETED") w.o.L.debit("USDT", total);
    const row = await prisma.withdrawal.create({
      data: {
        userId: w.o.id,
        assetId: assetIds.USDT,
        networkId: networkIds["USDT:TRC20"],
        amount,
        fee,
        totalDebit: total,
        address: "TJYeasTPa6gpEEfYBd7SW2yP4VYbeQ4bUw",
        status: w.status,
        isDemo: true,
        requestedIp: "198.51.100.7",
        reviewedById: w.status === "PENDING_REVIEW" ? null : admin.id,
        rejectionReason: w.status === "REJECTED" ? "Destination address failed screening." : null,
        txHash: w.status === "COMPLETED" ? "demo-payout-0001" : null,
        processedAt: w.status === "PENDING_REVIEW" ? null : ago(1),
        completedAt: w.status === "COMPLETED" ? ago(1) : null,
        createdAt: ago(2, n),
      },
    });
    await tx({
      userId: w.o.id,
      type: "WITHDRAWAL",
      direction: "DEBIT",
      status: w.status === "COMPLETED" ? "COMPLETED" : w.status === "REJECTED" ? "CANCELLED" : "PENDING",
      assetId: assetIds.USDT,
      amount,
      fee,
      withdrawalId: row.id,
      description: "USDT withdrawal via TRON (TRC20) (demo)",
      createdAt: ago(2, n),
    });
  }

  // Referral rewards for demo user (program configured below; demo data)
  const refs = await prisma.referral.findMany({ where: { referrerId: demo.id, status: "ACTIVE" } });
  for (const [n, r] of refs.entries()) {
    const reward = await prisma.referralReward.create({
      data: {
        referralId: r.id,
        userId: demo.id,
        assetId: assetIds.USDT,
        amount: D(10),
        status: n === 0 ? "COMPLETED" : "PENDING",
        reason: "FIRST_DEPOSIT",
        isDemo: true,
        paidAt: n === 0 ? ago(30) : null,
        createdAt: ago(35 - n),
      },
    });
    if (reward.status === "COMPLETED") {
      L.credit("USDT", D(10));
      await tx({
        userId: demo.id,
        type: "REFERRAL",
        direction: "CREDIT",
        assetId: assetIds.USDT,
        amount: D(10),
        description: "Referral reward",
        createdAt: ago(30),
      });
    }
  }

  // ── Persist wallets & positions from ledgers ───────────────
  async function persist(userId, ledger) {
    for (const [sym, b] of ledger.bal) {
      await prisma.wallet.create({ data: { userId, assetId: assetIds[sym], available: b.available, locked: b.locked } });
    }
  }
  await persist(demo.id, L);
  for (const o of others) await persist(o.id, o.L);
  for (const [sym, p] of positions) {
    if (p.qty.lte(0) && p.realized.eq(0)) continue;
    await prisma.position.create({
      data: {
        userId: demo.id,
        assetId: assetIds[sym],
        quantity: p.qty.gt(0) ? p.qty : D(0),
        avgCost: p.qty.gt(0) ? p.cost.div(p.qty).toDecimalPlaces(18) : D(0),
        realizedPnl: p.realized.toDecimalPlaces(18),
      },
    });
  }

  // Demo performance history (labelled demo in the UI)
  {
    let value = 0;
    for (const [sym, b] of L.bal) value += b.available.plus(b.locked).toNumber() * (sym === "USDT" ? 1 : (prices[sym] ?? 0));
    value += 3000; // investment + copy allocations
    const portfolio = await prisma.portfolio.findUniqueOrThrow({ where: { userId: demo.id } });
    const points = [];
    let v = value * 0.84;
    for (let h = 90 * 24; h >= 6; h -= 6) {
      const drift = ((value - v) / (h / 6)) * 0.35;
      v = Math.max(1000, v + drift + (rand() - 0.5) * value * 0.012);
      points.push({ portfolioId: portfolio.id, totalValue: D(v.toFixed(2)), invested: D(3000), isDemo: true, createdAt: new Date(Date.now() - h * 3_600_000) });
    }
    await prisma.portfolioSnapshot.createMany({ data: points });
  }

  // ── Notifications ──────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      {
        userId: demo.id,
        type: "SYSTEM_ANNOUNCEMENT",
        title: "Welcome to the HarborFinance demo",
        body: "This account uses simulated balances. Nothing you do here moves real funds.",
        createdAt: ago(90),
      },
      {
        userId: demo.id,
        type: "DEPOSIT_RECEIVED",
        title: "Simulated deposit received: 5000 USDC",
        body: "Your USDC deposit via Ethereum (ERC20) has been credited.",
        link: "/dashboard/transactions?type=DEPOSIT",
        readAt: ago(29),
        createdAt: ago(30),
      },
      {
        userId: demo.id,
        type: "TRADE_EXECUTED",
        title: "Sold 10 SOL (demo)",
        body: "Order filled on SOL-USDT.",
        link: "/dashboard/transactions?type=TRADE",
        readAt: ago(8),
        createdAt: ago(9),
      },
      {
        userId: demo.id,
        type: "INVESTMENT_UPDATE",
        title: "Silver Plan subscription active",
        body: "Your allocation is now active for 48 hours. Results will vary and are not guaranteed.",
        link: "/dashboard/investments",
        createdAt: ago(1),
      },
      {
        userId: demo.id,
        type: "TRADE_EXECUTED",
        title: "Bought 5000 DOGE (demo)",
        body: "Order filled on DOGE-USDT.",
        link: "/dashboard/transactions?type=TRADE",
        createdAt: ago(4),
      },
      {
        userId: demo.id,
        type: "WITHDRAWAL_STATUS",
        title: "Withdrawal requested: 500 USDT",
        body: "Your withdrawal is pending review.",
        link: "/dashboard/withdraw",
        createdAt: ago(0, 5),
      },
      {
        userId: demo.id,
        type: "SECURITY_ALERT",
        title: "Protect your account with 2FA",
        body: "Two-factor authentication is not enabled. Turn it on in Settings → Security.",
        link: "/dashboard/settings?tab=security",
        createdAt: ago(0, 2),
      },
    ],
  });

  // ── Support ────────────────────────────────────────────────
  const t1 = await prisma.supportTicket.create({
    data: {
      userId: demo.id,
      subject: "Question about withdrawal review times",
      category: "WITHDRAWAL",
      priority: "NORMAL",
      status: "WAITING_FOR_USER",
      assignedToId: supportAgent.id,
      createdAt: ago(1),
      lastMessageAt: ago(0, 20),
    },
  });
  await prisma.supportMessage.createMany({
    data: [
      { ticketId: t1.id, authorId: demo.id, body: "Hi, how long does the withdrawal review usually take?", createdAt: ago(1) },
      {
        ticketId: t1.id,
        authorId: supportAgent.id,
        isStaff: true,
        body: "Thanks for reaching out. Withdrawals are reviewed by our finance team; you'll get a notification as soon as the status changes. Is there anything specific about your request we can check?",
        createdAt: ago(0, 20),
      },
    ],
  });
  const t2 = await prisma.supportTicket.create({
    data: {
      userId: demo.id,
      subject: "How do stop-limit orders work?",
      category: "TRADING",
      priority: "LOW",
      status: "RESOLVED",
      createdAt: ago(14),
      lastMessageAt: ago(13),
    },
  });
  await prisma.supportMessage.createMany({
    data: [
      { ticketId: t2.id, authorId: demo.id, body: "When does a stop-limit order become active?", createdAt: ago(14) },
      {
        ticketId: t2.id,
        authorId: supportAgent.id,
        isStaff: true,
        body: "A stop-limit order rests until the market reaches your stop price. It then becomes a limit order at your limit price. See Learn → Order types for examples.",
        createdAt: ago(13),
      },
    ],
  });
  await prisma.supportTicket.create({
    data: {
      userId: others[2].id,
      subject: "Unable to upload proof of address",
      category: "KYC",
      priority: "HIGH",
      status: "OPEN",
      createdAt: ago(0, 8),
      lastMessageAt: ago(0, 8),
      messages: { create: { authorId: others[2].id, body: "The upload keeps failing with my PDF bank statement.", createdAt: ago(0, 8) } },
    },
  });

  // ── Settings & audit ───────────────────────────────────────
  await prisma.systemSetting.create({
    data: {
      key: "referral.program",
      description: "Referral rules. Rewards are never guaranteed and default to zero.",
      value: {
        enabled: true,
        rewardAsset: "USDT",
        rewardAmount: 10,
        qualifyingAction: "FIRST_DEPOSIT",
        minQualifyingDeposit: 100,
        terms:
          "Demo configuration: a 10 USDT reward may be credited after a referred account's first deposit of at least 100 USDT is completed and reviewed. Rewards can change or end at any time.",
      },
      updatedById: admin.id,
    },
  });
  await prisma.auditLog.createMany({
    data: [
      {
        actorId: admin.id,
        actorEmail: admin.email,
        action: "kyc.approved",
        targetType: "KycApplication",
        targetId: null,
        metadata: { note: "seed" },
        createdAt: ago(8),
      },
      {
        actorId: admin.id,
        actorEmail: admin.email,
        action: "withdrawal.reject",
        targetType: "Withdrawal",
        metadata: { reason: "Destination address failed screening." },
        createdAt: ago(1),
      },
      {
        actorId: admin.id,
        actorEmail: admin.email,
        action: "user.suspend",
        targetType: "User",
        targetId: others[5].id,
        metadata: { reason: "Suspicious activity review" },
        createdAt: ago(6),
      },
    ],
  });

  console.log("\nDone. Development accounts (all data is DEMO):");
  console.log(`  Demo trader  demo@harborfinance.test        ${PASSWORDS.demo}`);
  console.log(`  Super admin  admin@harborfinance.test       ${PASSWORDS.admin}`);
  console.log(`  Staff        compliance|finance|support@harborfinance.test  ${PASSWORDS.staff}`);
  console.log(`  Users        <first>.<last>@example.test    ${PASSWORDS.user}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
