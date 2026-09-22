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

  await page.getByRole("link", { name: "Sign up", exact: true }).click();
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
  await page.getByRole("link", { name: "Start 7-day trial" }).click();
  await expect(page).toHaveURL(/\/login\?/);

  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected trial" })).toContainText("Plus · Monthly · 7-day trial");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1234");
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/complete") && res.request().method() === "POST"),
    page.getByRole("button", { name: "Create account" }).click(),
  ]);
  expect(response.status()).toBe(200);
  const destination = new URL((await response.json()).redirect, page.url());
  expect(destination.pathname).toBe("/dashboard/billing/start");
  expect(destination.searchParams.get("plan")).toBe("founder");
  expect(["monthly", "yearly"]).toContain(destination.searchParams.get("interval"));

  // Checkout now starts on the server as soon as this destination loads.
  // It either redirects to the provider or presents the existing retry state.
  await expect(async () => {
    if (new URL(page.url()).hostname.endsWith("dodopayments.com")) return;
    await expect(page.getByText("Could not start checkout", { exact: true })).toBeVisible();
  }).toPass({ timeout: 20_000 });
  if (!new URL(page.url()).hostname.endsWith("dodopayments.com")) {
    await expect(page).toHaveURL(/\/dashboard\/billing\/start\?/);
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  }
});
