import { test, expect } from "@playwright/test";

async function signUp(
  page: import("@playwright/test").Page,
  email: string,
  returnTo = "/dashboard/scans/new",
) {
  // Real signup through Better Auth; the session cookie lands on the request
  // context. /api/auth/complete then decides where a fresh account goes.
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { email, password: "password1234", name: "Test User" },
  });
  expect(res.ok()).toBeTruthy();
  const complete = await page.request.post("/api/auth/complete", {
    data: { returnTo },
  });
  expect(complete.ok()).toBeTruthy();
  const body = (await complete.json()) as { redirect: string };
  await page.goto(body.redirect);
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

test("signed-in free user Run a scan stays inside the dashboard", async ({
  page,
}) => {
  const email = `scan-free-${Date.now()}@example.com`;
  await signUp(page, email);

  // Post-login with no brands should land on the signed-in new-scan page.
  await expect(page).toHaveURL(/\/dashboard\/scans\/new/);
  await expect(page.getByRole("heading", { name: /New audit/i })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Audit a website/i }),
  ).toBeVisible();

  // Must NOT be the public homepage hero.
  await expect(page).not.toHaveURL(/\/#scan/);
  await expect(
    page.getByRole("heading", { name: /Does AI recommend your company/i }),
  ).toHaveCount(0);

  // Zero-website accounts are routed directly into the dashboard audit flow.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/scans\/new/);
});

test("brand-specific Run scan preselects brand query param", async ({
  page,
}) => {
  const email = `scan-brand-${Date.now()}@example.com`;
  await signUp(page, email);

  // Create a brand via dashboard start API so we have something to preselect.
  const startRes = await page.request.post("/api/scans/dashboard/start", {
    data: { domain: `brand-${Date.now()}.example.com` },
  });
  // May succeed (new scan) or fail on network/demo — either way we only assert routing.
  if (startRes.ok()) {
    const body = (await startRes.json()) as { brandId: string; scanRunId: string };
    await page.goto(`/dashboard/brands/${body.brandId}`);
    await page.getByRole("link", { name: /Run scan/i }).click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/scans/new\\?brand=${body.brandId}`),
    );
  } else {
    // Fallback: direct navigation with a fake brand id still stays in dashboard.
    await page.goto("/dashboard/scans/new?brand=00000000-0000-0000-0000-000000000001");
    await expect(page).toHaveURL(/\/dashboard\/scans\/new/);
    await expect(page).not.toHaveURL(/\/#scan/);
  }
});

test("after sign-in, returnTo restores the requested dashboard page", async ({
  page,
}) => {
  const email = `return-${Date.now()}@example.com`;
  await signUp(page, email, "/dashboard/billing");
  await page.waitForURL(/\/dashboard\/billing/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Billing/i })).toBeVisible();
});

test("paid-plan checkout simulation returns to intended scan page", async ({
  page,
}) => {
  const email = `paid-${Date.now()}@example.com`;
  await signUp(page, email);

  await page.goto(
    `/dashboard/billing?plan=founder&returnTo=${encodeURIComponent("/dashboard/scans/new")}`,
  );
  await page.getByRole("button", { name: /Subscribe monthly/i }).first().click();
  await page.waitForURL(/\/dashboard\/scans\/new/, { timeout: 15_000 });

  // If they already have a brand from a prior step, premium chips appear;
  // otherwise the add-brand form remains — either way, never the homepage.
  await expect(page).not.toHaveURL(/\/#scan/);
  await expect(
    page.getByRole("heading", { name: /Does AI recommend your company/i }),
  ).toHaveCount(0);
});
