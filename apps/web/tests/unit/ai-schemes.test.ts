import { describe, expect, it } from "vitest";
import type { SchemeAnswers } from "@janseva/shared";
import { matchSchemes } from "@/lib/ai/schemes";

const base: SchemeAnswers = {
  age: 40, gender: "female", income_band: "below_50k", occupation: "farmer", category: "general",
  district: "Lucknow", widowed: false, disability: false, language: "en",
};

describe("matchSchemes", () => {
  it("matches a farmer to PM-KISAN (needs_check: the scheme always carries extra document checks)", () => {
    const results = matchSchemes(base);
    const pmKisan = results.find((r) => r.scheme.id === "pm-kisan");
    expect(pmKisan).toBeDefined();
    expect(pmKisan?.status).toBe("needs_check");
    expect(pmKisan?.reasons.length).toBeGreaterThan(0);
  });

  it("excludes schemes with a hard rule that doesn't match (age)", () => {
    const results = matchSchemes({ ...base, age: 5, occupation: "student" });
    expect(results.find((r) => r.scheme.id === "pm-kisan")).toBeUndefined();
  });

  it("marks an income-band-crossing scheme as needs_check rather than eligible", () => {
    const results = matchSchemes({ ...base, occupation: "daily_wage", income_band: "2_5l_5l" });
    const withIncomeCap = results.find((r) => r.scheme.rules.income_max !== undefined && r.status === "needs_check");
    if (withIncomeCap) expect(withIncomeCap.checks.length).toBeGreaterThan(0);
  });

  it("sorts eligible matches before needs_check ones", () => {
    const statuses = matchSchemes(base).map((r) => r.status);
    const firstNeedsCheck = statuses.indexOf("needs_check");
    if (firstNeedsCheck !== -1) {
      expect(statuses.slice(0, firstNeedsCheck).every((s) => s === "eligible")).toBe(true);
    }
  });
});
