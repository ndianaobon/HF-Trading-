import "server-only";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/config";
import { permissionsFor } from "@/lib/auth/rbac";
import { randomBytes } from "node:crypto";

export async function toClientUser(session) {
  const u = session.user;
  const kyc = await prisma.kycApplication.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, select: { status: true } });
  return {
    id: u.id,
    email: u.email,
    firstName: u.profile?.firstName ?? "",
    lastName: u.profile?.lastName ?? "",
    country: u.profile?.country ?? "",
    emailVerified: !!u.emailVerifiedAt,
    status: u.status,
    signalStrength: u.signalStrength ?? 0,
    twoFactorEnabled: !!u.twoFactor?.enabled,
    kycStatus: kyc?.status ?? "NOT_STARTED",
    referralCode: u.referralCode,
    isDemoAccount: u.isDemo,
    demoMode: isDemoMode(),
    admin: u.adminUser?.isActive ? { role: u.adminUser.role, permissions: permissionsFor(u.adminUser.role) } : null,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function generateReferralCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (let i = 0; i < 5; i++) {
    const code = "HF" + Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
    const exists = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error("Could not allocate referral code");
}
