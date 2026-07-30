import { expect, test } from "@playwright/test";

test("homepage auth controls switch modes and submit with Enter", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const email = `auth-flow-${Date.now()}@example.com`;
  const runtimeProblems: string[] = [];
  page.on("pageerror", (error) => runtimeProblems.push(error.message));
  page.on("requestfailed", (request) =>
    runtimeProblems.push(
      `${request.url()}: ${request.failure()?.errorText ?? "request failed"}`,
    ),
  );

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

  await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Sign up", exact: true }).first().click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1234");
  expect(runtimeProblems).toEqual([]);
  await page.getByLabel("Password").press("Enter");

  await page.waitForURL(/\/dashboard\/scans\/new/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /New audit/i })).toBeVisible();
});

test("plan choice survives account creation", async ({ page }) => {
  const email = `plan-flow-${Date.now()}@example.com`;

  await page.goto("/");
  await page.getByRole("link", { name: /Pro \$29\/mo/i }).click();
  await expect(page).toHaveURL(/\/login\?/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL(/\/dashboard\/billing\?/, { timeout: 15_000 });
  await expect(page.getByText("Selected")).toBeVisible();
  await expect(page.getByText("Pro", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Subscribe monthly" }).first().click();
  await page.waitForURL(/\/dashboard\/scans\/new/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "New audit" })).toBeVisible();
});
