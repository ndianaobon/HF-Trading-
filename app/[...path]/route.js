import { servePage } from "@/lib/views/serve-page";

export const dynamic = "force-dynamic";

export function GET(req) {
  return servePage(req);
}
