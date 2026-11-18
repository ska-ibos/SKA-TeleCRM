import { describe, expect, it } from "vitest";
import { dateRangeErrors, localYmd, parseYmd, rangeDays, rangeToIso, shiftYmd } from "@/lib/utils/date-range";
import { dateRangeSchema } from "@/lib/validations";

const TODAY = "2026-11-05";

describe("report From/To (browser)", () => {
  it("accepts a normal range, a single day and exactly 366 days", () => {
    expect(dateRangeErrors("2026-10-07", TODAY, TODAY)).toEqual({});
    expect(dateRangeErrors(TODAY, TODAY, TODAY)).toEqual({});
    expect(dateRangeErrors("2025-11-05", TODAY, TODAY)).toEqual({}); // 366 days inclusive
  });
  it("requires both dates", () => {
    expect(dateRangeErrors("", "", TODAY)).toEqual({ from: "Choose a start date", to: "Choose an end date" });
  });
  it("rejects impossible calendar dates", () => {
    expect(dateRangeErrors("2026-02-31", TODAY, TODAY).from).toMatch(/valid date/);
    expect(dateRangeErrors("20261-01-01", TODAY, TODAY).from).toMatch(/valid date/);
  });
  it("rejects future dates and dates before 2020", () => {
    expect(dateRangeErrors("2026-11-06", "2026-11-06", TODAY)).toMatchObject({ from: expect.stringMatching(/future/), to: expect.stringMatching(/future/) });
    expect(dateRangeErrors("2019-12-31", TODAY, TODAY).from).toMatch(/before/);
  });
  it("rejects To before From and ranges over 366 days", () => {
    expect(dateRangeErrors(TODAY, "2026-11-01", TODAY).to).toMatch(/on or after the start/);
    expect(dateRangeErrors("2025-11-04", TODAY, TODAY).to).toMatch(/at most 366 days \(this is 367\)/);
  });
  it("helpers work on local calendar days", () => {
    expect(shiftYmd(-29, TODAY)).toBe("2026-10-07");
    expect(shiftYmd(1, "2024-02-28")).toBe("2024-02-29");
    expect(rangeDays("2026-11-01", TODAY)).toBe(5);
    expect(parseYmd("2026-11-05")?.getDate()).toBe(5);
    expect(localYmd(new Date(2026, 0, 2, 1, 0))).toBe("2026-01-02");
    const r = rangeToIso(TODAY, TODAY);
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(86400_000 - 1);
  });
});

describe("dateRangeSchema (API)", () => {
  const iso = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();
  it("accepts open-ended and normal ranges", () => {
    expect(dateRangeSchema.safeParse({}).success).toBe(true);
    expect(dateRangeSchema.safeParse({ from: iso(-1) }).success).toBe(true);
    expect(dateRangeSchema.safeParse({ from: iso(-30), to: iso(0.5) }).success).toBe(true);
  });
  it("compares instants, not strings, across timezone offsets", () => {
    // 10:00 IST is before 06:00 UTC the same day although the string sorts later
    expect(dateRangeSchema.safeParse({ from: "2026-11-01T10:00:00+05:30", to: "2026-11-01T06:00:00Z" }).success).toBe(true);
  });
  it("rejects garbage, reversed, too long, future and pre-2020 ranges", () => {
    expect(dateRangeSchema.safeParse({ from: "yesterday" }).success).toBe(false);
    expect(dateRangeSchema.safeParse({ from: iso(-2), to: iso(-3) }).success).toBe(false);
    expect(dateRangeSchema.safeParse({ from: iso(-400), to: iso(0) }).success).toBe(false);
    expect(dateRangeSchema.safeParse({ from: iso(2) }).success).toBe(false);
    expect(dateRangeSchema.safeParse({ to: iso(3) }).success).toBe(false);
    expect(dateRangeSchema.safeParse({ from: "2019-06-01T00:00:00Z" }).success).toBe(false);
  });
  it("puts the error on the right field", () => {
    const r = dateRangeSchema.safeParse({ from: iso(-2), to: iso(-3) });
    expect(r.success ? [] : r.error.issues.map((i) => i.path[0])).toEqual(["to"]);
  });
});
