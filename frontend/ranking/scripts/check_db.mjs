import pg from "pg";

const connectionString = "postgresql://geoadmin:GeoAdminPassword2026!@geo-db.cs9o4g862eq2.us-east-1.rds.amazonaws.com:5432/postgres";

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("Checking tables and records in AWS RDS PostgreSQL...\n");

  const tables = [
    "user",
    "session",
    "account",
    "brands",
    "competitors",
    "tracked_prompts",
    "scan_runs",
    "query_results",
    "score_snapshots",
    "recommendations",
    "alerts"
  ];

  for (const table of tables) {
    try {
      const res = await pool.query(`SELECT count(*) FROM "${table}"`);
      const count = res.rows[0].count;
      console.log(`- Table "${table}": ${count} records`);
    } catch (err) {
      console.log(`- Table "${table}": Error or not created (${err.message})`);
    }
  }

  await pool.end();
}

main().catch(console.error);
