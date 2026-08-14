import net from "node:net";

/**
 * Public-address checks for SSRF protection. Everything loopback, private,
 * link-local, multicast, reserved, or cloud-metadata is refused. IPv6
 * mapped/embedded IPv4 is unwrapped and re-checked.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const PRIVATE_V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3], // multicast + reserved + broadcast
];

function inRange(ip: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (baseInt & mask);
}

export function isPublicIpv4(ip: string): boolean {
  const asInt = ipv4ToInt(ip);
  if (asInt === null) return false;
  return !PRIVATE_V4_RANGES.some(([base, bits]) => inRange(asInt, base, bits));
}

export function isPublicIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Mapped/translated IPv4 - judge the embedded address.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);
  if (lower === "::" || lower === "::1") return false;
  if (lower.startsWith("fe80:")) return false; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return false; // ULA
  if (lower.startsWith("ff")) return false; // multicast
  if (lower.startsWith("2001:db8")) return false; // documentation
  if (lower.startsWith("64:ff9b")) {
    // NAT64 - embedded IPv4 in the last 32 bits; refuse rather than parse.
    return false;
  }
  return true;
}

/** True only for a literal IP that is globally routable. */
export function isPublicIpAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPublicIpv4(ip);
  if (kind === 6) return isPublicIpv6(ip);
  return false;
}
