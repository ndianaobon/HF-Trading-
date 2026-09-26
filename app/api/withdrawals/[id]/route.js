import { route } from "@/lib/api/route";
import { cancelWithdrawalByUser } from "@/lib/payments/withdrawal-service";

export const DELETE = route({ auth: "user" }, async ({ session, params }) => {
  const w = await cancelWithdrawalByUser(session.user.id, params.id);
  return { id: w.id, status: w.status };
});
