import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));

import { SiteFooter } from "@/components/site/footer";
import { getSessionUser } from "@/lib/auth/session";

describe("footer account navigation", () => {
  it("hides Dashboard for logged-out visitors and keeps public navigation", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const html = renderToStaticMarkup(await SiteFooter());
    expect(html).not.toContain('href="/dashboard"');
    expect(html).toContain('href="/methodology"');
    expect(html).toContain('href="/pricing"');
  });

  it("shows Dashboard for an authenticated visitor", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "user-1", email: "visitor@example.com" });
    const html = renderToStaticMarkup(await SiteFooter());
    expect(html).toContain('href="/dashboard"');
  });
});
