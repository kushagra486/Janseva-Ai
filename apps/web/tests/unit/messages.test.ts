import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";

describe("interface strings", () => {
  it("no empty strings", () => {
    expect(JSON.stringify(en)).not.toMatch(/:""/);
  });
});
