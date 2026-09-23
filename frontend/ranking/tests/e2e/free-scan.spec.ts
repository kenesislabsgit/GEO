import { test, expect } from "@playwright/test";

test("free audit CTA goes to signup and requires email confirmation", async ({
  page,
}) => {
  const email = `free-plan-${Date.now()}@example.com`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /When buyers ask AI, do they recommend your brand/i,
    }),
  ).toBeVisible();
  // The hero CTA is the signup journey — never a scroll to a pricing grid.
  await page
    .getByRole("link", { name: "Run free audit", exact: true })
    .first()
    .click();

  await expect(page).toHaveURL(/\/login\?/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("checkbox", { name: /I agree/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL(/\/verify-email/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
});
