import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

import { createCluster } from "redis";

type ValkeyCluster = ReturnType<typeof createCluster>;

type PendingCall = {
  id: string;
  auditId: string;
  provider: string;
  estimatedTokens: number;
  resolve: (lease: AiLease) => void;
  reject: (error: Error) => void;
  cancelled: boolean;
};

export type AiLease = {
  id: string;
  provider: string;
  auditId: string;
};

type ProviderState = {
  active: number;
  queues: Map<string, PendingCall[]>;
  auditOrder: string[];
  nextAudit: number;
  lastAudit: string | null;
  pumping: boolean;
  wakeup: NodeJS.Timeout | null;
  requestTimes: number[];
  tokenEvents: Array<{ at: number; tokens: number }>;
  granted: number;
  capacityWaits: number;
};

type ProviderLimits = {
  concurrent: number;
  rpm: number;
  tpm: number;
};

const REDIS_ACQUIRE = `
local active_key = KEYS[1]
local request_bucket_key = KEYS[2]
local token_bucket_key = KEYS[3]
local audits_key = KEYS[4]
local audit_active_key = KEYS[5]
local now = tonumber(ARGV[1])
local lease_until = tonumber(ARGV[2])
local lease_id = ARGV[3]
local audit_id = ARGV[4]
local concurrent_limit = tonumber(ARGV[5])
local rpm_limit = tonumber(ARGV[6])
local tpm_limit = tonumber(ARGV[7])
local estimated_tokens = tonumber(ARGV[8])
local waiting_until = tonumber(ARGV[9])
local key_ttl = tonumber(ARGV[10])

local function refill_bucket(key, capacity, amount)
  if capacity <= 0 then
    return true, 0, 0
  end
  local values = redis.call('HMGET', key, 'available', 'updated_at')
  local available = tonumber(values[1]) or capacity
  local updated_at = tonumber(values[2]) or now
  if now > updated_at then
    available = math.min(capacity, available + ((now - updated_at) * capacity / 60000))
  end
  if available < amount then
    local wait_ms = math.ceil((amount - available) * 60000 / capacity)
    return false, math.max(50, wait_ms), available
  end
  return true, 0, available - amount
end

redis.call('ZREMRANGEBYSCORE', active_key, '-inf', now)
redis.call('ZREMRANGEBYSCORE', audits_key, '-inf', now)
redis.call('ZREMRANGEBYSCORE', audit_active_key, '-inf', now)
redis.call('ZADD', audits_key, 'GT', waiting_until, audit_id)

if redis.call('ZCARD', active_key) >= concurrent_limit then
  return {0, 250}
end

local audit_count = math.max(1, redis.call('ZCARD', audits_key))
local fair_limit = math.max(1, math.ceil(concurrent_limit / audit_count))
if redis.call('ZCARD', audit_active_key) >= fair_limit then
  return {0, 250}
end

local request_ok, request_wait, request_left = refill_bucket(request_bucket_key, rpm_limit, 1)
local token_ok, token_wait, token_left = refill_bucket(token_bucket_key, tpm_limit, estimated_tokens)
if not request_ok or not token_ok then
  return {0, math.max(request_wait, token_wait)}
end

redis.call('ZADD', active_key, lease_until, lease_id)
redis.call('ZADD', audit_active_key, lease_until, lease_id)
redis.call('ZADD', audits_key, 'GT', lease_until, audit_id)
redis.call('PEXPIRE', active_key, key_ttl)
redis.call('PEXPIRE', audit_active_key, key_ttl)
redis.call('PEXPIRE', audits_key, key_ttl)
if rpm_limit > 0 then
  redis.call('HSET', request_bucket_key, 'available', request_left, 'updated_at', now)
  redis.call('PEXPIRE', request_bucket_key, 120000)
end
if tpm_limit > 0 then
  redis.call('HSET', token_bucket_key, 'available', token_left, 'updated_at', now)
  redis.call('PEXPIRE', token_bucket_key, 120000)
end
return {1, 0}
`;

