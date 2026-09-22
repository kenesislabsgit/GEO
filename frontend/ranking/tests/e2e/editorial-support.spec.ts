import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { blogPosts } from "../../lib/blog";

test("support needs only email and issue, and does not send hidden sales details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/contact");
  await page
    .getByLabel("Company name", { exact: false })
    .fill("Old sales details");
  await page
    .getByRole("combobox", { name: /What are you interested in/ })
    .click();
  await page
    .getByRole("option", { name: "Account or billing support", exact: true })
    .click();
  await expect(page.getByLabel("Company name", { exact: false })).toBeHidden();
  await expect(
    page.getByLabel("Company website", { exact: false }),
  ).toBeHidden();
  await page
    .getByLabel("Account email", { exact: false })
    .fill("customer@example.com");
  await page
    .getByLabel("How can we help?", { exact: false })
    .fill("Please help with a duplicate payment.");
  let sent: Record<string, unknown> | undefined;
  await page.route("**/api/contact", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true}',
    });
  });
  await page.screenshot({
    path: test.info().outputPath("support-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Send support request", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "We got it." })).toBeVisible();
  expect(sent?.companyName).toBe("");
  expect(sent?.website).toBe("");
  await expect(
    page.getByText(/will reply to customer@example.com/),
  ).toBeVisible();
});

test("all nine articles have visible attribution, primary-source links and page-specific social metadata", async ({
  page,
  request,
}) => {
  for (const post of blogPosts) {
    await page.goto(`/blog/${post.slug}`);
    const article = page.locator("article");
    await expect(
      article.getByRole("link", { name: "Arcanoris editorial team" }),
    ).toBeVisible();
    expect(
      await article.locator('a[href^="https://"]').count(),
    ).toBeGreaterThan(0);
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
      "content",
      `${post.title} · Arcanoris`,
    );
    await expect(
      page.locator('meta[name="twitter:description"]'),
    ).toHaveAttribute("content", post.description);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      new RegExp(`/blog/${post.slug}$`),
    );
    const image = await page
      .locator('meta[name="twitter:image"]')
      .getAttribute("content");
    expect(image).toContain("/social-image?");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      image!,
    );
  }
  await page.goto("/blog/how-ai-crawlers-work");
  await expect(page.locator("article")).toContainText("Claude-SearchBot");
  await expect(page.locator("article")).toContainText(
    "longest matching path wins",
  );
  await expect(page.locator("article")).not.toContainText(
    "Training + Claude web search",
  );
  const image = await page
    .locator('meta[name="twitter:image"]')
    .getAttribute("content");
  const response = await request.get(
    new URL(image!).pathname + new URL(image!).search,
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  await writeFile(
    test.info().outputPath("article-social.png"),
    await response.body(),
  );
});

test("related-article links navigate and marketing pages have distinct previews", async ({
  page,
  request,
}) => {
  await page.goto("/blog/structuring-content-for-answer-engines");
  await page
    .getByRole("link", { name: "schema markup guide", exact: true })
    .click();
  await page.waitForURL(/\/schema-markup-for-ai-answer-engines$/);
  await page.goto("/blog/how-to-get-chatgpt-to-recommend-your-brand");
  await expect(page.locator("article")).toContainText(
    "Branded comparison research is a separate exercise",
  );
  await page
    .getByRole("link", { name: "crawler guide", exact: true })
    .first()
    .click();
  await page.waitForURL(/\/how-ai-crawlers-work$/);
  for (const path of ["/pricing", "/methodology", "/report/sample"]) {
    await page.goto(path);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      new RegExp(`${path}$`),
    );
    const title = await page
      .locator('meta[name="twitter:title"]')
      .getAttribute("content");
    expect(title).not.toBe("Arcanoris - Does AI recommend your company?");
    const image = new URL(
      (await page
        .locator('meta[name="twitter:image"]')
        .getAttribute("content"))!,
    );
    if (path !== "/report/sample") {
      const response = await request.get(image.pathname + image.search);
      expect(response.status()).toBe(200);
      await writeFile(
        test.info().outputPath(`${path.slice(1)}-social.png`),
        await response.body(),
      );
    }
  }
});

test("sample report CTA remains visible and separate from mobile illustration", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  const link = page.getByRole("link", {
    name: "View a sample report",
    exact: true,
  });
  await expect(link).toBeVisible();
  const linkBox = await link.boundingBox();
  const illustration = await page
    .locator("[data-hero-illustration]")
    .boundingBox();
  expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(illustration!.y);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await link.click();
  await page.waitForURL(/\/report\/sample$/);
});
