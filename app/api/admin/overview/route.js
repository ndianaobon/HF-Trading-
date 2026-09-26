import { route } from "@/lib/api/route";
import { overviewCards } from "@/lib/services/reports";

export const GET = route({ admin: "users.read" }, async () => overviewCards());
