import { route } from "@/lib/api/route";
import { getOrderBook } from "@/lib/market-data/service";

export const GET = route({ auth: "none" }, async ({ params }) => getOrderBook(params.symbol, 20));
