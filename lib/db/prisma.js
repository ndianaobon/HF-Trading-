import "server-only";
import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
export { Prisma };

/**
 * Runs `fn` inside a SERIALIZABLE-safe interactive transaction and retries on
 * serialization / deadlock failures (P2034). Use for every balance change.
 */
export async function withTransaction(fn, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (err) {
      const code = err.code;
      if (code === "P2034" && attempt < retries) continue;
      throw err;
    }
  }
}
