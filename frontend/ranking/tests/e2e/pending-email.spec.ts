import "../../worker/env";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";
import { test, expect } from "@playwright/test";

test("an existing unconfirmed signup cannot enter the dashboard until confirmed", async ({ page }) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const id = randomUUID();
  const email = `pending-regression-${id}@example.com`;
  const password = `Test-${randomUUID()}`;
  try {
    // Simulate the persisted account from an earlier signup without sending mail.
    await pool.query(`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values ($1, 'Pending regression', $2, false, now(), now())`, [id, email]);
    await pool.query(`insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      values ($1, $2, 'credential', $2, $3, now(), now())`, [randomUUID(), id, await hashPassword(password)]);

    await page.goto("/login?mode=signin");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    const [signIn] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/auth/sign-in/email")),
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    expect(signIn.status()).toBe(200);
    await expect(page).toHaveURL(/\/verify-email\?/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/verify-email\?/);
    for (const path of ["/dashboard", "/dashboard/settings", "/dashboard/billing", "/dashboard/scans/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/verify-email\?/);
      expect(new URL(page.url()).searchParams.get("returnTo")).toBe(path);
      await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    }
    expect((await page.request.get("/api/account/export")).status()).toBe(401);
    expect((await page.request.post("/api/billing/checkout", { data: { plan: "founder" } })).status()).toBe(401);
    expect((await page.request.post("/api/audit-run/start", { data: { domain: "example.com" } })).status()).toBe(401);
    await page.goto("/verify-email?verified=1");
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

    // Only simulate the email's database effect; this does not test delivery.
    await pool.query(`update "user" set "emailVerified" = true where id = $1`, [id]);
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard\/scans\/new$/);
    await expect(page.getByRole("heading", { name: "New audit", exact: true })).toBeVisible();
    expect((await page.request.get("/api/account/export")).status()).toBe(200);
  } finally {
    // Exact fixture ID only; never delete other accounts.
    await pool.query(`delete from session where "userId" = $1`, [id]);
    await pool.query(`delete from account where "userId" = $1`, [id]);
    await pool.query(`delete from "user" where id = $1`, [id]);
    await pool.end();
  }
});
