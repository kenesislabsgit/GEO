import { test, expect } from "@playwright/test";

async function signUp(
  page: import("@playwright/test").Page,
  email: string,
  returnTo = "/dashboard/scans/new",
) {
  // Real signup through Better Auth; the session cookie lands on the request
  // context. /api/auth/complete then decides where a fresh account goes.
  // Better Auth rate-limits bursts of signups from one IP, so back off and
  // retry rather than flaking when several tests sign up in a row.
  let ok = false;
  for (let attempt = 0; attempt < 5 && !ok; attempt++) {
    const res = await page.request.post("/api/auth/sign-up/email", {
      data: { email, password: "password1234", name: "Test User" },
    });
    ok = res.ok();
    if (!ok) await page.waitForTimeout(3_000 * (attempt + 1));
  }
  expect(ok).toBeTruthy();
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
  await expect(
    page.getByRole("heading", { name: /See what AI tells your buyers/i }),
  ).toHaveCount(0);

  // Zero-website accounts are routed directly into the dashboard audit flow.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/scans\/new/);
});

test("audit start enqueues a durable scan the dashboard can see", async ({
  page,
}) => {
  const email = `scan-queue-${Date.now()}@example.com`;
  await signUp(page, email);

  // The one audit entry point. Without a worker running, the scan sits
  // durably queued — visible, cancellable, never lost.
  const start = await page.request.post("/api/audit-run/start", {
    data: { domain: `queue-e2e-${Date.now()}.example.com`, mode: "free" },
  });
  expect(start.ok()).toBeTruthy();
  const body = (await start.json()) as { scanRunId: string; brandId: string };
  expect(body.scanRunId).toBeTruthy();

  const progress = await page.request.get(
    `/api/scans/${body.scanRunId}/progress`,
  );
  expect(progress.ok()).toBeTruthy();
  const state = (await progress.json()) as { status: string };
  expect(["queued", "running"]).toContain(state.status);

  // Cancel it so the test leaves no queued work behind.
  const cancel = await page.request.post(
    `/api/scans/${body.scanRunId}/cancel`,
  );
  expect(cancel.ok()).toBeTruthy();

  // The audit history page shows the cancelled run.
  await page.goto("/dashboard/scans");
  await expect(page.getByText("cancelled").first()).toBeVisible();
});

test("after sign-in, returnTo restores the requested dashboard page", async ({
  page,
}) => {
  const email = `return-${Date.now()}@example.com`;
  await signUp(page, email, "/dashboard/billing");
  await page.waitForURL(/\/dashboard\/billing/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Billing/i })).toBeVisible();
});
