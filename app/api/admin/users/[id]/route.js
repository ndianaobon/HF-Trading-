import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { can } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { getWallets } from "@/lib/trading/wallet-service";
import { getPortfolio } from "@/lib/trading/portfolio-service";
import { revokeAllSessions } from "@/lib/auth/session";
import { resetKyc } from "@/lib/services/kyc";
import { audit } from "@/lib/services/audit";
import { notify } from "@/lib/notifications/service";
import { describeUserAgent } from "@/lib/security/request";
import { actorOf } from "@/lib/api/admin";
import { issueToken } from "@/lib/auth/tokens";
import { emails } from "@/lib/email/mailer";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { profileSchema } from "@/lib/validation/schemas";

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
  const [wallets, transactions, portfolio] = await Promise.all([
    can(role, "wallets.read") ? getWallets(user.id) : Promise.resolve(null),
    can(role, "transactions.read")
      ? prisma.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 25, include: { asset: { select: { symbol: true } } } })
      : Promise.resolve(null),
    can(role, "wallets.read") ? getPortfolio(user.id).catch(() => null) : Promise.resolve(null),
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
    balance: portfolio ? { totalValue: portfolio.totalValue, available: portfolio.availableBalance } : null,
    canAdjustBalance: can(role, "balances.adjust"),
  };
});

const actionSchema = z.object({
  action: z.enum(["suspend", "ban", "activate", "set_status", "set_signal", "reset_kyc", "revoke_sessions", "verify_email", "unlock", "send_password_reset"]),
  reason: z.string().trim().max(500).optional(),
  status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "BANNED", "CLOSED"]).optional(),
  signalStrength: z.coerce.number().int().min(0).max(100).optional(),
});

export const POST = route({ admin: "users.manage", body: actionSchema }, async ({ session, params, body, ip, userAgent }) => {
  const user = await prisma.user.findUnique({ where: { id: params.id }, include: { adminUser: true } });
  if (!user) throw new AppError("NOT_FOUND");
  if (user.id === session.user.id) throw new AppError("FORBIDDEN", "You cannot perform account actions on yourself.");
  if (user.adminUser && session.user.adminUser?.role !== "SUPER_ADMIN") throw new AppError("FORBIDDEN", "Only a super admin can manage staff accounts.");
  if (["suspend", "ban", "reset_kyc"].includes(body.action) && !body.reason)
    throw new AppError("VALIDATION_ERROR", "A reason is required for this action.");
  if (body.action === "set_status" && !body.status) throw new AppError("VALIDATION_ERROR", "Choose a status.");
  if (body.action === "set_signal" && body.signalStrength === undefined) throw new AppError("VALIDATION_ERROR", "Enter a signal strength between 0 and 100.");
  const actor = actorOf(session, ip, userAgent);

  switch (body.action) {
    case "suspend":
      await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
      await revokeAllSessions(user.id);
      break;
    case "ban":
      await prisma.user.update({ where: { id: user.id }, data: { status: "BANNED" } });
      await revokeAllSessions(user.id);
      break;
    case "send_password_reset": {
      if (user.status === "BANNED" || user.status === "CLOSED") throw new AppError("CONFLICT", "Reactivate the account before sending a reset link.");
      await enforceRateLimit(RATE_LIMITS.emailSend, `reset:${user.id}`);
      const token = await issueToken(user.id, "PASSWORD_RESET");
      await emails.passwordReset(user.email, token);
      await notify({
        userId: user.id,
        type: "SECURITY_ALERT",
        title: "Password reset link sent",
        body: "Our support team sent a password reset link to your email. If you didn't ask for this, contact support.",
      });
      break;
    }
    case "activate":
      await prisma.user.update({ where: { id: user.id }, data: { status: user.emailVerifiedAt ? "ACTIVE" : "PENDING_VERIFICATION" } });
      break;
    case "set_status":
      await prisma.user.update({ where: { id: user.id }, data: { status: body.status } });
      if (["SUSPENDED", "BANNED", "CLOSED"].includes(body.status)) await revokeAllSessions(user.id);
      break;
    case "set_signal":
      await prisma.user.update({ where: { id: user.id }, data: { signalStrength: body.signalStrength } });
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
      metadata: { reason: body.reason, from: body.action === "set_status" ? user.status : body.action === "set_signal" ? user.signalStrength : undefined, to: body.status ?? body.signalStrength },
    });
  }
  return { ok: true };
});

const PROFILE_FIELDS = ["firstName", "lastName", "phone", "country", "city", "addressLine", "postalCode", "timezone"];

export const PATCH = route(
  { admin: "users.manage", body: profileSchema.partial().extend({ reason: z.string().trim().min(3).max(500) }) },
  async ({ session, params, body, ip, userAgent }) => {
    const user = await prisma.user.findUnique({ where: { id: params.id }, include: { adminUser: true, profile: true } });
    if (!user) throw new AppError("NOT_FOUND");
    if (user.adminUser && session.user.adminUser?.role !== "SUPER_ADMIN") throw new AppError("FORBIDDEN", "Only a super admin can manage staff accounts.");

    const { reason, ...fields } = body;
    const next = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === "" ? null : v]));
    const changes = Object.fromEntries(
      PROFILE_FIELDS.filter((k) => k in next && (user.profile?.[k] ?? null) !== next[k]).map((k) => [k, { from: user.profile?.[k] ?? null, to: next[k] }]),
    );
    if (!Object.keys(changes).length) return { ok: true, changed: 0 };

    if (user.profile) {
      await prisma.profile.update({ where: { userId: user.id }, data: next });
    } else {
      const full = profileSchema.parse(fields);
      await prisma.profile.create({ data: { userId: user.id, ...Object.fromEntries(Object.entries(full).map(([k, v]) => [k, v === "" ? null : v])) } });
    }
    await audit({ actorId: session.user.id, actorEmail: session.user.email, ip, userAgent, action: "user.edit_profile", targetType: "User", targetId: user.id, metadata: { reason, changes } });
    await notify({
      userId: user.id,
      type: "SECURITY_ALERT",
      title: "Your profile was updated",
      body: `Our support team updated: ${Object.keys(changes).join(", ")}. Contact support if this wasn't requested.`,
      link: "/dashboard/settings",
    });
    return { ok: true, changed: Object.keys(changes).length };
  },
);
