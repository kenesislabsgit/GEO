import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { one } from "@/lib/db/pg";

/**
 * Rate limiting that works across every instance. Upstash Redis when
 * configured; otherwise fixed windows in Postgres - the store all web
 * instances and workers already share. Never process memory: a per-process
 * Map resets on deploy and multiplies by instance count.
 */

function getRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  return Redis.fromEnv();
}

/** Fixed-window counter in Postgres. One round trip per check. */
async function pgLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ success: boolean }> {
  const row = await one<{ count: number }>(
    `insert into rate_limits (key, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start)
     do update set count = rate_limits.count + 1
     returning count`,
    [key, windowSeconds],
  );
  return { success: (row?.count ?? 1) <= limit };
}

async function limit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<{ success: boolean }> {
  const redis = getRedis();
  if (redis) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
      prefix: "rbai:rl",
    });
    return limiter.limit(key);
  }
  return pgLimit(key, max, windowSeconds);
}

export async function limitIp(ip: string): Promise<{ success: boolean }> {
  return limit(`ip:${ip}`, 5, 3600);
}

/**
 * A short cooldown per website. Several people are allowed to audit the same
 * website, so this only smooths bursts on one site - it never locks a site to
 * whoever audited it first.
 */
export async function limitDomainBurst(
  domain: string,
): Promise<{ success: boolean }> {
  return limit(`domain:${domain}`, 3, 120);
}

/**
 * Audit starts are the most expensive thing a user can do. Burst and daily
 * caps per account, plus an hourly cap per IP for shared/abusive networks.
 */
export async function limitAuditStart(
  userId: string,
  ip: string,
): Promise<{ ok: boolean }> {
  const [burst, daily, byIp] = await Promise.all([
    limit(`audit:burst:${userId}`, 5, 300),
    limit(`audit:day:${userId}`, 30, 86_400),
    limit(`audit:ip:${ip}`, 20, 3600),
  ]);
  return { ok: burst.success && daily.success && byIp.success };
}

/** Cheap per-route guard for other sensitive endpoints. */
export async function limitAction(
  name: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<{ success: boolean }> {
  return limit(`${name}:${key}`, max, windowSeconds);
}

export async function withIdempotency(
  key: string,
  ttlSeconds: number,
): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    const ok = await redis.set(`rbai:idem:${key}`, "1", {
      nx: true,
      ex: ttlSeconds,
    });
    return ok === "OK";
  }
  const result = await pgLimit(`idem:${key}`, 1, ttlSeconds);
  return result.success;
}
