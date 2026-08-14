import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { assertCanExport, EntitlementError } from "@/lib/billing/entitlements";
import {
  assertBrandOwnership,
  BrandAccessError,
} from "@/lib/prompts/access";
import {
  getCompetitors,
  getLatestCompletedScanForBrand,
  getPrompts,
  getQueryResults,
  getRecommendations,
  scoresForBrand,
} from "@/lib/db/repository";

const EXPORT_TYPES = [
  "questions",
  "citations",
  "competitors",
  "scores",
  "actions",
] as const;

type ExportType = (typeof EXPORT_TYPES)[number];

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: string[][]): string {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ];
  return lines.join("\n");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: brandId } = await context.params;
  const type = new URL(request.url).searchParams.get("type") as ExportType | null;

  if (!type || !EXPORT_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${EXPORT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const brand = await assertBrandOwnership(brandId, user.id);
    const entitlements = await getAccountEntitlements(user.id);
    assertCanExport(entitlements);

    const filename = `${brand.slug}-${type}.csv`;
    let csv = "";

    if (type === "questions") {
      const prompts = await getPrompts(brandId);
      csv = toCsv(
        ["prompt", "type", "buyer_stage", "country", "language", "active", "custom"],
        prompts.map((p) => [
          p.prompt,
          p.prompt_type,
          p.buyer_stage,
          p.country,
          p.language,
          p.active ? "yes" : "no",
          p.is_custom ? "yes" : "no",
        ]),
      );
    } else if (type === "competitors") {
      const competitors = await getCompetitors(brandId);
      csv = toCsv(
        ["name", "domain"],
        competitors.map((c) => [c.name, c.domain ?? ""]),
      );
    } else if (type === "scores") {
      const scores = await scoresForBrand(brandId);
      csv = toCsv(
        [
          "date",
          "overall_score",
          "mention_rate",
          "average_position",
          "share_of_voice",
          "citation_score",
        ],
        scores.map((s) => [
          s.created_at,
          String(s.overall_score),
          String(s.mention_rate),
          s.average_position == null ? "" : String(s.average_position),
          String(s.share_of_voice),
          String(s.citation_score),
        ]),
      );
    } else if (type === "actions") {
      const actions = await getRecommendations(brandId);
      csv = toCsv(
        ["title", "status", "priority", "action_type", "explanation"],
        actions.map((a) => [
          a.title,
          a.status,
          String(a.priority),
          a.action_type,
          a.explanation,
        ]),
      );
    } else if (type === "citations") {
      const scan = await getLatestCompletedScanForBrand(brandId);
      if (!scan) {
        csv = toCsv(["url", "title", "domain", "provider", "supports_brand"], []);
      } else {
        const results = await getQueryResults(scan.id);
        const rows: string[][] = [];
        for (const result of results) {
          const citations =
            (result.citations as Array<{
              url: string;
              title?: string | null;
              domain?: string | null;
              citedForBrand?: boolean;
            }>) ?? [];
          for (const c of citations) {
            rows.push([
              c.url,
              c.title ?? "",
              c.domain ?? "",
              result.provider,
              c.citedForBrand ? "yes" : "no",
            ]);
          }
        }
        csv = toCsv(
          ["url", "title", "domain", "provider", "supports_brand"],
          rows,
        );
      }
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof EntitlementError) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    throw error;
  }
}
