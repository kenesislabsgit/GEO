/**
 * The integration tests run against a real Postgres — geo_test, a schema copy
 * of the real database — because the JSON store they used before accepted
 * anything and proved nothing. Recreate it after a schema change with:
 *
 *   psql -U postgres -c "drop database if exists geo_test with (force)"
 *   psql -U postgres -c "create database geo_test"
 *   pg_dump -U postgres --schema-only geo_dev | psql -U postgres -d geo_test
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/geo_test";

export function pointAtTestDb(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

export async function resetTestDb(): Promise<void> {
  pointAtTestDb();
  const { q, exec } = await import("@/lib/db/pg");
  // Production applies Better Auth's migration before ours. Recreate the
  // tables it owns here so an empty disposable database follows that order.
  await exec(`
    create table if not exists "user" (
      id text primary key,
      name text not null,
      email text not null unique,
      "emailVerified" boolean not null default false,
      image text,
      "createdAt" timestamptz not null default now(),
      "updatedAt" timestamptz not null default now()
    );
    create table if not exists session (
      id text primary key,
      "expiresAt" timestamptz not null,
      token text not null unique,
      "createdAt" timestamptz not null default now(),
      "updatedAt" timestamptz not null default now(),
      "ipAddress" text,
      "userAgent" text,
      "userId" text not null references "user" (id) on delete cascade
    );
    create table if not exists account (
      id text primary key,
      "accountId" text not null,
      "providerId" text not null,
      "userId" text not null references "user" (id) on delete cascade,
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      "accessTokenExpiresAt" timestamptz,
      "refreshTokenExpiresAt" timestamptz,
      scope text,
      password text,
      "createdAt" timestamptz not null default now(),
      "updatedAt" timestamptz not null default now()
    );
    create table if not exists verification (
      id text primary key,
      identifier text not null,
      value text not null,
      "expiresAt" timestamptz not null,
      "createdAt" timestamptz not null default now(),
      "updatedAt" timestamptz not null default now()
    );
  `);
  const migrationsDirectory = path.join(process.cwd(), "db/migrations");
  const [{ brandsTable }] = await q<{ brandsTable: string | null }>(
    "select to_regclass('public.brands') as \"brandsTable\"",
  );
  if (!brandsTable) {
    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const migration of migrations) {
      await exec(await readFile(path.join(migrationsDirectory, migration), "utf8"));
    }
  }
  await q(
    `truncate table brands, scan_runs, scan_questions, query_results, score_snapshots,
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
  await getPool()
    .end()
    .catch(() => {});
  (globalThis as { __rbaiPgPool?: unknown }).__rbaiPgPool = undefined;
}
