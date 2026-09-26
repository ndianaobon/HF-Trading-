import "server-only";
import { prisma } from "@/lib/db/prisma";
import { hashToken, randomToken } from "@/lib/security/crypto";
import { AppError } from "@/lib/api/errors";

const TTL = {
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 30 * 60 * 1000,
};

/** Issues a single-use token; previous unused tokens for the same purpose are invalidated. */
export async function issueToken(userId, purpose) {
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.verificationToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.verificationToken.create({
      data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TTL[purpose]) },
    }),
  ]);
  return token;
}

/** Atomically consumes a token and returns its userId. */
export async function consumeToken(token, purpose) {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("INVALID_TOKEN");
  }
  const { count } = await prisma.verificationToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count !== 1) throw new AppError("INVALID_TOKEN");
  return record.userId;
}
