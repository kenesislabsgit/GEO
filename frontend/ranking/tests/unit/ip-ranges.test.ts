import { describe, expect, it } from "vitest";
import {
  isPublicIpAddress,
  isPublicIpv4,
  isPublicIpv6,
} from "@/lib/security/ip-ranges";

/** Web-tier SSRF guard: the address classifier behind safe-fetch. */
describe("public address classification", () => {
  it("blocks loopback, private, link-local, CGNAT, multicast v4", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPublicIpv4(ip), ip).toBe(false);
    }
  });

  it("blocks loopback, ULA, link-local, mapped-private v6", () => {
    for (const ip of [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd00::abcd",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.0.1",
    ]) {
      expect(isPublicIpv6(ip), ip).toBe(false);
    }
  });

  it("allows genuinely public addresses", () => {
    expect(isPublicIpv4("93.184.216.34")).toBe(true);
    expect(isPublicIpv6("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  it("rejects non-IP garbage outright", () => {
    expect(isPublicIpAddress("localhost")).toBe(false);
    expect(isPublicIpAddress("example.com")).toBe(false);
    expect(isPublicIpAddress("")).toBe(false);
  });
});
