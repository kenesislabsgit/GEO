import "@/worker/env";
import { q } from "@/lib/db/pg";

async function main() {
  const domain = process.argv[2];
  const brand = (await q<{ id: string; name: string; slug: string; owner_id: string; owner_email: string | null; visibility: string }>(
    `select b.id, b.name, b.slug, b.owner_id, u.email as owner_email, b.visibility
     from brands b left join "user" u on u.id = b.owner_id
     where b.canonical_domain = $1`,
    [domain],
  ))[0];
  if (!brand) { console.log("no brand for", domain); return; }
  console.log(`BRAND  ${brand.name}  /report/${brand.slug}  owner=${brand.owner_email ?? brand.owner_id}  ${brand.visibility}`);

  const scans = await q<{ id: string; status: string; step: string; progress: number; scan_type: string; estimated_cost_usd: number; total_queries: number; completed_queries: number; provider_ids: string[] }>(
    `select id, status, step, progress, scan_type, estimated_cost_usd, total_queries, completed_queries, provider_ids
     from scan_runs where brand_id = $1 order by created_at desc`,
    [brand.id],
  );
  for (const s of scans) {
    console.log(`SCAN   ${s.status}/${s.step} ${s.progress}%  ${s.scan_type}  $${s.estimated_cost_usd}  queries ${s.completed_queries}/${s.total_queries}  providers ${(s.provider_ids || []).join(",")}`);
  }
  const scanId = scans[0]?.id;

  const counts: Record<string, number> = {};
  for (const [table, column] of [["query_results", "scan_run_id"], ["recommendations", "scan_run_id"], ["competitors", "brand_id"], ["tracked_prompts", "brand_id"]] as const) {
    const id = column === "scan_run_id" ? scanId : brand.id;
    const rows = await q<{ n: number }>(`select count(*)::int as n from ${table} where ${column} = $1`, [id]);
    counts[table] = rows[0].n;
  }
  console.log("ROWS  ", JSON.stringify(counts));

  const score = (await q<Record<string, number>>(
    "select overall_score, mention_score, position_score, citation_score, mention_rate, average_position, share_of_voice from score_snapshots where scan_run_id = $1",
    [scanId],
  ))[0];
  console.log("SCORE ", JSON.stringify(score));

  const recs = await q<{ title: string; cites: number; prompts: number }>(
    `select title,
            jsonb_array_length(coalesce(evidence->'supporting_evidence','[]'::jsonb)) as cites,
            jsonb_array_length(coalesce(affected_prompts,'[]'::jsonb)) as prompts
     from recommendations where scan_run_id = $1 order by priority`,
    [scanId],
  );
  console.log("RECOMMENDATIONS:");
  for (const r of recs) console.log(`   cites=${r.cites} questions=${r.prompts}  ${String(r.title).slice(0, 95)}`);

  const comps = await q<{ name: string; domain: string }>(
    "select name, domain from competitors where brand_id = $1 order by name",
    [brand.id],
  );
  console.log("COMPETITORS:", comps.map((c) => `${c.name}(${c.domain ?? "-"})`).join(", "));

  const mentioned = await q<{ n: number }>(
    "select count(*)::int as n from query_results where scan_run_id = $1 and brand_mentioned",
    [scanId],
  );
  console.log(`BRAND MENTIONED in ${mentioned[0].n} of ${counts.query_results} answers`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
