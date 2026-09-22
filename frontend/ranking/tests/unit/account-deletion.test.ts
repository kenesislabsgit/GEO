import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/auth/auth", () => ({
  auth: { api: { signOut: vi.fn(async () => {}) } },
}));
vi.mock("@/lib/db/pg", () => ({
  q: vi.fn(),
  exec: vi.fn(),
  withTransaction: vi.fn(async (fn: () => Promise<void>) => fn()),
}));
vi.mock("@/lib/scans/queue", () => ({
  cancelActiveScansForUser: vi.fn(async () => {}),
}));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

import { POST } from "@/app/api/account/delete/route";
import { exec, q, withTransaction } from "@/lib/db/pg";
import { cancelActiveScansForUser } from "@/lib/scans/queue";

const request = () =>
  new NextRequest("http://localhost/api/account/delete", {
    method: "POST",
    body: JSON.stringify({ confirm: "DELETE" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DODO_PAYMENTS_API_KEY", "test-key");
  vi.mocked(q).mockResolvedValue([{ provider_subscription_id: "sub-1" }]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("account deletion billing safety", () => {
  it.each(["http", "network", "configuration"])(
    "keeps records when cancellation fails: %s",
    async (failure) => {
      const fetch = vi.fn();
      if (failure === "http")
        fetch.mockResolvedValue({ ok: false, status: 503 });
      if (failure === "network") fetch.mockRejectedValue(new Error("offline"));
      if (failure === "configuration") vi.stubEnv("DODO_PAYMENTS_API_KEY", "");
      vi.stubGlobal("fetch", fetch);
      expect((await POST(request())).status).toBe(502);
      expect(withTransaction).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalled();
      expect(cancelActiveScansForUser).not.toHaveBeenCalled();
    },
  );

  it("deletes only after the provider confirms cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    expect((await POST(request())).status).toBe(200);
    expect(cancelActiveScansForUser).toHaveBeenCalledWith("user-1");
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(exec).toHaveBeenCalledWith('delete from "user" where id = $1', [
      "user-1",
    ]);
  });

  it("allows a free account to be deleted without payment configuration", async () => {
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "");
    vi.mocked(q).mockResolvedValue([]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await POST(request())).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
});
