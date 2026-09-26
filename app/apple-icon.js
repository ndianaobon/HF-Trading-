import { ImageResponse } from "next/og";
import { ICON_SQUARE_SVG, svgDataUri } from "@/lib/brand/logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Full-bleed square icon; iOS applies its own rounded mask. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the browser */}
        <img src={svgDataUri(ICON_SQUARE_SVG)} width={180} height={180} alt="" />
      </div>
    ),
    size,
  );
}