const REDIS_RELEASE = `
local active_key = KEYS[1]
local audits_key = KEYS[2]
local audit_active_key = KEYS[3]
local lease_id = ARGV[1]
local audit_id = ARGV[2]
local now = tonumber(ARGV[3])

redis.call('ZREM', active_key, lease_id)
redis.call('ZREM', audit_active_key, lease_id)
redis.call('ZREMRANGEBYSCORE', active_key, '-inf', now)
redis.call('ZREMRANGEBYSCORE', audit_active_key, '-inf', now)
if redis.call('ZCARD', audit_active_key) == 0 then
  redis.call('ZREM', audits_key, audit_id)
end
return 1
`;

function positiveNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function nonNegativeNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function envProvider(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function defaultConcurrency(provider: string): number {
  if (provider === "openai") return 12;
  if (provider.startsWith("bedrock")) return 8;
  if (provider === "anthropic" || provider === "gemini") return 8;
  return 6;
}

function getRedis(): ValkeyCluster | null {
  const host = process.env.ELASTICACHE_HOST?.trim();
  const username = process.env.ELASTICACHE_USERNAME?.trim();
  const password = process.env.ELASTICACHE_PASSWORD;
  if (!host || !username || !password) {
    return null;
  }
  const port = positiveNumber("ELASTICACHE_PORT", 6379);
  const redis = createCluster({
    rootNodes: [{ url: `rediss://${host}:${port}` }],
    defaults: {
      username,
      password,
      socket: {
        tls: true,
        connectTimeout: 5_000,
        reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 3_000),
      },
    },
  });
  // Connection failures are handled by the controller's local fallback.
  redis.on("error", () => {});
  return redis;
}

/**
 * Fair access to AI providers for every audit owned by this worker. Redis,
 * when configured, also enforces the provider totals across worker replicas.
 */
export class AiCallController {
  private readonly states = new Map<string, ProviderState>();
  private readonly leases = new Map<string, AiLease & { expires: NodeJS.Timeout }>();
  private readonly redis = getRedis();
  private redisConnection: Promise<ValkeyCluster> | null = null;
  private redisUnavailableUntil = 0;
  private readonly leaseMs = positiveNumber("AI_CALL_LEASE_SECONDS", 240) * 1000;
  private closed = false;

  limits(provider: string): ProviderLimits {
    const prefix = `AI_${envProvider(provider)}`;
    return {
      concurrent: positiveNumber(
        `${prefix}_MAX_CONCURRENT`,
        defaultConcurrency(provider),
      ),
      rpm: nonNegativeNumber(`${prefix}_RPM`, 0),
      tpm: nonNegativeNumber(`${prefix}_TPM`, 0),
    };
  }

  acquire(input: {
    auditId: string;
    provider: string;
    estimatedTokens?: number;
  }): { id: string; promise: Promise<AiLease>; cancel: () => void } {
    if (this.closed) throw new Error("AI controller is shutting down");
    const provider = input.provider.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    const auditId = input.auditId.trim();
    if (!provider || !auditId) throw new Error("auditId and provider are required");

    const state = this.state(provider);
    let pending!: PendingCall;
    const promise = new Promise<AiLease>((resolve, reject) => {
      pending = {
        id: randomUUID(),
        auditId,
        provider,
        estimatedTokens: Math.max(1, Math.floor(input.estimatedTokens ?? 1)),
        resolve,
        reject,
        cancelled: false,
      };
    });
    const queue = state.queues.get(auditId) ?? [];
    queue.push(pending);
    state.queues.set(auditId, queue);
    if (!state.auditOrder.includes(auditId)) state.auditOrder.push(auditId);
    void this.pump(provider);
    return {
      id: pending.id,
      promise,
      cancel: () => {
        pending.cancelled = true;
        this.removePending(state, pending);
        pending.reject(new Error("AI call cancelled while waiting"));
      },
    };
  }

