import { describe, expect, it } from "vitest";
import { maskPii } from "@/lib/ai/pii";

describe("maskPii", () => {
  it("masks an Aadhaar number", () => {
    const { masked, counts } = maskPii("आधार संख्या 234567890123 है");
    expect(masked).toContain("[AADHAAR]");
    expect(counts.AADHAAR).toBe(1);
  });

  it("masks an Indian mobile number", () => {
    const { masked } = maskPii("Call me on 9876543210 or +91 98765 43210");
    expect(masked).not.toMatch(/9876543210/);
    expect(masked).toContain("[PHONE]");
  });

  it("masks Devanagari digits by first normalizing them", () => {
    const { masked } = maskPii("फ़ोन: ९८७६५४३२१०");
    expect(masked).toContain("[PHONE]");
  });

  it("leaves ordinary text untouched", () => {
    const { masked, counts } = maskPii("This notice is about property tax for ward 12");
    expect(masked).toBe("This notice is about property tax for ward 12");
    expect(counts).toEqual({});
  });
});
