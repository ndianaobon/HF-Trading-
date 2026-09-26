import { z } from "zod";
import QRCode from "qrcode";
import { route } from "@/lib/api/route";

const query = z.object({ data: z.string().min(1).max(256) });

/** Renders a QR code (PNG) for deposit addresses. Authenticated users only. */
export const GET = route({ auth: "user", query }, async ({ query }) => {
  const png = await QRCode.toBuffer(query.data, { margin: 1, width: 240, color: { dark: "#0B1220", light: "#FFFFFF" } });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
});
