import { expect, test } from "@playwright/test";

test("homepage closer and footer share a background and one primary action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const closer = page.locator("main section").last();
  const footer = page.locator("footer");
  await closer.scrollIntoViewIfNeeded();
  await expect(closer.getByRole("link", { name: "Run free audit" })).toBeVisible();
  await expect(closer.locator("a")).toHaveCount(1);
  await expect(footer.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);
  const closerBackground = await closer.evaluate(el => getComputedStyle(el).backgroundColor);
  const footerBackground = await footer.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(closerBackground).toBe(footerBackground);
  await expect(closer.locator(".arc-reveal")).toHaveCSS("opacity", "1");
  for (const item of await closer.locator(".arc-rise").all()) {
    await expect(item).toHaveCSS("opacity", "1");
  }
  await page.screenshot({ path: test.info().outputPath("closer-footer-mobile.png") });
});
