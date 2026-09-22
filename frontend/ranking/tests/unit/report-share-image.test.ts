import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/og", () => ({
  ImageResponse: class {
    element: ReactElement;
    constructor(element: ReactElement) {
      this.element = element;
    }
  },
}));
vi.mock("@/lib/db/repository", () => ({
  getBrandBySlug: vi.fn(),
  getLatestScanForBrand: vi.fn(),
  getScanRun: vi.fn(),
  getScoreForScan: vi.fn(),
}));
import {
  getBrandBySlug,
  getLatestScanForBrand,
  getScanRun,
  getScoreForScan,
} from "@/lib/db/repository";
import { reportShareImage } from "@/lib/reports/share-image";
import { routes } from "@/lib/routes";

const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
});

describe("historical report sharing", () => {
  it("pins both links and images to the selected audit", async () => {
    vi.mocked(getBrandBySlug).mockResolvedValue({
      id: "brand-1",
      name: "Example",
      visibility: "public",
    } as Awaited<ReturnType<typeof getBrandBySlug>>);
    vi.mocked(getScanRun).mockResolvedValue({
      id,
      brand_id: "brand-1",
      status: "completed",
      created_at: "2026-01-01",
    } as Awaited<ReturnType<typeof getScanRun>>);
    vi.mocked(getScoreForScan).mockResolvedValue({
      overall_score: 42,
      mention_rate: 0.5,
    } as Awaited<ReturnType<typeof getScoreForScan>>);
    const image = await reportShareImage("example", id);
    const html = renderToStaticMarkup(
      (image as unknown as { element: ReactElement }).element,
    );
    expect(html).toContain("Example");
    expect(html).toContain("42");
    expect(getLatestScanForBrand).not.toHaveBeenCalled();
    expect(routes.publicReport("example", id)).toContain(`?scan=${id}`);
    expect(routes.publicReportImage("example", id)).toContain(`?scan=${id}`);
  });

  it("does not expose another brand's scan or a private report", async () => {
    vi.mocked(getBrandBySlug).mockResolvedValue({
      id: "brand-1",
      name: "Secret Brand",
      visibility: "public",
    } as Awaited<ReturnType<typeof getBrandBySlug>>);
    vi.mocked(getScanRun).mockResolvedValue({
      id,
      brand_id: "other-brand",
      status: "completed",
    } as Awaited<ReturnType<typeof getScanRun>>);
    const image = await reportShareImage("example", id);
    expect(
      renderToStaticMarkup(
        (image as unknown as { element: ReactElement }).element,
      ),
    ).not.toContain("Secret Brand");
    expect(getScoreForScan).not.toHaveBeenCalled();
    vi.mocked(getBrandBySlug).mockResolvedValue({
      id: "brand-1",
      name: "Secret Brand",
      visibility: "private",
    } as Awaited<ReturnType<typeof getBrandBySlug>>);
    await reportShareImage("example", null);
    expect(getLatestScanForBrand).not.toHaveBeenCalled();
  });
});
