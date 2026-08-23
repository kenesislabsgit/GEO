import { afterEach, describe, expect, it } from "vitest";

import { AiCallController } from "../worker/ai-controller";

describe("AI call controller", () => {
  afterEach(() => {
    delete process.env.AI_TEST_MAX_CONCURRENT;
    delete process.env.AI_TEST_RPM;
    delete process.env.AI_TEST_TPM;
  });

  it("gives waiting audits fair turns", async () => {
    process.env.AI_TEST_MAX_CONCURRENT = "1";
    const controller = new AiCallController();
    const a1 = controller.acquire({ auditId: "a", provider: "test" });
    const a2 = controller.acquire({ auditId: "a", provider: "test" });
    const b1 = controller.acquire({ auditId: "b", provider: "test" });

    const first = await a1.promise;
    expect(first.auditId).toBe("a");
    await controller.release(first.id);

    const second = await b1.promise;
    expect(second.auditId).toBe("b");
    await controller.release(second.id);

    const third = await a2.promise;
    expect(third.auditId).toBe("a");
    await controller.release(third.id);
    expect(controller.snapshot()).toMatchObject({
      test: { active: 0, waiting: 0 },
    });
  });

  it("keeps providers independent", async () => {
    process.env.AI_TEST_MAX_CONCURRENT = "1";
    const controller = new AiCallController();
    const firstWaiting = controller.acquire({ auditId: "a", provider: "test" });
    const secondWaiting = controller.acquire({ auditId: "a", provider: "other" });

    const [first, second] = await Promise.all([
      firstWaiting.promise,
      secondWaiting.promise,
    ]);
    expect(first.provider).toBe("test");
    expect(second.provider).toBe("other");
    await Promise.all([
      controller.release(first.id),
      controller.release(second.id),
    ]);
  });

  it("lets one audit use all spare capacity", async () => {
    process.env.AI_TEST_MAX_CONCURRENT = "4";
    const controller = new AiCallController();
    const waiters = Array.from({ length: 4 }, () =>
      controller.acquire({ auditId: "only-audit", provider: "test" }),
    );

    const leases = await Promise.all(waiters.map((waiting) => waiting.promise));
    expect(controller.snapshot()).toMatchObject({ test: { active: 4 } });
    await Promise.all(leases.map((lease) => controller.release(lease.id)));
  });

  it("advances five busy audits together without exceeding capacity", async () => {
    process.env.AI_TEST_MAX_CONCURRENT = "5";
    const controller = new AiCallController();
    const started: string[] = [];
    let active = 0;
    let highestActive = 0;

    const work = ["a", "b", "c", "d", "e"].flatMap((auditId) =>
      Array.from({ length: 5 }, async () => {
        const waiting = controller.acquire({ auditId, provider: "test" });
        const lease = await waiting.promise;
        started.push(auditId);
        active += 1;
        highestActive = Math.max(highestActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        await controller.release(lease.id);
      }),
    );

    await Promise.all(work);
    expect(new Set(started.slice(0, 10))).toEqual(
      new Set(["a", "b", "c", "d", "e"]),
    );
    expect(highestActive).toBe(5);
    expect(started).toHaveLength(25);
  });

  it("releases active capacity during shutdown", async () => {
    process.env.AI_TEST_MAX_CONCURRENT = "1";
    const controller = new AiCallController();
    const lease = await controller.acquire({ auditId: "a", provider: "test" }).promise;
    expect(lease.auditId).toBe("a");
    await controller.close();
    expect(controller.snapshot()).toMatchObject({ test: { active: 0 } });
    expect(() =>
      controller.acquire({ auditId: "b", provider: "test" }),
    ).toThrow("shutting down");
  });
});
