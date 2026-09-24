import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("interface strings", () => {
  it("Hindi and English have the same keys", () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort());
  });
  it("no empty strings", () => {
    for (const m of [en, hi]) {
      const flat = JSON.stringify(m);
      expect(flat).not.toMatch(/:""/);
    }
  });
});
