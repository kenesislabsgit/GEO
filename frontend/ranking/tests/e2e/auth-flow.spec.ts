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
  await page.getByRole("checkbox", { name: /I agree/ }).check();
  expect(runtimeProblems).toEqual([]);
  await page.getByLabel("Password").press("Enter");

  await page.waitForURL(/\/verify-email/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
});

test("plan choice survives account creation while email confirmation is pending", async ({
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
  await page.getByRole("checkbox", { name: /I agree/ }).check();
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/complete") && res.request().method() === "POST"),
    page.getByRole("button", { name: "Create account" }).click(),
  ]);
  expect(response.status()).toBe(200);
  const destination = new URL((await response.json()).redirect, page.url());
  expect(destination.pathname).toBe("/verify-email");
  const checkout = new URL(destination.searchParams.get("returnTo")!, page.url());
  expect(checkout.pathname).toBe("/dashboard/billing/start");
  expect(checkout.searchParams.get("plan")).toBe("founder");
  expect(["monthly", "yearly"]).toContain(checkout.searchParams.get("interval"));
  await expect(page).toHaveURL(/\/verify-email\?/);
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
});
