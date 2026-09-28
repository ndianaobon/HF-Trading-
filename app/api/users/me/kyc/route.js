import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { kycSchema } from "@/lib/validation/schemas";
import { kycStatus, submitKyc } from "@/lib/services/kyc";

export const GET = route({ auth: "user" }, async ({ session }) => kycStatus(session.user.id));

/** Multipart submission: fields + GOVERNMENT_ID (front), GOVERNMENT_ID_BACK and optional SELFIE files. */
export const POST = route({ auth: "verified", rateLimit: RATE_LIMITS.money }, async ({ session, req }) => {
  let form;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid upload.");
  }
  const fields = kycSchema.parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  const files = {};
  for (const t of ["GOVERNMENT_ID", "GOVERNMENT_ID_BACK", "SELFIE"]) {
    const f = form.get(t);
    if (f instanceof File && f.size > 0) files[t] = f;
  }
  const app = await submitKyc(session.user.id, { ...fields, files });
  return { id: app.id, status: app.status };
});
