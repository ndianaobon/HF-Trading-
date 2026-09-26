import { route } from "@/lib/api/route";
import { getNews } from "@/lib/news/service";

/** Latest market headlines from configured publisher RSS feeds (headline + link only). */
export const GET = route({ auth: "none" }, async () => getNews());
