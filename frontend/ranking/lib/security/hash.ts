import { createHash } from "crypto";

export function hashIp(ip: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "rankedbyai-local";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}
