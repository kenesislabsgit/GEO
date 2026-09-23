import { afterAll, beforeAll, expect, it } from "vitest";
import { closeTestDb, pointAtTestDb } from "./pg-test-db";

beforeAll(pointAtTestDb);
afterAll(closeTestDb);

it("stores imported text and JSON containing NUL while preserving literal escapes", async () => {
  const { exec, insertRow, updateRow, withTransaction } = await import("@/lib/db/pg");
  await withTransaction(async () => {
    await exec("create temporary table imported_values (id text primary key, label text, data jsonb) on commit drop");
    const row = await insertRow<{ label: string; data: unknown }>("imported_values", {
      id: "sample",
      label: "before\u0000after",
      data: { answer: "hello\u0000world", sources: ["source\u0000"], literal: "\\u0000" },
    });
    expect(row.label).toBe("beforeafter");
    expect(row.data).toEqual({ answer: "helloworld", sources: ["source"], literal: "\\u0000" });
    expect(await updateRow("imported_values", "sample", { label: "new\u0000value" })).toMatchObject({ label: "newvalue" });
  });
});
