import { readFileSync } from "fs";
import pg from "pg";

const connectionString = process.env.DATABASE_URL || "postgresql://geoadmin:GeoAdminPassword2026!@geo-db.cs9o4g862eq2.us-east-1.rds.amazonaws.com:5432/postgres";

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("Creating authentication tables...");
  
  // Better Auth tables
  await pool.query(`
    create table if not exists "user" (
      id text primary key,
      name text not null,
      email text not null unique,
      email_verified boolean not null default false,
      image text,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );

    create table if not exists "session" (
      id text primary key,
      expires_at timestamptz not null,
      token text not null unique,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      ip_address text,
      user_agent text,
      user_id text not null references "user" (id) on delete cascade
    );

    create table if not exists "account" (
      id text primary key,
      account_id text not null,
      provider_id text not null,
      user_id text not null references "user" (id) on delete cascade,
      access_token text,
      refresh_token text,
      id_token text,
      access_token_expires_at timestamptz,
      refresh_token_expires_at timestamptz,
      scope text,
      password text,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );

    create table if not exists "verification" (
      id text primary key,
      identifier text not null,
      value text not null,
      expires_at timestamptz not null,
      created_at timestamptz,
      updated_at timestamptz
    );
  `);

  console.log("Applying core schema...");
  const sql = readFileSync("./db/migrations/0001_init.sql", "utf8");
  await pool.query(sql);
  console.log("✅ All 12 tables created successfully in AWS RDS PostgreSQL!");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
