import { loadEnvConfig } from "@next/env";
import {
  accountOverviewSeries,
  listScanHistoryForBrands,
  listScansForBrands,
  scoresForBrand,
} from "../lib/db/repository";
import { exec, getPool, withTransaction } from "../lib/db/pg";

// Syntax/schema smoke check only: no real account IDs, no writes, no credentials logged.
async function main() {
  loadEnvConfig(process.cwd());
  const missingId = "00000000-0000-4000-8000-000000000000";
  try {
    await withTransaction(async () => {
      await exec("set transaction read only");
      await exec("set local statement_timeout = '10s'");
      await accountOverviewSeries(missingId);
      await listScanHistoryForBrands([missingId]);
      await listScansForBrands([missingId], 6);
      await scoresForBrand(missingId, 2);
    });
    console.log(
      "Read-only database checks passed for overview, history, and limited reads.",
    );
  } catch (error) {
    console.error(
      "Database checks failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  } finally {
    await getPool().end();
  }
}
void main();
