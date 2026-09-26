import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
  staff: z.enum(["true", "false"]).optional(),
  ...paginationSchema,
});

export const GET = route({ admin: "users.read", query }, async ({ query }) => {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.staff === "true" ? { adminUser: { isNot: null } } : query.staff === "false" ? { adminUser: null } : {}),
    ...(query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: "insensitive" } },
            { id: query.q },
            { referralCode: { equals: query.q.toUpperCase() } },
            { profile: { OR: [{ firstName: { contains: query.q, mode: "insensitive" } }, { lastName: { contains: query.q, mode: "insensitive" } }] } },
          ],
        }
      : {}),
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        profile: { select: { firstName: true, lastName: true, country: true } },
        adminUser: { select: { role: true } },
        kycApplications: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
        twoFactor: { select: { enabled: true } },
      },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.user.count({ where }),
  ]);
  const items = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: `${u.profile?.firstName ?? ""} ${u.profile?.lastName ?? ""}`.trim(),
    country: u.profile?.country ?? null,
    status: u.status,
    emailVerified: !!u.emailVerifiedAt,
    kycStatus: u.kycApplications[0]?.status ?? "NOT_STARTED",
    twoFactor: !!u.twoFactor?.enabled,
    adminRole: u.adminUser?.role ?? null,
    isDemo: u.isDemo,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  }));
  return pageResult(items, total, query.page, query.pageSize);
});
