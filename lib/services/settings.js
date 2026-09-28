import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

/**
 * Typed system settings stored in SystemSetting. Every setting has a schema
 * and a conservative default. Trust/company information is only rendered
 * publicly when `verified` is true (set by an administrator with evidence).
 */
export const SETTING_SCHEMAS = {
  "platform.maintenance": z.object({ enabled: z.boolean(), message: z.string().max(300) }),
  "platform.registrationOpen": z.object({ enabled: z.boolean() }),
  "kyc.requirements": z.object({
    requiredForDeposit: z.boolean(),
    requiredForWithdrawal: z.boolean(),
    requiredForInvestments: z.boolean(),
    selfieRequired: z.boolean(),
  }),
  "trading.limits": z.object({
    maxOrderNotional: z.number().positive(),
    maxOpenOrders: z.number().int().positive(),
  }),
  "referral.program": z.object({
    enabled: z.boolean(),
    rewardAsset: z.string(),
    rewardAmount: z.number().min(0),
    qualifyingAction: z.enum(["FIRST_DEPOSIT", "KYC_APPROVED"]),
    minQualifyingDeposit: z.number().min(0),
    /** Credit rewards to the referrer's wallet immediately (otherwise they wait for admin approval). */
    autoCredit: z.boolean().default(true),
    terms: z.string().max(2000),
  }),
  "company.profile": z.object({
    verified: z.boolean(),
    legalName: z.string().max(200),
    registrationNumber: z.string().max(100),
    registeredAddress: z.string().max(400),
    licenses: z.array(z.object({ name: z.string(), authority: z.string(), number: z.string() })),
  }),
  "security.admin": z.object({
    /** Require staff to use two-factor authentication before opening the admin console. */
    requireTwoFactor: z.boolean(),
  }),
  "support.contact": z.object({
    email: z.string().max(200),
    liveChatEnabled: z.boolean(),
    hours: z.string().max(200),
  }),
};

export const SETTING_DEFAULTS = {
  "platform.maintenance": { enabled: false, message: "" },
  "platform.registrationOpen": { enabled: true },
  "kyc.requirements": { requiredForDeposit: false, requiredForWithdrawal: true, requiredForInvestments: true, selfieRequired: false },
  "trading.limits": { maxOrderNotional: 250_000, maxOpenOrders: 50 },
  "referral.program": {
    enabled: true,
    rewardAsset: "USDT",
    rewardAmount: 10,
    qualifyingAction: "FIRST_DEPOSIT",
    minQualifyingDeposit: 100,
    autoCredit: true,
    terms:
      "Referral rewards, if any, are set by HarborFinance and may change or end at any time. Rewards are credited only after the referred account completes the qualifying action.",
  },
  "company.profile": { verified: false, legalName: "", registrationNumber: "", registeredAddress: "", licenses: [] },
  "security.admin": { requireTwoFactor: false },
  "support.contact": { email: "support@harborfinance.test", liveChatEnabled: true, hours: "" },
};

export const SETTING_DESCRIPTIONS = {
  "platform.maintenance": "Show a maintenance banner and block new orders.",
  "platform.registrationOpen": "Allow new account registrations.",
  "kyc.requirements": "Which actions require an approved identity verification.",
  "trading.limits": "Per-order and per-user risk limits.",
  "referral.program": "Referral rules: reward per referred user whose deposit reaches the minimum (USDT value), credited automatically when autoCredit is on.",
  "company.profile": "Legal entity details. Only displayed publicly when marked verified.",
  "security.admin": "Admin console security. Two-factor authentication for staff is strongly recommended: without it, a staff password alone gives access to every account.",
  "support.contact": "Support contact details shown to users.",
};

export async function getSetting(key) {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row) return SETTING_DEFAULTS[key];
  const parsed = SETTING_SCHEMAS[key].safeParse(row.value);
  return parsed.success ? parsed.data : SETTING_DEFAULTS[key];
}

let adminPolicy = null;
/** Cached (30 s) staff 2FA policy, checked on every admin request. */
export async function staffTwoFactorRequired() {
  if (!adminPolicy || Date.now() - adminPolicy.at > 30_000) adminPolicy = { at: Date.now(), value: (await getSetting("security.admin")).requireTwoFactor };
  return adminPolicy.value;
}

export async function setSetting(key, value, updatedById) {
  const parsed = SETTING_SCHEMAS[key].parse(value);
  if (key === "security.admin") adminPolicy = null;
  return prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: parsed, updatedById, description: SETTING_DESCRIPTIONS[key] },
    update: { value: parsed, updatedById },
  });
}

export async function getAllSettings() {
  const rows = await prisma.systemSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r]));
  return Object.keys(SETTING_SCHEMAS).map((key) => {
    const row = map.get(key);
    const parsed = row ? SETTING_SCHEMAS[key].safeParse(row.value) : null;
    return {
      key,
      description: SETTING_DESCRIPTIONS[key],
      value: parsed?.success ? parsed.data : SETTING_DEFAULTS[key],
      updatedAt: row?.updatedAt ?? null,
    };
  });
}
