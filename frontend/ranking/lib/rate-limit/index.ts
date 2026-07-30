import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type MemoryBucket = { count: number; resetAt: number };
const memory = new Map<string, MemoryBucket>();

function memoryLimit(
  key: string,
  limit: number,
  windowMs: number,
): { success: boolean; remaining: number } {
  const now = Date.now();
  const current = memory.get(key);
  if (!current || current.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1 };
  }
  if (current.count >= limit) {
    return { success: false, remaining: 0 };
  }
  current.count += 1;
  return { success: true, remaining: limit - current.count };
}

function getRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  return Redis.fromEnv();
}

export async function limitIp(ip: string): Promise<{ success: boolean }> {
  const redis = getRedis();
  if (!redis) {
    return memoryLimit(`ip:${ip}`, 5, 60 * 60 * 1000);
  }
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "1 h"),
    prefix: "rbai:ip",
  });
  return limiter.limit(ip);
}

/**
 * A short cooldown per website. Several people are allowed to audit the same
 * website, so this only smooths bursts on one site — it never locks a site to
 * whoever audited it first.
 */
export async function limitDomainBurst(
  domain: string,
): Promise<{ success: boolean }> {
  const redis = getRedis();
  if (!redis) {
    return memoryLimit(`domain:${domain}`, 3, 2 * 60 * 1000);
  }
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "2 m"),
    prefix: "rbai:domain",
  });
  return limiter.limit(domain);
}

export async function withIdempotency(
  key: string,
  ttlSeconds: number,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    const result = memoryLimit(`idem:${key}`, 1, ttlSeconds * 1000);
    return result.success;
  }
  const ok = await redis.set(`rbai:idem:${key}`, "1", {
    nx: true,
    ex: ttlSeconds,
  });
  return ok === "OK";
}
