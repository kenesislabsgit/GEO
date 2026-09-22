import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/constants";
import { EMBLEM_SEA, EMBLEM_SUN, EMBLEM_VIEW_BOX, SEA, SUN } from "@/lib/brand";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim();
  const description = params.get("description")?.trim();
  if (
    !title ||
    title.length > 160 ||
    !description ||
    description.length > 350
  ) {
    return new Response("Invalid preview", { status: 400 });
  }
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#f7f5f0",
        color: "#151515",
        padding: "56px 66px",
        fontFamily: "sans-serif",
        borderBottom: "12px solid #fd5001",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <svg width="46" height="46" viewBox={EMBLEM_VIEW_BOX}>
          <path fill={SUN} d={EMBLEM_SUN} />
          <path fill={SEA} d={EMBLEM_SEA} />
        </svg>
        <span style={{ fontSize: 30, fontWeight: 700 }}>{APP_NAME}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            fontSize: title.length > 90 ? 46 : 58,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: "-2px",
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 24, color: "#55534f", lineHeight: 1.4 }}>
          {description}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 20, color: "#66625e" }}>
        arcanoris.in · AI visibility, explained
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
    },
  );
}
