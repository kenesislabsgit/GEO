import { expect, test } from "@playwright/test";

test("keyboard navigation starts with a working skip link", async ({
  page,
}) => {
  await page.goto("/pricing");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("invalid contact fields explain errors and receive focus without sending a request", async ({
  page,
}) => {
  let submissions = 0;
  await page.route("**/api/contact", async (route) => {
    submissions++;
    await route.abort();
  });
  await page.goto("/contact?intent=support");
  await page.waitForLoadState("networkidle");
  const submit = page.getByRole("button", {
    name: /Send (support request|sales inquiry)/,
  });
  await expect(submit).toBeEnabled();
  await submit.click();
  const invalid = page.locator('[aria-invalid="true"]').first();
  await expect(invalid).toBeFocused();
  const errorId = await invalid.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  await expect(page.locator(`[id="${errorId}"]`)).toBeVisible();
  expect(submissions).toBe(0);
});

test("public report methodology stays optional", async ({ page }) => {
  await page.goto("/report/sample");
  const panel = page.getByRole("region", { name: "Run methodology" });
  const details = panel.locator("details");
  await expect(details).not.toHaveAttribute("open");
  await panel.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(
    panel.getByText("AI assistant and model", { exact: true }),
  ).toBeVisible();
});

for (const width of [360, 390]) {
  test(`touch controls and layout fit at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width, height: 800 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    const menu = page.getByRole("button", { name: "Open menu" });
    const box = (await menu.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
    await menu.click();
    await expect(
      page.getByRole("navigation", { name: "Mobile navigation" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: test.info().outputPath(`pricing-${width}.png`),
      fullPage: true,
    });
    await page.goto("/report/sample");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: test.info().outputPath(`report-${width}.png`),
      fullPage: true,
    });
    await page.screenshot({
      path: test.info().outputPath(`report-top-${width}.png`),
    });
    await context.close();
  });
}
