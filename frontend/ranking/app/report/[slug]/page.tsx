import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  ExternalLink,
  Lightbulb,
  Link2,
} from "lucide-react";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShareControls } from "@/components/report/share-controls";
import { PrintReportButton } from "@/components/report/print-report-button";
import { getAccountEntitlements } from "@/lib/billing/account";
import { hasFeature } from "@/lib/billing/entitlements";
import { ScoreRing } from "@/components/report/score-ring";
import {
  getBrandBySlug,
  getLatestScanForBrand,
  getPrompts,
  getQueryResults,
  getRecommendations,
  getScoreForScan,
} from "@/lib/db/repository";
import { toPublicReportDTO, type PublicReportDTO } from "@/lib/reports/public-dto";
import { APP_NAME, providerDisplayName } from "@/lib/constants";
import { getSessionUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";

function ordinal(position: number): string {
  const suffix =
    position % 100 >= 11 && position % 100 <= 13
      ? "th"
      : ["th", "st", "nd", "rd"][position % 10] ?? "th";
  return `${position}${suffix}`;
}

async function loadReport(
  slug: string,
  options?: { allowPrivate?: boolean },
): Promise<PublicReportDTO | null> {
  const brand = await getBrandBySlug(slug);
  if (!brand) return null;
  // A private report stays reachable for its owner - the dashboard links
  // straight here, and locking the owner out of their own report would make
  // the visibility toggle feel like deletion.
  if (brand.visibility !== "public" && !options?.allowPrivate) return null;

  // Resolve by brand record, not by domain: several people can have their own
  // audit of the same website, and this link belongs to exactly one of them.
  const cached = await getLatestScanForBrand(brand.id);
  if (!cached) return null;

  const [prompts, results, score, recommendations] = await Promise.all([
    getPrompts(brand.id),
    getQueryResults(cached.scan.id),
    getScoreForScan(cached.scan.id),
    getRecommendations(brand.id),
  ]);

  return toPublicReportDTO({
    brand,
    scan: cached.scan,
    score: score ?? cached.score,
    prompts,
    results,
    recommendations: recommendations.filter(
      (r) => r.scan_run_id === cached.scan.id,
    ),
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const report = await loadReport(slug);
  if (!report) {
    return { title: "Report not found", robots: { index: false } };
  }
  return {
    title: `${report.brand.name} AI Visibility Report`,
    description: `${report.brand.name} scored ${report.score.overall} on ${APP_NAME}. Mention rate ${report.score.mentionRate}%.`,
    openGraph: {
      title: `${report.brand.name} · Score ${report.score.overall}`,
      description: `Mention rate ${report.score.mentionRate}% · ${APP_NAME}`,
    },
  };
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const user = await getSessionUser();
  const isOwner = user?.id === brand.owner_id;
  if (brand.visibility === "private" && !isOwner) notFound();

  const report = await loadReport(slug, { allowPrivate: isOwner });

  if (!report) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl flex-1 px-4 py-24 text-center">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Report unavailable
          </h1>
          <p className="mt-3 text-muted-foreground">
            No completed public audit was found for this website yet.
          </p>
          <Button asChild className="mt-8">
            <Link
              href={
                (await getSessionUser())
                  ? routes.newScan()
                  : routes.freeAuditSignup
              }
            >
              Run a free audit
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </main>
        <SiteFooter />
      </>
    );
  }

  const mentionedCount = report.promptMatrix.filter((r) => r.mentioned).length;
  const canPrintPdf =
    isOwner && user
      ? hasFeature((await getAccountEntitlements(user.id)).plan, "pdfCsvExport")
      : false;

  return (
    <>
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="flex-1">
        {/* Score header */}
        <section className="relative overflow-hidden border-b border-border bg-[color:var(--rb-ink)]">
          <div className="rb-grid-dark absolute inset-0 [mask-image:radial-gradient(ellipse_70%_80%_at_50%_0%,black,transparent)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-[color:var(--rb-accent)] text-white hover:bg-[color:var(--rb-accent)]">
                {brand.visibility === "private"
                  ? "Private report"
                  : "Public report"}
              </Badge>
              {report.scan.demoMode ? (
                <Badge
                  variant="outline"
                  className="rounded-full border-[color:var(--rb-amber)]/40 text-[color:var(--rb-amber)]"
                >
                  Demo fixtures
                </Badge>
              ) : null}
              {report.scan.confidence === "low" ? (
                <Badge
                  variant="outline"
                  className="rounded-full border-[color:var(--rb-amber)]/40 text-[color:var(--rb-amber)]"
                >
                  Limited evidence
                </Badge>
              ) : null}
              <span className="text-xs text-white/50">
                Scanned {new Date(report.scan.createdAt).toLocaleDateString()} ·
                methodology {report.scan.methodologyVersion}
              </span>
            </div>

            <div className="mt-8 flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-semibold tracking-tight text-white md:text-5xl">
                  {report.brand.name}
                </h1>
                <p className="mt-2 font-mono text-sm text-white/50">
                  {report.brand.domain}
                  {report.brand.category ? ` · ${report.brand.category}` : ""}
                </p>
                <div className="mt-8 grid grid-cols-3 gap-8">
                  <div>
                    <p className="text-[11px] font-medium tracking-wide text-white/50 uppercase">
                      Mention rate
                    </p>
                    <p className="mt-1 text-3xl font-semibold text-white md:text-4xl">
                      {report.score.mentionRate}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium tracking-wide text-white/50 uppercase">
                      Avg position
                    </p>
                    <p className="mt-1 text-3xl font-semibold text-white md:text-4xl">
                      {report.score.averagePosition ?? " - "}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium tracking-wide text-white/50 uppercase">
                      Top competitor
                    </p>
                    <p className="mt-1 truncate text-2xl font-semibold text-white capitalize md:text-3xl">
                      {report.topCompetitor?.name ?? "None"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="shrink-0">
                <ScoreRing score={report.score.overall} />
              </div>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-3 print:hidden">
              <ShareControls
                slug={report.brand.slug}
                brandName={report.brand.name}
                score={report.score.overall}
              />
              {canPrintPdf ? <PrintReportButton /> : null}
            </div>
          </div>
        </section>

        {/* Prompt matrix */}
        <section className="mx-auto max-w-6xl px-4 py-14 md:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                What the AI answered
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Mentioned in {mentionedCount} of {report.promptMatrix.length}{" "}
                buyer questions across{" "}
                {report.scan.providerIds.map(providerDisplayName).join(", ")}
                .
              </p>
            </div>
          </div>
          <div className="mt-6 overflow-hidden rounded-xl border border-border">
            <div className="divide-y divide-border">
              {report.promptMatrix.map((row) => (
                <div
                  key={row.prompt}
                  className="flex items-start justify-between gap-4 bg-card px-5 py-4 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{row.prompt}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {row.promptType}
                    </p>
                    {row.beatenBy.length > 0 ? (
                      <p className="mt-2 text-[13px] text-muted-foreground">
                        {row.mentioned ? "Ahead of you: " : "Recommended instead: "}
                        <span className="font-medium text-foreground">
                          {row.beatenBy.join(", ")}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  {row.mentioned ? (
                    <Badge className="shrink-0 rounded-full bg-[color:var(--rb-green)]/10 text-[color:var(--rb-green)] hover:bg-[color:var(--rb-green)]/10">
                      {row.position
                        ? `Recommended ${ordinal(row.position)}`
                        : "Mentioned"}
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="shrink-0 rounded-full text-muted-foreground"
                    >
                      Not mentioned
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Competitor preview */}
        <section className="border-t border-border bg-card">
          <div className="mx-auto max-w-6xl px-4 py-12 md:px-6">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Companies the AI recommended
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each name carries the source the model actually used. Names
                without one are shown as unverified.
              </p>
            </div>
            {report.competitorPreview.length > 0 ? (
              <div className="mt-6 divide-y divide-border border-y border-border">
                {report.competitorPreview.map((competitor, index) => (
                  <div
                    key={competitor.name}
                    className="flex items-center justify-between gap-4 py-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{index + 1}
                      </span>
                      <p className="truncate text-sm font-semibold">
                        {competitor.name}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {competitor.mentions}{" "}
                        {competitor.mentions === 1 ? "mention" : "mentions"}
                        {competitor.averagePosition
                          ? ` · avg ${competitor.averagePosition}`
                          : ""}
                      </span>
                      <Badge variant="secondary" className="rounded-full">
                        {competitor.evidenceStatus === "verified"
                          ? "Source verified"
                          : "AI answer only"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">
                No competitor was clearly recommended in this preview.
              </p>
            )}
          </div>
        </section>

        {/* The one competitor whose website we read */}
        {report.investigatedCompetitor ? (
          <section className="border-y border-border bg-[color:var(--rb-mist)]">
            <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
              <h2 className="text-xl font-semibold tracking-tight">
                The competitor we looked into
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                The most-recommended company had its website found from the
                sources the AI cited, and one relevant page read. The action
                below is built on it.
              </p>

              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <div className="rb-panel p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-semibold tracking-tight">
                      {report.investigatedCompetitor.name}
                    </h3>
                    <Badge variant="secondary" className="rounded-full">
                      Recommended in {report.investigatedCompetitor.mentions} of{" "}
                      {report.promptMatrix.length} answers
                    </Badge>
                  </div>
                  {report.investigatedCompetitor.website ? (
                    <a
                      href={report.investigatedCompetitor.website}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-[color:var(--rb-accent)] hover:underline"
                    >
                      <ExternalLink className="size-3.5 shrink-0" />
                      {report.investigatedCompetitor.website}
                    </a>
                  ) : null}
                </div>

                <div className="rb-panel p-6">
                  <h3 className="font-semibold tracking-tight">
                    What their pages say
                  </h3>
                  <ul className="mt-4 space-y-4">
                    {report.investigatedCompetitor.pages.map((page) => (
                      <li key={`${page.label}-${page.url ?? ""}`}>
                        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          {page.label}
                        </p>
                        {page.excerpt ? (
                          <p className="mt-1 border-l-2 border-[color:var(--rb-accent)] pl-3 text-sm leading-relaxed text-foreground/80">
                            {page.excerpt}
                          </p>
                        ) : null}
                        {page.url ? (
                          <a
                            href={page.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-[color:var(--rb-accent)] hover:underline"
                          >
                            <ExternalLink className="size-3 shrink-0" />
                            <span className="truncate">{page.url}</span>
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* The one action */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
            <div className="flex items-center gap-2">
              <Lightbulb className="size-4 text-muted-foreground" />
              <h2 className="text-xl font-semibold tracking-tight">
                Your best next action
              </h2>
            </div>
            {report.recommendation ? (
              <div className="rb-panel mt-6 p-6">
                <h3 className="font-semibold tracking-tight">
                  {report.recommendation.title}
                </h3>
                {report.recommendation.reason ? (
                  <p className="mt-3 text-sm leading-relaxed text-foreground/80">
                    {report.recommendation.reason}
                  </p>
                ) : null}
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {report.recommendation.explanation}
                </p>
              </div>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">
                No action could be written from this audit&apos;s evidence.
              </p>
            )}
          </div>
        </section>

        {/* Where the AI looked */}
        <section className="border-b border-border bg-card">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
            <div className="flex items-center gap-2">
              <Link2 className="size-4 text-muted-foreground" />
              <h2 className="text-xl font-semibold tracking-tight">
                Where the AI looked
              </h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {report.sourceSummary.total > 0 ? (
                <>
                  {report.sourceSummary.total}{" "}
                  {report.sourceSummary.total === 1
                    ? "source was"
                    : "sources were"}{" "}
                  cited across these answers.{" "}
                  {report.sourceSummary.mentioningBrand === 0
                    ? `None of them mentions ${report.brand.name}.`
                    : `${report.sourceSummary.mentioningBrand} of them mentions ${report.brand.name}.`}
                </>
              ) : (
                "This model returned no sources for these answers."
              )}
            </p>

            {report.sources.length > 0 ? (
              <div className="mt-6 overflow-hidden rounded-xl border border-border">
                <div className="divide-y divide-border">
                  {report.sources.map((source) => (
                    <div
                      key={source.url}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                    >
                      <div className="min-w-0">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-[color:var(--rb-accent)] hover:underline"
                        >
                          {source.domain}
                        </a>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {source.title ?? source.url}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          cited in {source.citedInAnswers}{" "}
                          {source.citedInAnswers === 1 ? "answer" : "answers"}
                        </span>
                        {source.mentionsBrand === false ? (
                          <Badge
                            variant="secondary"
                            className="rounded-full text-muted-foreground"
                          >
                            Doesn&apos;t mention you
                          </Badge>
                        ) : source.mentionsBrand ? (
                          <Badge className="rounded-full bg-[color:var(--rb-green)]/10 text-[color:var(--rb-green)] hover:bg-[color:var(--rb-green)]/10">
                            Mentions you
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {report.sourceSummary.total > report.sourceSummary.shown ? (
                    <div className="bg-muted/40 px-5 py-3 text-sm text-muted-foreground">
                      {report.sourceSummary.total - report.sourceSummary.shown}{" "}
                      more sources in the full audit
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Claim + upgrade CTA */}
        <section className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 md:flex-row md:items-center md:justify-between md:px-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {isOwner ? "Public report preview" : "Is this your company?"}
              </h2>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                {isOwner
                  ? "This is the shareable preview. Your complete provider answers, competitors, sources, improvements, and history remain in the dashboard."
                  : "Claim this report to own it, control visibility, track changes over time, and unlock the full action centre."}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {isOwner ? (
                <Button asChild>
                  <Link href={routes.brand(brand.id)}>
                    Open full report
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild>
                    <Link href={`/claim/${report.brand.slug}`}>
                      Claim this website
                      <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/pricing">View plans</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </section>
      </main>
      <div className="print:hidden">
        <SiteFooter />
      </div>
    </>
  );
}
