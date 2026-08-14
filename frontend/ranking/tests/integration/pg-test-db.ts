/**
 * The integration tests run against a real Postgres — geo_test, a schema copy
 * of the real database — because the JSON store they used before accepted
 * anything and proved nothing. Recreate it after a schema change with:
 *
 *   psql -U postgres -c "drop database if exists geo_test with (force)"
 *   psql -U postgres -c "create database geo_test"
 *   pg_dump -U postgres --schema-only geo_dev | psql -U postgres -d geo_test
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/geo_test";

export function pointAtTestDb(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

export async function resetTestDb(): Promise<void> {
  pointAtTestDb();
  const { q, exec } = await import("@/lib/db/pg");
  await q(
    `truncate table brands, scan_runs, query_results, score_snapshots,
       recommendations, tracked_prompts, competitors, subscriptions,
       usage_ledger, webhook_events, free_scan_requests, alerts,
       "user", session, account, verification
     cascade`,
  );
  await exec(
    `delete from app_settings where key like 'user_onboarding:%' or key like 'brand_monitoring:%'`,
  );
}

export async function closeTestDb(): Promise<void> {
  const { getPool } = await import("@/lib/db/pg");
  await getPool().end().catch(() => {});
  (globalThis as { __rbaiPgPool?: unknown }).__rbaiPgPool = undefined;
}
