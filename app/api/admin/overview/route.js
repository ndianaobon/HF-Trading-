import { route } from "@/lib/api/route";
import { can } from "@/lib/auth/rbac";
import { overviewCards, recentActivity } from "@/lib/services/reports";

export const GET = route({ admin: "users.read" }, async ({ session }) => {
  const role = session.user.adminUser?.role;
  const [cards, activity] = await Promise.all([overviewCards(), recentActivity((p) => can(role, p))]);
  return { ...cards, activity };
});
