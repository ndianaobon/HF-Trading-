import "server-only";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/errors";
import { encrypt } from "@/lib/security/crypto";
import { storeUpload } from "@/lib/storage";
import { announce, createNotification } from "@/lib/notifications/service";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { onKycApproved } from "./referrals";

export async function kycStatus(userId) {
  const latest = await prisma.kycApplication.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { documents: { select: { id: true, type: true, fileName: true, createdAt: true } } },
  });
  const req = await getSetting("kyc.requirements");
  return {
    status: latest?.status ?? "NOT_STARTED",
    application: latest
      ? {
          id: latest.id,
          submittedAt: latest.submittedAt,
          reviewedAt: latest.reviewedAt,
          rejectionReason: latest.rejectionReason,
          documents: latest.documents,
        }
      : null,
    requirements: req,
  };
}

export async function submitKyc(userId, input) {
  const current = await prisma.kycApplication.findFirst({ where: { userId, status: { in: ["PENDING", "APPROVED"] } } });
  if (current)
    throw new AppError("CONFLICT", current.status === "APPROVED" ? "Your identity is already verified." : "Your verification is already under review.");
  const req = await getSetting("kyc.requirements");
  const required = [
    ["GOVERNMENT_ID", "front of your ID"],
    ["GOVERNMENT_ID_BACK", "back of your ID"],
    ...(req.selfieRequired ? [["SELFIE", "selfie"]] : []),
  ];
  for (const [t, label] of required) {
    if (!input.files[t]) throw new AppError("VALIDATION_ERROR", `Missing document: ${label}.`);
  }
  const dob = new Date(input.dateOfBirth);
  const age = (Date.now() - dob.getTime()) / (365.25 * 86_400_000);
  if (!Number.isFinite(age) || age < 18 || age > 120) throw new AppError("VALIDATION_ERROR", "You must be at least 18 years old.");

  const stored = [];
  for (const [type, file] of Object.entries(input.files)) {
    if (!file) continue;
    const s = await storeUpload(`kyc/${userId}`, file);
    stored.push({ type, key: s.key, name: s.name, size: s.size, mime: s.type });
  }

  return prisma.kycApplication.create({
    data: {
      userId,
      status: "PENDING",
      fullName: input.fullName,
      dateOfBirth: dob,
      country: input.country,
      addressLine: input.addressLine,
      city: input.city,
      postalCode: input.postalCode ?? null,
      idType: input.idType,
      idNumberEnc: input.idNumber ? encrypt(input.idNumber) : null,
      documents: { create: stored.map((d) => ({ type: d.type, storageKey: d.key, fileName: d.name, size: d.size, mimeType: d.mime })) },
    },
  });
}

export async function reviewKyc(id, decision, actor, reason) {
  if (decision === "REJECTED" && !reason?.trim()) throw new AppError("VALIDATION_ERROR", "A rejection reason is required.");
  const res = await withTransaction(async (tx) => {
    const app = await tx.kycApplication.findUnique({ where: { id } });
    if (!app) throw new AppError("NOT_FOUND");
    if (app.status !== "PENDING") throw new AppError("CONFLICT", "This application has already been reviewed.");
    const updated = await tx.kycApplication.update({
      where: { id },
      data: { status: decision, reviewedAt: new Date(), reviewedById: actor.id, rejectionReason: decision === "REJECTED" ? reason : null },
    });
    const n = await createNotification(
      {
        userId: app.userId,
        type: "KYC_UPDATE",
        title: decision === "APPROVED" ? "Identity verification approved" : "Identity verification needs attention",
        body:
          decision === "APPROVED"
            ? "Your identity has been verified. All account features are now available."
            : `Your submission was not approved: ${reason}. You can submit a new application.`,
        link: "/dashboard/verification",
      },
      tx,
    );
    await audit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        ip: actor.ip,
        action: `kyc.${decision.toLowerCase()}`,
        targetType: "KycApplication",
        targetId: id,
        metadata: { userId: app.userId, reason },
      },
      tx,
    );
    return { updated, n };
  });
  announce(res.n);
  if (decision === "APPROVED") await onKycApproved(res.updated.userId).catch(() => {});
  return res.updated;
}

/** Admin: reset a user's verification state (e.g. documents expired). */
export async function resetKyc(userId, actor) {
  await withTransaction(async (tx) => {
    await tx.kycApplication.updateMany({
      where: { userId, status: { in: ["PENDING", "APPROVED"] } },
      data: { status: "REJECTED", rejectionReason: "Verification reset by compliance. Please resubmit.", reviewedAt: new Date(), reviewedById: actor.id },
    });
    await audit({ actorId: actor.id, actorEmail: actor.email, ip: actor.ip, action: "kyc.reset", targetType: "User", targetId: userId }, tx);
  });
}
