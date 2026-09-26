import { z } from "zod";
import { AppError } from "@/lib/api/errors";

const dec = z.string().regex(/^\d+(\.\d+)?$/, "Enter a valid number");

export const planSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, "Lowercase letters, numbers and dashes"),
  tagline: z.string().trim().min(5).max(160),
  description: z.string().trim().min(10).max(1000),
  strategy: z.string().trim().min(10).max(1000),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]),
  riskDescription: z.string().trim().min(10).max(1000),
  minAllocation: dec,
  maxAllocation: dec,
  durationDays: z.coerce.number().int().min(1).max(1825),
  managementFeePct: dec,
  performanceFeePct: dec,
  earlyExitAllowed: z.boolean(),
  earlyExitFeePct: dec,
  status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
});

/** Guard against marketing language that implies guaranteed returns. */
export function assertNoGuarantees(texts) {
  const banned = /\b(guarantee[ds]?|risk[- ]free|assured returns?|fixed returns?|daily (profit|return)s?|\d+(\.\d+)?\s*%\s*(daily|weekly|monthly|roi))\b/i;
  if (texts.some((t) => banned.test(t))) {
    throw new AppError("VALIDATION_ERROR", "Plan copy must not promise or imply guaranteed returns.");
  }
}

export const traderSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/),
  bio: z.string().trim().min(10).max(600),
  strategy: z.string().trim().min(3).max(80),
  strategyTags: z.array(z.string().trim().max(30)).max(6),
  assets: z.array(z.string().trim().toUpperCase().max(10)).max(10),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]),
  minAllocation: dec,
  profitSharePct: dec,
  avatarColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#F2B544"),
});
