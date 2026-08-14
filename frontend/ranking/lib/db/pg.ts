import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient } from "pg";

/**
 * The one Postgres connection pool for the whole app. Locally this is the
 * geo_dev database; in production it is RDS. Same schema, same code - only
 * DATABASE_URL changes.
 */

// The driver returns numeric and bigint columns as strings, because they can
// exceed what a JS number holds. Ours never do - they are scores, counts and
// costs - and every caller expects numbers, so convert at the edge once.
types.setTypeParser(types.builtins.NUMERIC, (v) => parseFloat(v));
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

// Timestamps come back as ISO strings, not Date objects, because that is what
// the Supabase client returned and every component was written against it.
const toIso = (v: string) => new Date(v).toISOString();
types.setTypeParser(types.builtins.TIMESTAMPTZ, toIso);
types.setTypeParser(types.builtins.TIMESTAMP, toIso);

declare global {
  // Next.js dev reloads modules on every edit; without this the old pools
  // would pile up until Postgres runs out of connections.
  var __rbaiPgPool: Pool | undefined;
}

function requiredUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Deliberately fatal. The old behaviour of quietly falling back to a
    // local JSON file made a box with a missing variable look healthy while
    // saving data somewhere nobody would ever look.
    throw new Error(
      "DATABASE_URL is not set. The app cannot run without its database.",
    );
  }
  return url;
}

export function getPool(): Pool {
  if (!global.__rbaiPgPool) {
    global.__rbaiPgPool = new Pool({ connectionString: requiredUrl(), max: 10 });
  }
  return global.__rbaiPgPool;
}

// When code runs inside withTransaction, every helper in this file must use
// that transaction's client instead of grabbing a fresh pool connection - 
// otherwise "BEGIN" happens on one connection and the writes on another,
// which is no transaction at all. AsyncLocalStorage carries the client down
// the call stack without threading it through 45 repository signatures.
const txStorage = new AsyncLocalStorage<PoolClient>();

function runner(): Pick<Pool, "query"> {
  return txStorage.getStore() ?? getPool();
}

/**
 * Run `fn` inside one database transaction. Every q/one/exec/insertRow/
 * updateRow call made (directly or indirectly) by `fn` joins the same
 * transaction. Commits when `fn` resolves, rolls back when it throws.
 * Nested calls join the outer transaction rather than opening a second one.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStorage.getStore()) return fn();
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await txStorage.run(client, fn);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Run a query, get all rows. */
export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await runner().query(text, params);
  return result.rows as T[];
}

/** Run a query, get the first row or null. */
export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/** Run a statement, get how many rows it touched. */
export async function exec(
  text: string,
  params: unknown[] = [],
): Promise<number> {
  const result = await runner().query(text, params);
  return result.rowCount ?? 0;
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function assertColumns(keys: string[]): void {
  for (const key of keys) {
    if (!IDENTIFIER.test(key)) throw new Error(`Bad column name: ${key}`);
  }
}

// jsonb columns must receive JSON text: handed a plain JS array, the driver
// would try to write a Postgres array instead and the insert fails.
function toParam(value: unknown): unknown {
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

/** Insert one row built from an object's keys. Returns the stored row. */
export async function insertRow<T>(
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const entries = Object.entries(row).filter(([, v]) => v !== undefined);
  const keys = entries.map(([k]) => k);
  assertColumns([table, ...keys]);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const stored = await one<T>(
    `insert into ${table} (${keys.join(", ")}) values (${placeholders.join(", ")}) returning *`,
    entries.map(([, v]) => toParam(v)),
  );
  if (!stored) throw new Error(`Insert into ${table} returned nothing.`);
  return stored;
}

/** Update one row by id from an object's keys. Returns the row or null. */
export async function updateRow<T>(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<T | null> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    return one<T>(`select * from ${table} where id = $1`, [id]);
  }
  const keys = entries.map(([k]) => k);
  assertColumns([table, ...keys]);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  return one<T>(
    `update ${table} set ${sets.join(", ")} where id = $1 returning *`,
    [id, ...entries.map(([, v]) => toParam(v))],
  );
}
