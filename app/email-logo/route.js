import { ImageResponse } from "next/og";
import { LOGO_DARK_SVG, LOGO_SIZE, svgDataUri } from "@/lib/brand/logo";

/**
 * PNG logo for emails (Gmail and Outlook don't display SVG). Rendered at 2× for
 * sharp display, on the dark header colour used by the email template.
 */
export async function GET() {
  const w = LOGO_SIZE.width * 2;
  const h = LOGO_SIZE.height * 2;
  const res = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0B0E11" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the browser */}
        <img src={svgDataUri(LOGO_DARK_SVG)} width={w} height={h} alt="" />
      </div>
    ),
    { width: w, height: h },
  );
  res.headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  return res;
}
