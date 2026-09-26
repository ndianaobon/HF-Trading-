import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { decrypt } from "@/lib/security/crypto";
import { reviewKyc } from "@/lib/services/kyc";
import { audit } from "@/lib/services/audit";
import { actorOf } from "@/lib/api/admin";

export const GET = route({ admin: "kyc.read" }, async ({ session, params, ip }) => {
  const app = await prisma.kycApplication.findUnique({
    where: { id: params.id },
    include: { documents: true, user: { select: { id: true, email: true, profile: true, isDemo: true } }, reviewedBy: { select: { email: true } } },
  });
  if (!app) throw new AppError("NOT_FOUND");
  await audit({ actorId: session.user.id, actorEmail: session.user.email, action: "kyc.view", targetType: "KycApplication", targetId: app.id, ip });
  let idNumber = null;
  try {
    idNumber = app.idNumberEnc ? decrypt(app.idNumberEnc) : null;
  } catch {
    idNumber = null;
  }
  const { idNumberEnc: _e, ...rest } = app;
  // Masked by default; full number is only needed in exceptional reviews.
  return { ...rest, idNumberMasked: idNumber ? `${"•".repeat(Math.max(0, idNumber.length - 4))}${idNumber.slice(-4)}` : null };
});

const review = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().max(500).optional() });

export const POST = route({ admin: "kyc.review", body: review }, async ({ session, params, body, ip, userAgent }) =>
  reviewKyc(params.id, body.decision, actorOf(session, ip, userAgent), body.reason),
);
