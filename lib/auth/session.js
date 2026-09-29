import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { hashToken, randomToken } from "@/lib/security/crypto";
import { isProduction } from "@/lib/config";

export const SESSION_COOKIE = "hf_session";
const SHORT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
/** Sessions not used for this long are signed out, even with "remember me". */
export const IDLE_TIMEOUT_MS = 48 * 60 * 60 * 1000; // 48 hours

export async function createSession(opts) {
  const token = randomToken(32);
  const ttl = opts.remember ? REMEMBER_TTL_MS : SHORT_TTL_MS;
  const session = await prisma.session.create({
    data: {
      userId: opts.userId,
      tokenHash: hashToken(token),
      remember: opts.remember,
      mfaVerified: opts.mfaVerified,
      ip: opts.ip,
      userAgent: opts.userAgent,
      expiresAt: new Date(Date.now() + ttl),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    ...(opts.remember ? { expires: session.expiresAt } : {}),
  });
  return session;
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

const sessionInclude = {
  user: {
    include: {
      profile: true,
      adminUser: true,
      twoFactor: { select: { enabled: true } },
    },
  },
};

async function loadSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: sessionInclude,
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) {
    await revokeSession(session.id).catch(() => {});
    return null;
  }
  if (["SUSPENDED", "BANNED", "CLOSED"].includes(session.user.status)) return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session;
}

/** Current session (deduplicated per request). Includes sessions awaiting 2FA. */
export const getRawSession = cache(loadSession);

/** Fully authenticated session (2FA satisfied when enabled), or null. */
export const getSession = cache(async () => {
  const s = await getRawSession();
  if (!s) return null;
  if (s.user.twoFactor?.enabled && !s.mfaVerified) return null;
  return s;
});

export async function revokeSession(sessionId) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId, exceptSessionId) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
