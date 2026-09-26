import "server-only";
import { prisma } from "@/lib/db/prisma";
import { publish } from "@/lib/realtime/bus";

/** Maps notification types to user preference keys. Unlisted types (security, KYC, support) are always delivered. */
const PREF_KEY = {
  TRADE_EXECUTED: "trades",
  DEPOSIT_RECEIVED: "deposits",
  WITHDRAWAL_STATUS: "withdrawals",
  INVESTMENT_UPDATE: "investments",
  SYSTEM_ANNOUNCEMENT: "announcements",
};

function wants(preferences, type) {
  const key = PREF_KEY[type];
  if (!key) return true;
  const n = preferences?.notifications;
  return n?.[key] !== false;
}

/**
 * NotificationService. Respects the user's notification preferences. When
 * called inside a DB transaction pass `tx`, then call `announce()` with the
 * result after the transaction commits.
 */
export async function createNotification(input, tx = prisma) {
  if (PREF_KEY[input.type]) {
    const profile = await tx.profile.findUnique({ where: { userId: input.userId }, select: { preferences: true } });
    if (!wants(profile?.preferences, input.type)) return null;
  }
  return tx.notification.create({ data: { ...input, link: input.link ?? null } });
}

export function announce(n) {
  if (n) publish(n.userId, { type: "notification.created", id: n.id, title: n.title });
}

export async function notify(input) {
  const n = await createNotification(input);
  announce(n);
  return n;
}

export async function broadcastAnnouncement(title, body, link) {
  const users = (await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, profile: { select: { preferences: true } } } })).filter((u) =>
    wants(u.profile?.preferences, "SYSTEM_ANNOUNCEMENT"),
  );
  const chunk = 1000;
  for (let i = 0; i < users.length; i += chunk) {
    await prisma.notification.createMany({
      data: users.slice(i, i + chunk).map((u) => ({ userId: u.id, type: "SYSTEM_ANNOUNCEMENT", title, body, link: link ?? null })),
    });
  }
  for (const u of users) publish(u.id, { type: "notification.created", id: "broadcast", title });
  return users.length;
}
