import "server-only";
import { prisma } from "@/lib/db/prisma";
import { hashToken, randomToken } from "@/lib/security/crypto";
import { AppError } from "@/lib/api/errors";

export const API_KEY_SCOPES = ["read", "trade"];

/** Creates an API key. The plain key is returned once and never stored. */
export async function createApiKey(userId, name, scopes) {
  const prefix = randomToken(6)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .padEnd(8, "0");
  const secret = randomToken(32);
  const plain = `hfk_${prefix}_${secret}`;
  const key = await prisma.apiKey.create({
    data: { userId, name, keyPrefix: `hfk_${prefix}`, keyHash: hashToken(plain), scopes },
    select: { id: true, name: true, keyPrefix: true, scopes: true, createdAt: true },
  });
  return { key, plain };
}

/** Resolves an API key to a session-shaped object for the route wrapper. */
export async function authenticateApiKey(token, scope) {
  if (!/^hfk_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{20,}$/.test(token)) throw new AppError("UNAUTHENTICATED");
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(token) } });
  if (!key || key.revokedAt) throw new AppError("UNAUTHENTICATED");
  if (!key.scopes.includes(scope)) throw new AppError("FORBIDDEN", "This API key does not have the required scope.");

  const user = await prisma.user.findUnique({
    where: { id: key.userId },
    include: { profile: true, adminUser: true, twoFactor: { select: { enabled: true } } },
  });
  if (!user || ["SUSPENDED", "BANNED", "CLOSED"].includes(user.status)) throw new AppError("UNAUTHENTICATED");
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

  // API keys never grant admin access.
  return {
    id: `apikey:${key.id}`,
    userId: user.id,
    tokenHash: "",
    ip: null,
    userAgent: "api-key",
    mfaVerified: true,
    remember: false,
    createdAt: key.createdAt,
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: { ...user, adminUser: null },
  };
}
