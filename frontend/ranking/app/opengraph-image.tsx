import { ImageResponse } from "next/og";
import {
  EMBLEM_SEA,
  EMBLEM_SUN,
  EMBLEM_VIEW_BOX,
  SEA,
  SUN,
} from "@/lib/brand";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

export const alt = `${APP_NAME} - ${APP_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
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
          background: "#0a0a0a",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width={56} height={56} viewBox={EMBLEM_VIEW_BOX}>
            <path fill={SUN} d={EMBLEM_SUN} />
            <path fill={SEA} d={EMBLEM_SEA} />
          </svg>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            AI visibility report
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 88, fontWeight: 700 }}>
            {APP_NAME}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 20,
              fontSize: 40,
              color: "rgba(255,255,255,0.65)",
            }}
          >
            {APP_TAGLINE}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "rgba(255,255,255,0.4)",
          }}
        >
          Sampled from ChatGPT, Claude, Gemini, Perplexity and more
        </div>
      </div>
    ),
    size,
  );
}