  async release(leaseId: string): Promise<boolean> {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    clearTimeout(lease.expires);
    this.leases.delete(leaseId);
    const state = this.state(lease.provider);
    state.active = Math.max(0, state.active - 1);
    const redis = await this.connectedRedis();
    if (redis) {
      const providerKey = this.redisProviderKey(lease.provider);
      await redis
        .eval(REDIS_RELEASE, {
          keys: [
            `${providerKey}:active`,
            `${providerKey}:audits`,
            this.redisAuditActiveKey(lease.provider, lease.auditId),
          ],
          arguments: [leaseId, lease.auditId, String(Date.now())],
        })
        .catch(() => {});
    }
    if (!this.closed) void this.pump(lease.provider);
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const state of this.states.values()) {
      if (state.wakeup) clearTimeout(state.wakeup);
      state.wakeup = null;
      for (const queue of state.queues.values()) {
        for (const pending of queue) {
          pending.cancelled = true;
          pending.reject(new Error("AI controller is shutting down"));
        }
      }
      state.queues.clear();
      state.auditOrder = [];
    }
    await Promise.all([...this.leases.keys()].map((id) => this.release(id)));
    if (this.redis?.isOpen) await this.redis.close().catch(() => {});
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(
      [...this.states.entries()].map(([provider, state]) => [
        provider,
        {
          active: state.active,
          waiting: [...state.queues.values()].reduce((n, q) => n + q.length, 0),
          auditsWaiting: state.queues.size,
          granted: state.granted,
          capacityWaits: state.capacityWaits,
          limits: this.limits(provider),
        },
      ]),
    );
  }

  private state(provider: string): ProviderState {
    const current = this.states.get(provider);
    if (current) return current;
    const created: ProviderState = {
      active: 0,
      queues: new Map(),
      auditOrder: [],
      nextAudit: 0,
      lastAudit: null,
      pumping: false,
      wakeup: null,
      requestTimes: [],
      tokenEvents: [],
      granted: 0,
      capacityWaits: 0,
    };
    this.states.set(provider, created);
    return created;
  }

  private async pump(provider: string): Promise<void> {
    if (this.closed) return;
    const state = this.state(provider);
    if (state.pumping) return;
    state.pumping = true;
    try {
      const limits = this.limits(provider);
      while (state.active < limits.concurrent) {
        const pending = this.nextPending(state);
        if (!pending) break;
        const gate = await this.takeProviderCapacity(pending, limits, state);
        if (!gate.ok) {
          state.capacityWaits += 1;
          this.requeue(state, pending);
          this.schedulePump(provider, gate.waitMs);
          break;
        }
        state.active += 1;
        state.granted += 1;
        const lease: AiLease = {
          id: pending.id,
          provider: pending.provider,
          auditId: pending.auditId,
        };
        const expires = setTimeout(() => void this.release(lease.id), this.leaseMs);
        expires.unref();
        this.leases.set(lease.id, { ...lease, expires });
        pending.resolve(lease);
      }
    } finally {
      state.pumping = false;
    }
  }

  private nextPending(state: ProviderState): PendingCall | null {
    if (state.lastAudit && state.auditOrder.length > 1) {
      const previous = state.auditOrder.indexOf(state.lastAudit);
      if (previous >= 0) state.nextAudit = (previous + 1) % state.auditOrder.length;
    }
    while (state.auditOrder.length > 0) {
      if (state.nextAudit >= state.auditOrder.length) state.nextAudit = 0;
      const auditId = state.auditOrder[state.nextAudit];
      const queue = state.queues.get(auditId) ?? [];
      while (queue[0]?.cancelled) queue.shift();
      if (queue.length === 0) {
        state.queues.delete(auditId);
        state.auditOrder.splice(state.nextAudit, 1);
        continue;
      }
      const pending = queue.shift()!;
      state.lastAudit = auditId;
      if (queue.length === 0) {
        state.queues.delete(auditId);
        state.auditOrder.splice(state.nextAudit, 1);
      } else {
        state.nextAudit = (state.nextAudit + 1) % state.auditOrder.length;
      }
      return pending;
    }
    return null;
  }

  private requeue(state: ProviderState, pending: PendingCall): void {
    if (pending.cancelled) return;
    const queue = state.queues.get(pending.auditId) ?? [];
    queue.unshift(pending);
    state.queues.set(pending.auditId, queue);
    if (!state.auditOrder.includes(pending.auditId)) {
      state.auditOrder.push(pending.auditId);
    }
  }

  private removePending(state: ProviderState, pending: PendingCall): void {
    const queue = state.queues.get(pending.auditId);
    if (!queue) return;
    const index = queue.indexOf(pending);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) {
      state.queues.delete(pending.auditId);
      state.auditOrder = state.auditOrder.filter((id) => id !== pending.auditId);
    }
  }

  private schedulePump(provider: string, waitMs: number): void {
    const state = this.state(provider);
    if (state.wakeup) return;
    state.wakeup = setTimeout(() => {
      state.wakeup = null;
      void this.pump(provider);
    }, Math.max(50, Math.min(waitMs, 60_000)));
    state.wakeup.unref();
  }

  private async takeProviderCapacity(
    pending: PendingCall,
    limits: ProviderLimits,
    state: ProviderState,
  ): Promise<{ ok: boolean; waitMs: number }> {
    const redis = await this.connectedRedis();
    if (redis) {
      const now = Date.now();
      const providerKey = this.redisProviderKey(pending.provider);
      const keys = [
        `${providerKey}:active`,
        `${providerKey}:rpm`,
        `${providerKey}:tpm`,
        `${providerKey}:audits`,
        this.redisAuditActiveKey(pending.provider, pending.auditId),
      ];
      try {
        const result = (await redis.eval(REDIS_ACQUIRE, {
          keys,
          arguments: [
            now,
            now + this.leaseMs,
            pending.id,
            pending.auditId,
            limits.concurrent,
            limits.rpm,
            limits.tpm,
            pending.estimatedTokens,
            now + 5_000,
            this.leaseMs + 60_000,
          ].map(String),
        })) as unknown as [number, number];
        return { ok: Number(result[0]) === 1, waitMs: Number(result[1]) || 250 };
      } catch {
        // Losing Redis must reduce capacity, not stop paid audits completely.
        return this.takeLocalRateCapacity(pending, limits, state);
      }
    }
    return this.takeLocalRateCapacity(pending, limits, state);
  }

  private takeLocalRateCapacity(
    pending: PendingCall,
    limits: ProviderLimits,
    state: ProviderState,
  ): { ok: boolean; waitMs: number } {
    const now = Date.now();
    const cutoff = now - 60_000;
    state.requestTimes = state.requestTimes.filter((at) => at > cutoff);
    state.tokenEvents = state.tokenEvents.filter((event) => event.at > cutoff);
    const tokenTotal = state.tokenEvents.reduce((sum, event) => sum + event.tokens, 0);
    if (limits.rpm > 0 && state.requestTimes.length >= limits.rpm) {
      return { ok: false, waitMs: state.requestTimes[0] + 60_000 - now };
    }
    if (
      limits.tpm > 0 &&
      tokenTotal > 0 &&
      tokenTotal + pending.estimatedTokens > limits.tpm
    ) {
      return { ok: false, waitMs: state.tokenEvents[0].at + 60_000 - now };
    }
    state.requestTimes.push(now);
    state.tokenEvents.push({ at: now, tokens: pending.estimatedTokens });
    return { ok: true, waitMs: 0 };
  }

  private redisActiveKey(provider: string): string {
    return `${this.redisProviderKey(provider)}:active`;
  }

  private redisAuditActiveKey(provider: string, auditId: string): string {
    const safeAuditId = auditId.replace(/[^a-zA-Z0-9_-]+/g, "_");
    return `${this.redisProviderKey(provider)}:audit:${safeAuditId}:active`;
  }

  private redisProviderKey(provider: string): string {
    // The hash tag keeps every key used by one Lua call in one cluster slot.
    return `rbai:ai:{${provider}}`;
  }

  private async connectedRedis(): Promise<ValkeyCluster | null> {
    if (!this.redis) return null;
    if (this.redis.isOpen) return this.redis;
    if (Date.now() < this.redisUnavailableUntil) return null;
    if (!this.redisConnection) {
      this.redisConnection = this.redis.connect().finally(() => {
        this.redisConnection = null;
      });
    }
    try {
      return await this.redisConnection;
    } catch {
      this.redisUnavailableUntil = Date.now() + 10_000;
      return null;
    }
  }
}

export async function readJsonBody(
  request: NodeJS.ReadableStream,
  maxBytes = 16_384,
): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of request) {
    text += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("request too large");
  }
  return JSON.parse(text || "{}") as Record<string, unknown>;
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
