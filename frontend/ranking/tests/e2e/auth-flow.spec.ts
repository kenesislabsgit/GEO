import { expect, test } from "@playwright/test";

test("homepage auth controls switch modes and submit with Enter", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const email = `auth-flow-${Date.now()}@example.com`;
  const runtimeProblems: string[] = [];
  page.on("pageerror", (error) => runtimeProblems.push(error.message));

  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\?mode=signin/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Need an account? Sign up" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1234");
  expect(runtimeProblems).toEqual([]);
  await page.getByLabel("Password").press("Enter");

  await page.waitForURL(/\/dashboard\/scans\/new/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /New audit/i })).toBeVisible();
});

test("plan choice survives account creation and checkout fails closed without config", async ({
  page,
}) => {
  const email = `plan-flow-${Date.now()}@example.com`;

  await page.goto("/pricing");
  await page.getByRole("link", { name: "Get started" }).first().click();
  await expect(page).toHaveURL(/\/login\?/);

  // The pricing CTA lands in sign-in mode; switch to signup for a new account.
  await page.getByRole("link", { name: "Need an account? Sign up" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1234");
  // Better Auth rate-limits signup bursts; a suite of tests signing up in a
  // row can trip it. Retry the click until the redirect happens.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByRole("button", { name: "Create account" }).click();
    try {
      await page.waitForURL(/\/dashboard\/billing\?/, { timeout: 12_000 });
      break;
    } catch {
      await page.waitForTimeout(10_000);
    }
  }
  await page.waitForURL(/\/dashboard\/billing\?/, { timeout: 15_000 });
  await expect(page.getByText("Pro", { exact: true }).first()).toBeVisible();

  // Real checkout: the button either hands off to Dodo's hosted page (keys
  // configured) or answers 503 (keys missing). It never simulates a plan.
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/billing/checkout")),
    page.getByRole("button", { name: /Subscribe monthly/i }).first().click(),
  ]);
  expect([200, 503]).toContain(response.status());
  if (response.status() === 200) {
    // Keys configured: the browser hands off to Dodo's hosted checkout.
    await page.waitForURL(/dodopayments\.com/, { timeout: 20_000 });
  } else {
    // Failed closed: still on billing, no plan granted.
    await expect(page).toHaveURL(/\/dashboard\/billing/);
  }
});
