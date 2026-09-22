import { expect, test } from "@playwright/test";

const sources = [
  ["Sift", "https://sift.com/platform/"],
  ["Adyen", "https://www.adyen.com/pricing"],
  ["Riskified", "https://www.riskified.com/lp/partner/shopify/"],
  ["Adyen MarketPay", "https://docs.adyen.com/classic-platforms/reports-and-fees/marketpay-payout-report/"],
  ["Chargebee (RevRec)", "https://www.chargebee.com/revenue-recognition-software/"],
];

for (const width of [360, 1280]) {
  test(`sample report evidence is inspectable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/report/sample");
    for (const [name, url] of sources) {
      const card = page.locator(`[data-competitor="${name}"]`);
      await expect(card.getByRole("link", { name, exact: true })).toHaveAttribute("href", url);
      await card.locator("summary").click();
      await expect(card.locator("blockquote").first()).toBeVisible();
      await expect(card.locator("details").getByRole("link", { name: url, exact: true })).toHaveAttribute("href", url);
    }
    const sift = page.locator('[data-competitor="Sift"]');
    await expect(sift.locator("summary")).toHaveText("Source verified · View evidence");
    await expect(sift.getByText("Revenue Replaces Risk When CX meets AI", { exact: true })).toBeVisible();
    await expect(page.locator('[data-competitor="Adyen"] summary')).toHaveText("AI-cited source · View evidence");
    const action = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your best next action" }) });
    await action.scrollIntoViewIfNeeded();
    await expect(action.getByRole("link", { name: "https://sift.com/platform", exact: true })).toHaveAttribute("href", "https://sift.com/platform");
    await expect(action.getByRole("link", { name: "https://sift.com/platform/new-releases", exact: true })).toHaveAttribute("href", "https://sift.com/platform/new-releases");
    await expect(action.getByRole("link", { name: "Open passage", exact: true })).toHaveCount(2);
    for (const link of await action.getByRole("link", { name: "Open passage", exact: true }).all()) {
      expect(await link.getAttribute("href")).toContain("#:~:text=");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await action.screenshot({ path: test.info().outputPath("recommendation-evidence.png") });
  });
}
