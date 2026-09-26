import fs from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_YELLOW, LOGO_DARK_SVG, LOGO_SIZE, svgDataUri } from "@/lib/brand/logo";

export const alt = "HarborFinance Trading — Trade Smarter. Manage Your Digital Assets.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO_HEIGHT = 96;

export default async function OpengraphImage() {
  const black = await fs.readFile(path.join(process.cwd(), "lib/brand/Montserrat-Black.ttf"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#050505",
          backgroundImage: "radial-gradient(circle at 85% 0%, rgba(244,190,44,0.22), transparent 45%)",
          color: "#fff",
          fontFamily: "Montserrat",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the browser */}
        <img src={svgDataUri(LOGO_DARK_SVG)} height={LOGO_HEIGHT} width={Math.round((LOGO_SIZE.width / LOGO_SIZE.height) * LOGO_HEIGHT)} alt="" />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 62, lineHeight: 1.1, letterSpacing: -1 }}>Trade Smarter.</div>
          <div style={{ fontSize: 62, lineHeight: 1.1, letterSpacing: -1, color: BRAND_YELLOW }}>Manage Your Digital Assets.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: "#A3A3AB" }}>
          <div style={{ width: 48, height: 4, background: BRAND_YELLOW }} />
          Live markets · Portfolio analytics · Secure account management
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Montserrat", data: black, weight: 900, style: "normal" }] },
  );
}
