import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * Append-only audit trail. Pass `tx` so the audit record commits atomically
 * with the action it describes.
 */
export async function audit(entry, tx = prisma) {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}
