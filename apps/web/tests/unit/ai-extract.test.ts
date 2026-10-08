import { describe, expect, it } from "vitest";
import { rulesExtract } from "@/lib/ai/extract";

describe("rulesExtract", () => {
  it("extracts a property tax notice with amount and deadline", () => {
    const text = "Lucknow Nagar Nigam. Property tax due. Total payable Rs. 12,500/- by 15.03.2027.";
    const f = rulesExtract(text, new Date("2027-01-01T00:00:00Z"));
    expect(f.notice_type.value).toBe("property_tax");
    expect(f.authority.value).toBe("Lucknow Nagar Nigam");
    expect(f.amount.value).toBe(12500);
    expect(f.deadline.value).toBe("2027-03-15");
  });

  it("falls back to general with low confidence when nothing matches", () => {
    const f = rulesExtract("Hello, just a short message.");
    expect(f.notice_type.value).toBe("general");
    expect(f.notice_type.confidence).toBeLessThan(0.5);
  });

  it("handles Hindi electricity bill text", () => {
    const f = rulesExtract("मध्यांचल विद्युत वितरण निगम। बिजली बिल बकाया राशि ₹2,340 अंतिम तिथि 10 जून, 2027");
    expect(f.notice_type.value).toBe("electricity_bill");
    expect(f.authority.value).toBe("Madhyanchal Vidyut Vitran Nigam (UPPCL)");
    expect(f.amount.value).toBe(2340);
  });
});
