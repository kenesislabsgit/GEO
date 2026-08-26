import { one, q } from "@/lib/db/pg";
import {
  getBrandById,
  getBrandMonitoringSettings,
  getSubscription,
  getUserEmail,
} from "@/lib/db/repository";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { sendAlertEmail } from "@/lib/email/resend";
import { log } from "@/lib/log";
import type { Json, ScanInputSnapshot, ScanRun } from "@/types/database";

/**
 * Alert detection, run by the worker after every finished scan. Each alert
 * carries the before/after evidence that raised it, links to its scan, and
 * is deduplicated by a stable key so a retried run cannot raise it twice.
 * emailed_at is written only after the email provider confirms acceptance.
 */

const SCORE_ALERT_THRESHOLD = 5;

type SnapshotRow = {
  id: string;
  scan_run_id: string;
  overall_score: number;
  mention_rate: number;
  average_position: number | null;
  competitor_scores: Json;
  created_at: string;
  input_snapshot: Json;
};

/** Only compare runs that asked the same questions to the same providers. */
function comparisonKey(value: Json): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as unknown as Partial<ScanInputSnapshot>;
  const providers = Array.isArray(snapshot.assistants)
    ? [...snapshot.assistants].map(String).sort()
    : [];
  const questions = Array.isArray(snapshot.prompts)
    ? snapshot.prompts.map((item) => String(item?.prompt ?? "").trim())
    : [];
  if (providers.length === 0 || questions.length === 0) return null;
  return JSON.stringify({
    providers,
    questions,
    country: snapshot.country ?? null,
    language: snapshot.language ?? null,
  });
}

type PendingAlert = {
  type: string;
  title: string;
  body: string;
  dedupeKey: string;
  metadata: Record<string, unknown>;
};

function competitorNames(scores: Json): Set<string> {
  if (!Array.isArray(scores)) return new Set();
  return new Set(
    scores
      .map((row) =>
        typeof row === "object" && row !== null
          ? String((row as { name?: unknown }).name ?? "")
          : "",
      )
      .filter(Boolean)
      .map((name) => name.toLowerCase()),
  );
}

async function citationDomains(scanRunId: string): Promise<Set<string>> {
  const rows = await q<{ citations: Json }>(
    `select citations from query_results where scan_run_id = $1`,
    [scanRunId],
  );
  const domains = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.citations)) continue;
    for (const citation of row.citations) {
      const domain =
        typeof citation === "object" && citation !== null
          ? String((citation as { domain?: unknown }).domain ?? "")
          : "";
      if (domain) domains.add(domain.toLowerCase());
    }
  }
  return domains;
}

