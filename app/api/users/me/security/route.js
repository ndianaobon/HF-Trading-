import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { describeUserAgent } from "@/lib/security/request";

export const GET = route({ auth: "user" }, async ({ session }) => {
  const userId = session.user.id;
  const [sessions, logins, twoFactor, apiKeys] = await Promise.all([
    prisma.session.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
    prisma.loginHistory.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.twoFactorAuth.findUnique({ where: { userId }, select: { enabled: true, enabledAt: true, backupCodes: true } }),
    prisma.apiKey.count({ where: { userId, revokedAt: null } }),
  ]);
  const lastSuccess = logins.find((l) => l.success);
  return {
    lastLogin: session.user.lastLoginAt
      ? { at: session.user.lastLoginAt, ip: session.user.lastLoginIp, device: describeUserAgent(lastSuccess?.userAgent) }
      : null,
    passwordChangedAt: session.user.passwordChangedAt,
    twoFactor: {
      enabled: !!twoFactor?.enabled,
      enabledAt: twoFactor?.enabledAt ?? null,
      backupCodesRemaining: twoFactor?.enabled ? twoFactor.backupCodes.length : 0,
    },
    activeApiKeys: apiKeys,
    sessions: sessions.map((s) => ({
      id: s.id,
      device: describeUserAgent(s.userAgent),
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      current: s.id === session.id,
    })),
    loginHistory: logins.map((l) => ({ id: l.id, at: l.createdAt, ip: l.ip, device: describeUserAgent(l.userAgent), success: l.success, reason: l.reason })),
  };
});
