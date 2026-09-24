import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES, INCOME_BANDS, OCCUPATIONS, REPORT_STATUSES, reminderDates } from "./index";

const py = readFileSync(resolve(__dirname, "../../../apps/ai-service/app/schemas.py"), "utf8");

function literal(name: string): string[] {
  const m = py.match(new RegExp(`${name}\\s*=\\s*Literal\\[([\\s\\S]*?)\\]`));
  if (!m) throw new Error(`${name} not found in schemas.py`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("contracts match the Python service", () => {
  it("categories", () => expect(literal("Category")).toEqual([...CATEGORIES]));
  it("statuses", () => expect(literal("ReportStatus")).toEqual([...REPORT_STATUSES]));
  it("income bands", () => expect(literal("IncomeBand")).toEqual([...INCOME_BANDS]));
  it("occupations", () => {
    const m = py.match(/occupation: Literal\[([\s\S]*?)\]/)!;
    expect([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])).toEqual([...OCCUPATIONS]);
  });
});

describe("reminderDates", () => {
  it("gives 7 days, 2 days and the due date", () => {
    expect(reminderDates("2026-10-31", "2026-10-01")).toEqual(["2026-10-24", "2026-10-29", "2026-10-31"]);
  });
  it("skips dates already past", () => {
    expect(reminderDates("2026-10-31", "2026-10-30")).toEqual(["2026-10-31"]);
  });
});
