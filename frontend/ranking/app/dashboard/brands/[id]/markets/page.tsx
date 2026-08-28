import Link from "next/link";
import { notFound } from "next/navigation";
import { Globe, Lock } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getPrompts,
  getQueryResults,
} from "@/lib/db/repository";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { MarketRadar } from "@/components/dashboard/market-radar";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export const metadata = { title: "Markets" };

const CONTINENTS = [
  "Asia",
  "Europe",
  "North America",
  "South America",
  "Africa",
  "Oceania",
] as const;

const CONTINENT_BY_COUNTRY: Record<string, (typeof CONTINENTS)[number]> = {
  in: "Asia", jp: "Asia", sg: "Asia", cn: "Asia", kr: "Asia", id: "Asia",
  th: "Asia", my: "Asia", vn: "Asia", ph: "Asia", pk: "Asia", bd: "Asia",
  sa: "Asia", ae: "Asia", il: "Asia", tr: "Asia",
  gb: "Europe", de: "Europe", fr: "Europe", es: "Europe", it: "Europe",
  nl: "Europe", se: "Europe", ch: "Europe", pl: "Europe", ie: "Europe",
  pt: "Europe", be: "Europe", at: "Europe", dk: "Europe", no: "Europe",
  fi: "Europe",
  us: "North America", ca: "North America", mx: "North America",
  br: "South America", ar: "South America", cl: "South America",
  co: "South America",
  za: "Africa", ng: "Africa", ke: "Africa", eg: "Africa",
  au: "Oceania", nz: "Oceania",
};

