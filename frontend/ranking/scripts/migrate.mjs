#!/usr/bin/env node
/**
 * Applies db/migrations/*.sql to DATABASE_URL, in filename order, once each.
 *
 * - Tracks applied files in schema_migrations.
 * - Takes an advisory lock so two deploys cannot race each other.
 * - Baselines existing databases: if schema_migrations is empty but the
 *   brands table already exists, 0001_init.sql is recorded as applied
 *   without being re-run (it created that table).
 * - Each migration runs inside its own transaction.
 *
 * Usage: node scripts/migrate.mjs [--check]
 *   --check  exit 1 if there are unapplied migrations, apply nothing.
 *            Used by CI/deploy to refuse booting code newer than the schema.
 *
 * Order note from db/migrations/0001_init.sql: Better Auth's own migration
 * (`npx @better-auth/cli migrate`) must run first on a brand-new database,
 * because 0001 references the "user" table it creates.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "db", "migrations");

// Next.js loads .env.local for the app; plain node scripts must do it here.
async function loadEnvLocal() {
  for (const name of [".env.local", ".env"]) {
    try {
      const text = await readFile(path.join(here, "..", name), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && process.env[match[1]] === undefined) {
          process.env[match[1]] = match[2].trim();
        }
      }
    } catch {
      // File absent is fine.
    }
  }
}

async function main() {
  await loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const checkOnly = process.argv.includes("--check");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // One fixed key for "the schema is being migrated".
    await client.query("select pg_advisory_lock(729184)");

    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )`);

    const applied = new Set(
      (await client.query("select filename from schema_migrations")).rows.map(
        (r) => r.filename,
      ),
    );

    // Baseline databases created before this runner existed.
    if (applied.size === 0) {
      const { rows } = await client.query(
        "select 1 from information_schema.tables where table_name = 'brands' and table_schema = 'public'",
      );
      if (rows.length > 0) {
        await client.query(
          "insert into schema_migrations (filename) values ($1) on conflict do nothing",
          ["0001_init.sql"],
        );
        applied.add("0001_init.sql");
        console.log("baseline: 0001_init.sql recorded as already applied");
      }
    }

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pending = files.filter((f) => !applied.has(f));
    if (checkOnly) {
      if (pending.length > 0) {
        console.error(`Unapplied migrations: ${pending.join(", ")}`);
        process.exit(1);
      }
      console.log("Schema is up to date.");
      return;
    }

    for (const file of pending) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      console.log(`applying ${file} ...`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into schema_migrations (filename) values ($1)",
          [file],
        );
        await client.query("commit");
        console.log(`applied  ${file}`);
      } catch (error) {
        await client.query("rollback");
        console.error(`FAILED   ${file}: ${error.message}`);
        process.exit(1);
      }
    }
    if (pending.length === 0) console.log("Nothing to apply.");
  } finally {
    await client.query("select pg_advisory_unlock(729184)").catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
