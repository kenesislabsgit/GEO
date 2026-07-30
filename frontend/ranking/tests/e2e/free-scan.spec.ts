import { test, expect } from "@playwright/test";

test("Free plan requires an account and opens the signed-in audit flow", async ({
  page,
}) => {
  const email = `free-plan-${Date.now()}@example.com`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Does AI recommend your company/i }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Free \$0/i }).click();

  await expect(page).toHaveURL(/\/login\?/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL(/\/dashboard\/scans\/new/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "New audit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit a website" })).toBeVisible();
});
