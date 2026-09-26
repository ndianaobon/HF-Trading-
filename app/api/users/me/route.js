import { route } from "@/lib/api/route";
import { profileSchema, preferencesSchema } from "@/lib/validation/schemas";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

export const GET = route({ auth: "user" }, async ({ session }) => {
  const p = session.user.profile;
  return {
    email: session.user.email,
    emailVerified: !!session.user.emailVerifiedAt,
    profile: p
      ? {
          firstName: p.firstName,
          lastName: p.lastName,
          phone: p.phone ?? "",
          country: p.country,
          city: p.city ?? "",
          addressLine: p.addressLine ?? "",
          postalCode: p.postalCode ?? "",
          timezone: p.timezone ?? "",
          preferences: p.preferences,
        }
      : null,
  };
});

const patchSchema = z.object({ profile: profileSchema.optional(), preferences: preferencesSchema.optional() });

export const PATCH = route({ auth: "user", body: patchSchema }, async ({ session, body }) => {
  const current = session.user.profile?.preferences ?? {};
  const prefs = body.preferences
    ? {
        ...current,
        ...body.preferences,
        notifications: { ...(current.notifications ?? {}), ...(body.preferences.notifications ?? {}), security: true },
      }
    : current;
  await prisma.profile.update({
    where: { userId: session.user.id },
    data: {
      ...(body.profile
        ? {
            firstName: body.profile.firstName,
            lastName: body.profile.lastName,
            phone: body.profile.phone || null,
            country: body.profile.country,
            city: body.profile.city || null,
            addressLine: body.profile.addressLine || null,
            postalCode: body.profile.postalCode || null,
            timezone: body.profile.timezone || null,
          }
        : {}),
      preferences: prefs,
    },
  });
  return { saved: true };
});
