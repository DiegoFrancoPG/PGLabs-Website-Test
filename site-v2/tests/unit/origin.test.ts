import { describe, it, expect } from "vitest";
import { isAllowedOrigin } from "@/lib/origin";

/* spec/05's Origin check on cookie-authenticated mutations (proxy.ts). */
describe("isAllowedOrigin", () => {
  const served = { host: "pg-learn.vercel.app", proto: "https" };

  it("accepts the configured origin", () => {
    expect(isAllowedOrigin("https://old.example.org", "https://old.example.org", served)).toBe(true);
  });

  it("accepts the origin the app is served on, even when the setting is stale", () => {
    expect(isAllowedOrigin("https://pg-learn.vercel.app", "https://old.example.org", served)).toBe(true);
    expect(isAllowedOrigin("https://pg-learn.vercel.app", undefined, served)).toBe(true);
  });

  it("refuses a foreign origin and an absent one", () => {
    expect(isAllowedOrigin("https://evil.example", "https://old.example.org", served)).toBe(false);
    expect(isAllowedOrigin(null, "https://pg-learn.vercel.app", served)).toBe(false);
  });

  it("does not accept http when served on https, or another port", () => {
    expect(isAllowedOrigin("http://pg-learn.vercel.app", undefined, served)).toBe(false);
    expect(isAllowedOrigin("https://pg-learn.vercel.app:8443", undefined, served)).toBe(false);
  });

  it("reads the first value of a forwarded list and tolerates bad input", () => {
    expect(
      isAllowedOrigin("https://pg-learn.vercel.app", undefined, {
        host: "pg-learn.vercel.app, internal",
        proto: "https,http",
      })
    ).toBe(true);
    expect(isAllowedOrigin("https://x.org", "not a url", { host: null, proto: null })).toBe(false);
  });
});
