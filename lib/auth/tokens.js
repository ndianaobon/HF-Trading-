import "server-only";
import { prisma } from "@/lib/db/prisma";
import { randomInt } from "node:crypto";
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

const CODE_TTL = 15 * 60 * 1000;
// Codes are short, so the stored hash is bound to the user (and codes can repeat across users).
const codeHash = (userId, code) => hashToken(`code:${userId}:${code}`);

/**
 * Issues a single-use 6-digit code (e.g. email verification), valid 15 minutes.
 * Previous unused tokens/codes for the same purpose are invalidated.
 */
export async function issueCode(userId, purpose) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.$transaction([
    prisma.verificationToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.verificationToken.create({ data: { userId, purpose, tokenHash: codeHash(userId, code), expiresAt: new Date(Date.now() + CODE_TTL) } }),
  ]);
  return code;
}

/** Consumes a 6-digit code for this user. Callers must rate-limit attempts per user. */
export async function consumeCode(userId, code, purpose) {
  if (!/^\d{6}$/.test(code)) throw new AppError("INVALID_CODE");
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: codeHash(userId, code) } });
  if (!record || record.userId !== userId || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("INVALID_CODE");
  }
  const { count } = await prisma.verificationToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) throw new AppError("INVALID_CODE");
  return record.userId;
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