/** ISO code → flag emoji via regional indicator symbols. */
function flagOf(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return "🌐";
  return String.fromCodePoint(
    ...[...upper].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}

export default async function MarketsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();

  const [entitlements, trackedPrompts, latestScan] = await Promise.all([
    getAccountEntitlements(user.id),
    getPrompts(brand.id),
    getLatestCompletedScanForBrand(brand.id),
  ]);
  const isPaid = isPaidSubscription(entitlements);
  const geoEnabled = PLAN_CONFIG[entitlements.plan].features.geoMarketSearch;
  const results = latestScan ? await getQueryResults(latestScan.id) : [];

  // Geo prompts carry their market's country code and name; everything else
  // imports as country "global" (legacy rows: "us" with no market name).
  const geoPrompts = trackedPrompts.filter(
    (prompt) => prompt.rationale && prompt.country && prompt.country !== "global",
  );
  const geoIds = new Set(geoPrompts.map((prompt) => prompt.id));
  const globalResults = results.filter(
    (result) =>
      result.tracked_prompt_id && !geoIds.has(result.tracked_prompt_id),
  );
  const globalRate = globalResults.length
    ? Math.round(
        (100 * globalResults.filter((r) => r.brand_mentioned).length) /
          globalResults.length,
      )
    : 0;

  // Per-country rollup across every provider's answers.
  const byCountry = new Map<
    string,
    { name: string; mentioned: number; total: number; questions: string[] }
  >();
  for (const prompt of geoPrompts) {
    const rows = results.filter((r) => r.tracked_prompt_id === prompt.id);
    const entry = byCountry.get(prompt.country) ?? {
      name: prompt.rationale ?? prompt.country.toUpperCase(),
      mentioned: 0,
      total: 0,
      questions: [],
    };
    entry.mentioned += rows.filter((r) => r.brand_mentioned).length;
    entry.total += rows.length;
    entry.questions.push(prompt.prompt);
    byCountry.set(prompt.country, entry);
  }
  const countries = Array.from(byCountry.entries())
    .map(([code, entry]) => ({
      code,
      ...entry,
      rate: entry.total ? Math.round((100 * entry.mentioned) / entry.total) : 0,
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.rate - a.rate || b.mentioned - a.mentioned);
  const best = countries.find((entry) => entry.mentioned > 0) ?? null;

  // Continent rollup for the radar - fixed axes so the shape stays readable.
  const radarData = CONTINENTS.map((continent) => {
    const rows = countries.filter(
      (entry) => CONTINENT_BY_COUNTRY[entry.code] === continent,
    );
    const total = rows.reduce((sum, entry) => sum + entry.total, 0);
    const mentioned = rows.reduce((sum, entry) => sum + entry.mentioned, 0);
    return {
      continent,
      rate: total ? Math.round((100 * mentioned) / total) : 0,
    };
  });

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Markets"
        description="Where AI recommends you when buyers ask with their country in the question - measured across world markets, web search located per country."
        isPaid={isPaid}
      />

      {!geoEnabled ? (
        <div className="arc-panel flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Lock className="size-4 text-muted-foreground" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold">
                Geographic market search is on Pro and Growth
              </h2>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                Pro and Growth audits ask up to half their questions the way buyers in
                India, the US, Europe and other markets would - with web search
                located in each country - and map where you get recommended.
              </p>
            </div>
          </div>
          <Button asChild size="sm">
            <Link
              href={routes.billing({
                plan: "agency",
                returnTo: routes.brandSection(brand.id, "markets"),
              })}
            >
              Upgrade to Pro
            </Link>
          </Button>
        </div>
      ) : countries.length === 0 ? (
        <div className="arc-empty p-10 text-center">
          <Globe className="mx-auto size-5 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-medium">No market answers yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Run an audit - Pro and Growth audits spread a slice of their questions across
            world markets automatically. Pick a home market in audit settings
            to lead the sweep.
          </p>
          <Button asChild size="sm" className="mt-5">
            <Link href={routes.newScan(brand.id)}>Run an audit</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* One hairline band: the headline market facts. */}
          <section className="arc-panel grid grid-cols-2 gap-y-5 p-5 lg:grid-cols-4 lg:gap-y-0 lg:divide-x lg:divide-border">
            <div className="lg:pr-5">
              <p className="arc-eyebrow">Recommended most in</p>
              <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight">
                {best ? `${flagOf(best.code)} ${best.name}` : " -  nowhere yet"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {best
                  ? `mentioned in ${best.mentioned} of ${best.total} answers`
                  : "absent from every market answer"}
              </p>
            </div>
            <div className="lg:px-5">
              <p className="arc-eyebrow">Markets tested</p>
              <p className="arc-tabular mt-1.5 text-2xl font-semibold tracking-tight">
                {countries.length}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                one country per question set
              </p>
            </div>
            <div className="lg:px-5">
              <p className="arc-eyebrow">Market answers</p>
              <p className="arc-tabular mt-1.5 text-2xl font-semibold tracking-tight">
                {countries.reduce((sum, entry) => sum + entry.total, 0)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                across all providers
              </p>
            </div>
            <div className="lg:pl-5">
              <p className="arc-eyebrow">Global mention rate</p>
              <p className="arc-tabular mt-1.5 text-2xl font-semibold tracking-tight">
                {globalRate}%
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                non-located questions, for comparison
              </p>
            </div>
          </section>

          <div className="grid items-start gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            {/* Continent radar */}
            <section className="arc-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <h2 className="text-sm font-medium">Visibility by continent</h2>
                <p className="font-mono text-[11px] text-muted-foreground">
                  mention rate %
                </p>
              </div>
              <div className="p-5">
                <MarketRadar data={radarData} />
              </div>
            </section>

            {/* Country leaderboard */}
            <section className="arc-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <h2 className="text-sm font-medium">By country</h2>
                <p className="text-xs text-muted-foreground">
                  every provider&rsquo;s answers to that country&rsquo;s questions
                </p>
              </div>
              <div className="divide-y divide-border">
                {countries.map((entry) => (
                  <div key={entry.code} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <span aria-hidden>{flagOf(entry.code)}</span>
                        <span className="truncate">{entry.name}</span>
                      </p>
                      <p className="arc-tabular shrink-0 font-mono text-xs text-muted-foreground">
                        {entry.mentioned}/{entry.total} ·{" "}
                        <span
                          className={
                            entry.rate > 0
                              ? "font-semibold text-foreground"
                              : ""
                          }
                        >
                          {entry.rate}%
                        </span>
                      </p>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-[color:var(--arc-accent)]"
                        style={{ width: `${Math.max(entry.rate, 2)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* The exact questions each market was asked. */}
          <section className="arc-panel overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-medium">Market questions</h2>
            </div>
            <div className="divide-y divide-border">
              {geoPrompts.map((prompt) => {
                const rows = results.filter(
                  (r) => r.tracked_prompt_id === prompt.id,
                );
                const mentioned = rows.filter((r) => r.brand_mentioned).length;
                return (
                  <div
                    key={prompt.id}
                    className="flex items-center justify-between gap-3 px-5 py-2.5"
                  >
                    <p className="min-w-0 truncate text-sm">
                      <span aria-hidden className="mr-2">
                        {flagOf(prompt.country)}
                      </span>
                      {prompt.prompt}
                    </p>
                    <span
                      className={`arc-chip shrink-0 ${
                        mentioned > 0
                          ? "text-[color:var(--arc-green)]"
                          : "text-muted-foreground"
                      }`}
                    >
                      {mentioned > 0
                        ? `Mentioned ${mentioned}/${rows.length}`
                        : "Absent"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
