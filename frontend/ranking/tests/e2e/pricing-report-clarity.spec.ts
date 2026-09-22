import { expect, test } from "@playwright/test";

for (const interval of ["monthly", "yearly"] as const) {
  test(`trial signup explains ${interval} selection before credentials`, async ({ page }) => {
    await page.goto("/pricing");
    if (interval === "yearly") await page.getByRole("radio", { name: /Yearly/i }).click();
    const card = page.getByRole("heading", { name: "Plus", exact: true }).locator("..");
    await expect(card).toContainText(`then $${interval === "yearly" ? "790/year" : "79/month"}`);
    await expect(card).toContainText("Payment method required");
    await page.getByRole("link", { name: "Start 7-day trial", exact: true }).click();
    await page.waitForURL(/\/login\?/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    const trial = page.getByRole("region", { name: "Selected trial" });
    await expect(trial).toContainText(interval === "yearly" ? "Plus · Yearly" : "Plus · Monthly");
    await expect(trial).toContainText("Cancel in Billing before your 7-day trial ends");
    await expect(page.getByText(/New reports are public by default/)).toBeVisible();
    await expect(page.locator('a[href="/terms"]').first()).toBeVisible();
    await expect(page.locator('a[href="/privacy"]').first()).toBeVisible();
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(trial).toContainText(interval === "yearly" ? "Plus · Yearly" : "Plus · Monthly");
    await page.getByRole("link", { name: "Sign up", exact: true }).click();
    expect(new URL(new URL(page.url()).searchParams.get("returnTo")!, page.url()).searchParams.get("interval")).toBe(interval);
    await page.screenshot({ path: test.info().outputPath("selected-trial.png"), fullPage: true });
  });
}

test("mobile comparison keeps feature names visible at the last plan", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/pricing");
  const table = page.getByRole("table");
  await table.scrollIntoViewIfNeeded();
  const label = table.getByRole("rowheader", { name: "Questions asked per audit run", exact: true });
  const before = await label.boundingBox();
  await table.evaluate((el) => { el.parentElement!.scrollLeft = el.parentElement!.scrollWidth; });
  const after = await label.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  expect(after!.width).toBeLessThan(185);
  await expect(table.getByRole("columnheader", { name: "Pro", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: test.info().outputPath("sticky-comparison.png") });
});

test("public report exposes sample details and an actionable remaining-evidence link", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/report/sample");
  const panel = page.getByRole("region", { name: "Run methodology" });
  await expect(panel).toContainText("gpt-5-mini-2025-08-07");
  await expect(panel).toContainText("UTC");
  await expect(panel).toContainText("5 usable answers");
  await expect(panel).toContainText("1 saved answer per question/provider pair");
  await expect(panel).toContainText("not recorded");
  await expect(page.getByRole("link", { name: "Compare plans for full evidence" })).toHaveAttribute("href", "/pricing");
  await expect(page.getByText(/Score weights: mentions 65%/)).toBeVisible();
  await expect(page.getByText("buyer_question", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await panel.screenshot({ path: test.info().outputPath("methodology-panel.png") });
});
