import { expect, test } from "@playwright/test";
import {
  loadSampleQuestions,
  loadSampleReport,
} from "@/lib/reports/sample-report";

const report = loadSampleReport();
const questions = loadSampleQuestions();

for (const width of [360, 1280]) {
  test(`sample report evidence is inspectable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/report/sample");
    await expect(
      page.getByText("Plus sample report", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Demo note: Perplexity examples use saved ChatGPT answers and don’t contribute to scores/,
      ),
    ).toBeVisible();
    await page.getByLabel("Filter answer provider").selectOption("perplexity");
    await page
      .locator("button")
      .filter({ hasText: questions[0].question })
      .click();
    const simulated = page.locator("#answer-sample-0-perplexity-simulated");
    await expect(
      simulated.getByText(/^Mentions Stripe/),
    ).toBeVisible();
    await expect(page.getByText(/^(Example|Example response)$/)).toHaveCount(0);
    await expect(page.getByText(/simulated/i)).toHaveCount(0);
    await expect(page.getByLabel("Filter answer provider").locator('option[value="perplexity"]')).toHaveText("Perplexity");
    await expect(simulated.getByRole("link")).toHaveCount(0);
    await page
      .getByLabel("Filter answer provider")
      .selectOption("openai_search");
    const live = page.locator("#answer-sample-0-openai_search");
    await expect(live).toBeVisible();
    await expect(live.getByText("Example response", { exact: true })).toHaveCount(0);
    const citation = questions[0].answers.find(
      (answer) => answer.provider === "openai_search",
    )!.citations[0];
    if (citation)
      await expect(
        live.getByRole("link", { name: citation.label, exact: true }).first(),
      ).toHaveAttribute("href", citation.url);

    for (const competitor of report.competitorPreview) {
      if (!competitor.evidence.sourceUrl) continue;
      const card = page
        .locator("[data-competitor]")
        .filter({
          has: page.getByRole("link", { name: competitor.name, exact: true }),
        });
      await expect(
        card.getByRole("link", { name: competitor.name, exact: true }),
      ).toHaveAttribute("href", competitor.evidence.sourceUrl);
      await card.locator("summary").click();
      await expect(card.locator("blockquote").first()).toBeVisible();
    }
    const action = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Suggested next action" }),
      });
    await action.scrollIntoViewIfNeeded();
    const sources = report.recommendation!.sources;
    for (const [index, source] of sources.entries()) {
      if (source.url)
        await expect(
          action
            .locator(`#recommendation-source-${index}`)
            .getByRole("link", { name: source.url, exact: true }),
        ).toHaveAttribute("href", source.url);
    }
    await expect(
      action.getByRole("link", { name: "Open passage", exact: true }),
    ).toHaveCount(
      sources.filter((source) => source.url && source.excerpt).length,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByText("How this audit was run", { exact: true }).click();
    await expect(
      page.getByText(/80 usable answers across 20 questions/),
    ).toBeVisible();
    await action.screenshot({
      path: test.info().outputPath("recommendation-evidence.png"),
    });
  });
}
