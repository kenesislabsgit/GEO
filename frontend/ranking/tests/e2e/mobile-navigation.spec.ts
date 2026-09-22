import { expect, test } from "@playwright/test";

for (const width of [320, 360, 390]) {
  test(`mobile navigation and theme work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const header = page.locator("header");
    const trigger = header.getByRole("button", { name: "Open menu" });
    await expect(trigger).toBeVisible();
    await expect(header.getByRole("link", { name: "Run free audit" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Sign in" })).toBeHidden();
    await expect(header.getByRole("button", { name: "Toggle theme" })).toBeHidden();
    const controls = await Promise.all([
      header.getByRole("link", { name: "Arcanoris", exact: true }).boundingBox(),
      header.getByRole("link", { name: "Run free audit" }).boundingBox(),
      trigger.boundingBox(),
    ]);
    for (let i = 0; i < controls.length; i++) {
      const box = controls[i]!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (i > 0) expect(box.x - (controls[i - 1]!.x + controls[i - 1]!.width)).toBeGreaterThanOrEqual(6);
    }
    const logo = header.getByRole("link", { name: "Arcanoris", exact: true });
    for (const artwork of await logo.locator("svg").all()) {
      const bounds = (await artwork.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(controls[0]!.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(controls[0]!.x + controls[0]!.width + 0.1);
    }
    console.log(`${width}px header bounds: ${JSON.stringify(controls)}`);
    await header.screenshot({ path: test.info().outputPath("mobile-header.png") });

    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Menu", exact: true });
    await expect(menu).toBeVisible();
    for (const name of ["Pricing", "Sample report", "Methodology", "Blog", "Sign in"]) {
      await expect(menu.getByRole("link", { name, exact: true })).toBeVisible();
    }
    const previousTheme = await page.locator("html").getAttribute("class");
    await menu.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("class", previousTheme!);
    await page.screenshot({ path: test.info().outputPath("mobile-menu.png") });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await menu.getByRole("link", { name: "Pricing", exact: true }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(menu).toBeHidden();
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(menu).toBeHidden();
    await expect(trigger).toBeHidden();
    await expect(header.getByRole("link", { name: "Methodology", exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: "Toggle theme" })).toBeVisible();
  });
}

test("included pricing features use the same check weight", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pricing");
  const checks = page.locator("main svg.lucide-check");
  expect(await checks.count()).toBeGreaterThan(0);
  const styles = await checks.evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    return [style.color, style.opacity, style.width, style.height, node.getAttribute("stroke-width")].join("|");
  }));
  expect(new Set(styles).size).toBe(1);
  expect(styles[0]).toContain("|1|16px|16px|2.5");
});
