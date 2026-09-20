import { expect, test } from "@playwright/test";

test("homepage auth controls switch modes and submit with Enter", async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.11" });
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

  await page.waitForURL(/\/verify-email/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Check your inbox/i })).toBeVisible();
});

test("plan choice survives account creation while email confirmation is pending", async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.12" });
  const email = `plan-flow-${Date.now()}@example.com`;

  await page.goto("/pricing");
  await page.getByRole("link", { name: /Start 7-day trial/i }).click();
  await expect(page).toHaveURL(/\/login\?/);

  // The pricing CTA lands in sign-in mode; switch to signup for a new account.
  await page.getByRole("link", { name: "Need an account? Sign up" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify-email/, { timeout: 15_000 });
  const current = new URL(page.url());
  expect(current.searchParams.get("returnTo")).toContain("/dashboard/billing/start");
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
});
