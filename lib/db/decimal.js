import { Prisma } from "@prisma/client";

export const Decimal = Prisma.Decimal;

export const D = (v) => new Prisma.Decimal(v ?? 0);
export const ZERO = new Prisma.Decimal(0);

/** Round down to `dp` decimal places (never rounds balances up). */
export const floor = (v, dp) => D(v).toDecimalPlaces(dp, Prisma.Decimal.ROUND_DOWN);

/** Convert Prisma results (Decimal, Date) to plain JSON-safe values. */
export function serialize(value) {
  return JSON.parse(JSON.stringify(value));
}
