import { ImageResponse } from "next/og";
import { getBrandBySlug, getLatestScanForBrand } from "@/lib/db/repository";
import { APP_NAME } from "@/lib/constants";
import { roundForDisplay } from "@/lib/ai/scoring/score";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  const cached = brand
    ? await getLatestScanForBrand(brand.id)
    : null;
  const score = cached?.score
    ? roundForDisplay(Number(cached.score.overall_score))
    : "—";
  const mention = cached?.score
    ? `${roundForDisplay(Number(cached.score.mention_rate) * 100)}%`
    : "—";
  const date = cached?.scan
    ? new Date(cached.scan.created_at).toLocaleDateString()
    : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 72,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: "#fafafa",
                color: "#0a0a0a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              R
            </div>
            <div style={{ fontSize: 34, fontWeight: 600 }}>{APP_NAME}</div>
          </div>
          <div style={{ fontSize: 24, color: "#737373" }}>{date}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 60, fontWeight: 600, letterSpacing: -1.5 }}>
            {brand?.name ?? slug}
          </div>
          <div style={{ display: "flex", gap: 72, marginTop: 20 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 22, color: "#737373" }}>
                AI Visibility Score
              </div>
              <div
                style={{ fontSize: 96, fontWeight: 700, color: "#3b82f6" }}
              >
                {score}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 22, color: "#737373" }}>
                Mention rate
              </div>
              <div style={{ fontSize: 96, fontWeight: 700 }}>{mention}</div>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