export async function detectAlertsForScan(scan: ScanRun): Promise<void> {
  const brand = await getBrandById(scan.brand_id);
  if (!brand?.owner_id) return;
  const settings = await getBrandMonitoringSettings(scan.brand_id);
  const prefs: {
    scoreDrop?: boolean;
    competitor?: boolean;
    citation?: boolean;
  } = settings?.alerts ?? {};
  const sub = await getSubscription(brand.owner_id);
  const emailAllowed = sub ? PLAN_CONFIG[sub.plan].features.emailAlerts : false;

  const alerts: PendingAlert[] = [];

  if (["failed", "timed_out"].includes(scan.status)) {
    alerts.push({
      type: "scan_failed",
      title: `Audit failed for ${brand.name}`,
      body:
        scan.error_summary ??
        "The scheduled audit did not finish. It will be retried automatically.",
      dedupeKey: `scan_failed:${scan.brand_id}:${scan.id}`,
      metadata: { scanId: scan.id, reason: scan.failure_reason ?? null },
    });
  } else if (["completed", "partial"].includes(scan.status)) {
    const snapshots = await q<SnapshotRow>(
      `select score_snapshots.id, score_snapshots.scan_run_id,
              score_snapshots.overall_score, score_snapshots.mention_rate,
              score_snapshots.average_position, score_snapshots.competitor_scores,
              score_snapshots.created_at,
              scan_runs.input_snapshot
       from score_snapshots
       join scan_runs on scan_runs.id = score_snapshots.scan_run_id
       where score_snapshots.brand_id = $1
       order by score_snapshots.created_at desc limit 30`,
      [scan.brand_id],
    );

    const latest = snapshots.find((item) => item.scan_run_id === scan.id);
    const latestKey = latest ? comparisonKey(latest.input_snapshot) : null;
    const comparable = latestKey
      ? snapshots.filter(
          (item) => comparisonKey(item.input_snapshot) === latestKey,
        )
      : [];
    const previous = comparable.find((item) => item.scan_run_id !== scan.id);
    const older = previous
      ? comparable.find(
          (item) =>
            item.scan_run_id !== scan.id &&
            item.scan_run_id !== previous.scan_run_id,
        )
      : undefined;

    // AI answers naturally vary. Confirm a change in two consecutive runs
    // before notifying, instead of treating one sample as a lasting shift.
    if (latest && previous && older) {
      const delta = Number(latest.overall_score) - Number(older.overall_score);
      const previousDelta =
        Number(previous.overall_score) - Number(older.overall_score);
      if (
        Math.abs(delta) >= SCORE_ALERT_THRESHOLD &&
        Math.abs(previousDelta) >= SCORE_ALERT_THRESHOLD &&
        Math.sign(delta) === Math.sign(previousDelta) &&
        prefs.scoreDrop !== false
      ) {
        alerts.push({
          type: "score_change",
          title: `${brand.name} visibility ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} points`,
          body: `The AI visibility score stayed ${delta > 0 ? "higher" : "lower"} for two audits, moving from ${Number(older.overall_score).toFixed(1)} to ${Number(latest.overall_score).toFixed(1)}.`,
          dedupeKey: `score_change:${scan.brand_id}:${scan.id}`,
          metadata: {
            scanId: scan.id,
            before: Number(older.overall_score),
            after: Number(latest.overall_score),
          },
        });
      }

      // Mention losses: the brand stopped appearing at all.
      if (
        Number(older.mention_rate) > 0 &&
        Number(previous.mention_rate) === 0 &&
        Number(latest.mention_rate) === 0
      ) {
        alerts.push({
          type: "mention_lost",
          title: `${brand.name} is no longer mentioned in AI answers`,
          body: `Mention rate fell from ${(Number(older.mention_rate) * 100).toFixed(0)}% to 0% and stayed there for two audits.`,
          dedupeKey: `mention_lost:${scan.brand_id}:${scan.id}`,
          metadata: {
            scanId: scan.id,
            before: Number(older.mention_rate),
            after: 0,
          },
        });
      }

      if (prefs.competitor !== false) {
        const currentNames = competitorNames(latest.competitor_scores);
        const previousNames = competitorNames(previous.competitor_scores);
        const olderNames = competitorNames(older.competitor_scores);
        for (const name of currentNames) {
          if (previousNames.has(name) && !olderNames.has(name)) {
            alerts.push({
              type: "competitor_appeared",
              title: `New competitor in AI answers: ${name}`,
              body: `${name} appeared in AI recommendations for ${brand.name}'s buyer questions in two consecutive audits.`,
              dedupeKey: `competitor_appeared:${scan.brand_id}:${name}:${scan.id}`,
              metadata: { scanId: scan.id, competitor: name },
            });
          }
        }
        for (const name of olderNames) {
          if (!previousNames.has(name) && !currentNames.has(name)) {
            alerts.push({
              type: "competitor_disappeared",
              title: `Competitor dropped out of AI answers: ${name}`,
              body: `${name} was absent from AI recommendations for ${brand.name}'s buyer questions in two consecutive audits.`,
              dedupeKey: `competitor_disappeared:${scan.brand_id}:${name}:${scan.id}`,
              metadata: { scanId: scan.id, competitor: name },
            });
          }
        }
      }

      if (prefs.citation !== false) {
        const currentDomains = await citationDomains(latest.scan_run_id);
        const previousDomains = await citationDomains(previous.scan_run_id);
        const olderDomains = await citationDomains(older.scan_run_id);
        const gained = [...currentDomains].filter(
          (domain) => previousDomains.has(domain) && !olderDomains.has(domain),
        );
        const lost = [...olderDomains].filter(
          (domain) =>
            !previousDomains.has(domain) && !currentDomains.has(domain),
        );
        if (gained.length > 0) {
          alerts.push({
            type: "citation_gained",
            title: `New sources citing the market: ${gained.slice(0, 3).join(", ")}${gained.length > 3 ? "…" : ""}`,
            body: `${gained.length} source domain(s) appeared in AI answers in two consecutive audits.`,
            dedupeKey: `citation_gained:${scan.brand_id}:${scan.id}`,
            metadata: { scanId: scan.id, gained: gained.slice(0, 20) },
          });
        }
        if (lost.length > 0) {
          alerts.push({
            type: "citation_lost",
            title: `Sources dropped from AI answers: ${lost.slice(0, 3).join(", ")}${lost.length > 3 ? "…" : ""}`,
            body: `${lost.length} source domain(s) were absent from AI answers in two consecutive audits.`,
            dedupeKey: `citation_lost:${scan.brand_id}:${scan.id}`,
            metadata: { scanId: scan.id, lost: lost.slice(0, 20) },
          });
        }
      }
    }
  }

  if (alerts.length === 0) return;

  const email = await getUserEmail(brand.owner_id);
  for (const alert of alerts) {
    // The dedupe key makes re-detection a no-op at the database.
    const inserted = await one<{ id: string }>(
      `insert into alerts (user_id, brand_id, scan_run_id, type, title, body, metadata, dedupe_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
       returning id`,
      [
        brand.owner_id,
        scan.brand_id,
        scan.id,
        alert.type,
        alert.title,
        alert.body,
        JSON.stringify(alert.metadata),
        alert.dedupeKey,
      ],
    );
    if (!inserted) continue;

    if (emailAllowed && email) {
      const sent = await sendAlertEmail({
        to: email,
        subject: alert.title,
        body: `${alert.body}\n\nSee the full report in your dashboard.`,
      });
      if (sent.ok && !sent.demo) {
        await one(
          `update alerts set emailed_at = timezone('utc', now()) where id = $1 returning id`,
          [inserted.id],
        );
      } else if (!sent.ok) {
        log.warn("alert_email_failed", {
          alertId: inserted.id,
          error: sent.error ?? "unknown",
        });
      }
    }
  }
  log.info("alerts_detected", { scanId: scan.id, count: alerts.length });
}
