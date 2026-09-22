import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 360, height: 640 }, { width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`hero artwork stays below essential content at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const hero = page.locator("main section").first();
    const illustration = hero.locator("[data-hero-illustration]");
    const accountInfo = hero.getByText(/Free account · no card/);
    const description = hero.getByText(/The free report checks ChatGPT/);
    const button = hero.getByRole("button", { name: "Run free audit" });
    await expect(accountInfo).toHaveCSS("opacity", "1");
    for (const content of [hero.locator("h1"), description, hero.locator("form"), accountInfo]) {
      const contentBox = (await content.boundingBox())!;
      const artBox = (await illustration.boundingBox())!;
      expect(contentBox.y + contentBox.height).toBeLessThanOrEqual(artBox.y);
    }
    await expect(illustration).toHaveCSS("overflow", "hidden");
    // Wait for the animated overlays, then ensure none escape the art subtree.
    await expect(illustration.locator(".hero-phone-chat, .hero-speech-bubble").first()).toBeAttached({ timeout: 15000 });
    expect(await hero.locator(".hero-phone-chat, .hero-speech-bubble").count()).toBe(
      await illustration.locator(".hero-phone-chat, .hero-speech-bubble").count(),
    );
    await button.click({ trial: true });
    await page.screenshot({ path: test.info().outputPath("hero-mobile.png") });
    // Larger text must grow the content area and push the illustration down.
    await page.addStyleTag({ content: "html { font-size: 20px !important; }" });
    const enlargedInfo = (await accountInfo.boundingBox())!;
    const enlargedArt = (await illustration.boundingBox())!;
    expect(enlargedInfo.y + enlargedInfo.height).toBeLessThanOrEqual(enlargedArt.y);
  });
}

test("desktop retains the crowd as a full hero backdrop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const hero = page.locator("main section").first();
  const illustration = hero.locator("[data-hero-illustration]");
  await expect(illustration).toHaveCSS("position", "absolute");
  const heroBox = (await hero.boundingBox())!;
  const artBox = (await illustration.boundingBox())!;
  expect(artBox).toEqual(heroBox);
});
