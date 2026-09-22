// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDetachedAudit } from "@/components/scan/use-detached-audit";
import { auditStorageKey } from "@/lib/scans/client-storage";

const storageKey = auditStorageKey("test-audit", "user-1");
const options = () => ({
  storageKey: "test-audit",
  userId: "user-1",
  onDone: vi.fn(),
});
const response = (status: number, data = {}) => ({
  ok: status < 400,
  status,
  json: async () => data,
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("detached audit recovery", () => {
  it.each([401, 403, 404])(
    "clears an inaccessible saved run on HTTP %i",
    async (status) => {
      localStorage.setItem(storageKey, "scan-1");
      const fetch = vi.fn().mockResolvedValue(response(status));
      vi.stubGlobal("fetch", fetch);
      const { result } = renderHook(() => useDetachedAudit(options()));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeTruthy();
      expect(localStorage.getItem(storageKey)).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("aborts a pending poll and ignores its late completion after unmount", async () => {
    localStorage.setItem(storageKey, "scan-1");
    let finish!: (value: ReturnType<typeof response>) => void;
    const fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const opts = options();
    const { unmount } = renderHook(() => useDetachedAudit(opts));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const signal = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
      .signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish(response(200, { status: "completed", brandId: "brand-1" }));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(opts.onDone).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not resume another account's saved run", async () => {
    localStorage.setItem(
      auditStorageKey("test-audit", "other-user"),
      "private-scan",
    );
    localStorage.setItem("test-audit", "legacy-unscoped-scan");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderHook(() => useDetachedAudit(options()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recovers from a transient failure, then finishes once", async () => {
    localStorage.setItem(storageKey, "scan-1");
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(
        response(200, { status: "completed", brandId: "brand-1" }),
      );
    vi.stubGlobal("fetch", fetch);
    const opts = options();
    const { result } = renderHook(() => useDetachedAudit(opts));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(opts.onDone).toHaveBeenCalledExactlyOnceWith("brand-1");
    expect(result.current.loading).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds failed retries and retains the run for a later reload", async () => {
    localStorage.setItem(storageKey, "scan-1");
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useDetachedAudit(options()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toContain("reload");
    expect(localStorage.getItem(storageKey)).toBe("scan-1");
  });

  it("starts and completes even when browser storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(200, { scanRunId: "scan-1" }))
        .mockResolvedValue(
          response(200, { status: "completed", brandId: "brand-1" }),
        ),
    );
    const opts = options();
    const { result } = renderHook(() => useDetachedAudit(opts));
    await act(async () => {
      await result.current.start({ domain: "example.com" });
    });
    expect(opts.onDone).toHaveBeenCalledWith("brand-1");
    expect(result.current.error).toBeNull();
  });
});
