import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { can } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { getWallets } from "@/lib/trading/wallet-service";
import { revokeAllSessions } from "@/lib/auth/session";
import { resetKyc } from "@/lib/services/kyc";
import { audit } from "@/lib/services/audit";
import { notify } from "@/lib/notifications/service";
import { describeUserAgent } from "@/lib/security/request";
import { actorOf } from "@/lib/api/admin";

export const GET = route({ admin: "users.read" }, async ({ session, params, ip }) => {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      profile: true,
      adminUser: true,
      twoFactor: { select: { enabled: true, enabledAt: true } },
      kycApplications: { orderBy: { createdAt: "desc" }, include: { documents: true } },
      loginHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      referredBy: { include: { referrer: { select: { email: true } } } },
      _count: { select: { orders: true, trades: true, tickets: true, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
    },
  });
  if (!user) throw new AppError("NOT_FOUND");
  const role = session.user.adminUser?.role;
  const [wallets, transactions] = await Promise.all([
    can(role, "wallets.read") ? getWallets(user.id) : Promise.resolve(null),
    can(role, "transactions.read")
      ? prisma.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 25, include: { asset: { select: { symbol: true } } } })
      : Promise.resolve(null),
  ]);
  await audit({ actorId: session.user.id, actorEmail: session.user.email, action: "user.view", targetType: "User", targetId: user.id, ip });

  const { passwordHash: _p, ...safe } = user;
  return {
    ...safe,
    kycApplications: can(role, "kyc.read") ? user.kycApplications.map(({ idNumberEnc: _i, ...k }) => k) : [],
    loginHistory: user.loginHistory.map((l) => ({ ...l, device: describeUserAgent(l.userAgent) })),
    wallets:
      wallets
        ?.filter((w) => w.total.gt(0))
        .map((w) => ({ symbol: w.symbol, available: w.available.toString(), locked: w.locked.toString(), total: w.total.toString() })) ?? null,
    transactions,
  };
});

const actionSchema = z.object({
  action: z.enum(["suspend", "activate", "reset_kyc", "revoke_sessions", "verify_email", "unlock"]),
  reason: z.string().trim().max(500).optional(),
});

export const POST = route({ admin: "users.manage", body: actionSchema }, async ({ session, params, body, ip, userAgent }) => {
  const user = await prisma.user.findUnique({ where: { id: params.id }, include: { adminUser: true } });
  if (!user) throw new AppError("NOT_FOUND");
  if (user.id === session.user.id) throw new AppError("FORBIDDEN", "You cannot perform account actions on yourself.");
  if (user.adminUser && session.user.adminUser?.role !== "SUPER_ADMIN") throw new AppError("FORBIDDEN", "Only a super admin can manage staff accounts.");
  if ((body.action === "suspend" || body.action === "reset_kyc") && !body.reason)
    throw new AppError("VALIDATION_ERROR", "A reason is required for this action.");
  const actor = actorOf(session, ip, userAgent);

  switch (body.action) {
    case "suspend":
      await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
      await revokeAllSessions(user.id);
      break;
    case "activate":
      await prisma.user.update({ where: { id: user.id }, data: { status: user.emailVerifiedAt ? "ACTIVE" : "PENDING_VERIFICATION" } });
      break;
    case "reset_kyc":
      await resetKyc(user.id, actor);
      await notify({
        userId: user.id,
        type: "KYC_UPDATE",
        title: "Identity verification reset",
        body: "Please resubmit your verification documents.",
        link: "/dashboard/verification",
      });
      break;
    case "revoke_sessions":
      await revokeAllSessions(user.id);
      break;
    case "verify_email":
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date(), status: user.status === "PENDING_VERIFICATION" ? "ACTIVE" : user.status },
      });
      break;
    case "unlock":
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: null, failedLoginCount: 0 } });
      break;
  }
  if (body.action !== "reset_kyc") {
    await audit({
      actorId: actor.id,
      actorEmail: actor.email,
      ip,
      userAgent,
      action: `user.${body.action}`,
      targetType: "User",
      targetId: user.id,
      metadata: { reason: body.reason },
    });
  }
  return { ok: true };
});
