import { test, expect } from "@playwright/test";

test("free audit CTA goes to signup and requires email confirmation", async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.13" });
  const email = `free-plan-${Date.now()}@example.com`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /When buyers ask AI/i,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Run free audit/i })
    .first()
    .click();

  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1234");
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Password")).toHaveValue("password1234");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL(/\/verify-email/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
});
