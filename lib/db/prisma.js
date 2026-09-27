import "server-only";
import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis;

/**
 * Caps the connection pool unless DATABASE_URL sets it. Prisma's default scales
 * with the CPU count the host reports, which on shared hosting can be large
 * enough to exhaust the database pooler's client limit under load.
 */
function databaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", process.env.DB_CONNECTION_LIMIT ?? "10");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
    return url.toString();
  } catch {
    return raw;
  }
}

const url = databaseUrl();
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
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
