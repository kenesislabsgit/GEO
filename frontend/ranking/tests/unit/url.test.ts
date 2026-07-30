import { describe, expect, it } from "vitest";
import {
  normalizeDomain,
  UrlValidationError,
  isSafePublicUrl,
} from "@/lib/security/url";

describe("normalizeDomain", () => {
  it("normalizes bare domains and strips www", () => {
    expect(normalizeDomain("WWW.Example.COM")).toBe("example.com");
    expect(normalizeDomain("https://example.com/path")).toBe("example.com");
  });

  it("blocks localhost and private networks", () => {
    expect(() => normalizeDomain("localhost")).toThrow(UrlValidationError);
    expect(() => normalizeDomain("127.0.0.1")).toThrow(UrlValidationError);
    expect(() => normalizeDomain("http://192.168.1.10")).toThrow(
      UrlValidationError,
    );
    expect(() => normalizeDomain("http://10.0.0.5")).toThrow(UrlValidationError);
  });

  it("blocks unsupported protocols", () => {
    expect(() => normalizeDomain("ftp://example.com")).toThrow(
      UrlValidationError,
    );
  });
});

describe("isSafePublicUrl", () => {
  it("accepts https public URLs", () => {
    expect(isSafePublicUrl("https://example.com/about")).toBe(true);
  });

  it("rejects metadata hosts", () => {
    expect(isSafePublicUrl("http://metadata.google.internal")).toBe(false);
  });
});
