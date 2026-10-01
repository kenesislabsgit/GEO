import { ImageResponse } from "next/og";
import {
  getBrandBySlug,
  getLatestScanForBrand,
  getScanRun,
  getScoreForScan,
} from "@/lib/db/repository";
import { z } from "zod";
import { EMBLEM_SEA, EMBLEM_SUN, EMBLEM_VIEW_BOX, SEA, SUN } from "@/lib/brand";
import { APP_NAME } from "@/lib/constants";
import { roundForDisplay } from "@/lib/scores/format";
import { loadSampleReport, SAMPLE_REPORT_SLUG } from "@/lib/reports/sample-report";

const size = { width: 1200, height: 630 };

export async function reportShareImage(slug: string, scanId: string | null) {
  const sample = slug === SAMPLE_REPORT_SLUG ? loadSampleReport() : null;
  const brand = sample ? null : await getBrandBySlug(slug);
  // A private report reveals nothing anywhere - including here. This image
  // URL is public and crawlable, so for a private (or missing) brand it
  // renders the generic brand card: no name, no score, no dates.
  let isPublic = Boolean(sample || (brand && brand.visibility === "public"));
  let cached = null;
  if (isPublic && brand) {
    if (scanId) {
      const scan = z.string().uuid().safeParse(scanId).success
        ? await getScanRun(scanId)
        : null;
      if (
        scan?.brand_id === brand.id &&
        ["completed", "partial"].includes(scan.status)
      ) {
        cached = { scan, score: await getScoreForScan(scan.id) };
      } else {
        isPublic = false;
      }
    } else {
      cached = await getLatestScanForBrand(brand.id);
    }
  }
  const score = sample ? sample.score.overall : cached?.score
    ? roundForDisplay(Number(cached.score.overall_score))
    : " - ";
  const mention = sample ? `${sample.score.mentionRate}%` : cached?.score
    ? `${roundForDisplay(Number(cached.score.mention_rate) * 100)}%`
    : " - ";
  const date = sample ? new Date(sample.scan.createdAt).toLocaleDateString() : cached?.scan
    ? new Date(cached.scan.created_at).toLocaleDateString()
    : "";
  const heading = sample?.brand.name ?? (isPublic && brand ? brand.name : APP_NAME);

  return new ImageResponse(
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
          <svg width={44} height={44} viewBox={EMBLEM_VIEW_BOX}>
            <path fill={SUN} d={EMBLEM_SUN} />
            <path fill={SEA} d={EMBLEM_SEA} />
          </svg>
          <div style={{ fontSize: 34, fontWeight: 600 }}>{APP_NAME}</div>
        </div>
        <div style={{ fontSize: 24, color: "#737373" }}>{date}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sample ? <div style={{ fontSize: 20, color: "#a3a3a3" }}>Sample · score uses live providers only</div> : null}
        <div style={{ fontSize: 60, fontWeight: 600, letterSpacing: -1.5 }}>
          {heading}
        </div>
        <div style={{ display: "flex", gap: 72, marginTop: 20 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 22, color: "#737373" }}>
              AI Visibility Score
            </div>
            <div style={{ fontSize: 96, fontWeight: 700, color: "#3b82f6" }}>
              {String(score)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 22, color: "#737373" }}>Mention rate</div>
            <div style={{ fontSize: 96, fontWeight: 700 }}>{mention}</div>
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}
