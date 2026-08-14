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
import type { Json, ScanRun } from "@/types/database";

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
};

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
  const prefs: { scoreDrop?: boolean; competitor?: boolean; citation?: boolean } =
    settings?.alerts ?? {};
  const sub = await getSubscription(brand.owner_id);
  const emailAllowed = sub
    ? PLAN_CONFIG[sub.plan].features.emailAlerts
    : false;

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
    const [latest, previous] = await q<SnapshotRow>(
      `select id, scan_run_id, overall_score, mention_rate, average_position,
              competitor_scores, created_at
       from score_snapshots where brand_id = $1
       order by created_at desc limit 2`,
      [scan.brand_id],
    );

    if (latest && previous && latest.scan_run_id === scan.id) {
      const delta =
        Number(latest.overall_score) - Number(previous.overall_score);
      if (Math.abs(delta) >= SCORE_ALERT_THRESHOLD && prefs.scoreDrop !== false) {
        alerts.push({
          type: "score_change",
          title: `${brand.name} visibility ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} points`,
          body: `The AI visibility score moved from ${Number(previous.overall_score).toFixed(1)} to ${Number(latest.overall_score).toFixed(1)}.`,
          dedupeKey: `score_change:${scan.brand_id}:${scan.id}`,
          metadata: {
            scanId: scan.id,
            before: Number(previous.overall_score),
            after: Number(latest.overall_score),
          },
        });
      }

      // Mention losses: the brand stopped appearing at all.
      if (
        Number(previous.mention_rate) > 0 &&
        Number(latest.mention_rate) === 0
      ) {
        alerts.push({
          type: "mention_lost",
          title: `${brand.name} is no longer mentioned in AI answers`,
          body: `Mention rate fell from ${(Number(previous.mention_rate) * 100).toFixed(0)}% to 0% in the latest audit.`,
          dedupeKey: `mention_lost:${scan.brand_id}:${scan.id}`,
          metadata: {
            scanId: scan.id,
            before: Number(previous.mention_rate),
            after: 0,
          },
        });
      }

      if (prefs.competitor !== false) {
        const currentNames = competitorNames(latest.competitor_scores);
        const previousNames = competitorNames(previous.competitor_scores);
        for (const name of currentNames) {
          if (!previousNames.has(name)) {
            alerts.push({
              type: "competitor_appeared",
              title: `New competitor in AI answers: ${name}`,
              body: `${name} started appearing in AI recommendations for ${brand.name}'s buyer questions.`,
              dedupeKey: `competitor_appeared:${scan.brand_id}:${name}:${scan.id}`,
              metadata: { scanId: scan.id, competitor: name },
            });
          }
        }
        for (const name of previousNames) {
          if (!currentNames.has(name)) {
            alerts.push({
              type: "competitor_disappeared",
              title: `Competitor dropped out of AI answers: ${name}`,
              body: `${name} no longer appears in AI recommendations for ${brand.name}'s buyer questions.`,
              dedupeKey: `competitor_disappeared:${scan.brand_id}:${name}:${scan.id}`,
              metadata: { scanId: scan.id, competitor: name },
            });
          }
        }
      }

      if (prefs.citation !== false) {
        const currentDomains = await citationDomains(latest.scan_run_id);
        const previousDomains = await citationDomains(previous.scan_run_id);
        const gained = [...currentDomains].filter(
          (domain) => !previousDomains.has(domain),
        );
        const lost = [...previousDomains].filter(
          (domain) => !currentDomains.has(domain),
        );
        if (gained.length > 0) {
          alerts.push({
            type: "citation_gained",
            title: `New sources citing the market: ${gained.slice(0, 3).join(", ")}${gained.length > 3 ? "…" : ""}`,
            body: `${gained.length} source domain(s) appeared in AI answers that were not cited last audit.`,
            dedupeKey: `citation_gained:${scan.brand_id}:${scan.id}`,
            metadata: { scanId: scan.id, gained: gained.slice(0, 20) },
          });
        }
        if (lost.length > 0) {
          alerts.push({
            type: "citation_lost",
            title: `Sources dropped from AI answers: ${lost.slice(0, 3).join(", ")}${lost.length > 3 ? "…" : ""}`,
            body: `${lost.length} source domain(s) cited last audit no longer appear.`,
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
