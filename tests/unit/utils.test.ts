import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "@/lib/utils/phone";
import { isWithinOfficeHours, nextOfficeOpening } from "@/lib/utils/date";
import { toCsv } from "@/lib/utils/csv";
import { rateLimit } from "@/lib/utils/rate-limit";
import { DEFAULT_ROUTING_CONFIG } from "@/lib/constants";

const OH = DEFAULT_ROUTING_CONFIG.office_hours;

describe("phone normalisation", () => {
  it.each([
    ["9876543210", "+919876543210"], ["09876543210", "+919876543210"], ["919876543210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"], ["0091 98765 43210", "+919876543210"], ["+14155550100", "+14155550100"],
    ["022 2345 6789", "+912223456789"],
  ])("%s -> %s", (i, o) => expect(normalizePhone(i)).toBe(o));
  it.each(["", "123", "abcdefghij", "+0123", "12345678901234567"])("rejects %j", (i) => expect(normalizePhone(i)).toBeNull());
  it("formats Indian mobiles", () => expect(formatPhone("+919876543210")).toBe("+91 98765 43210"));
});

describe("office hours (Asia/Kolkata, Mon–Sat 10–19)", () => {
  it.each([
    ["2026-11-02T04:30:00Z", true],  // Mon 10:00 IST
    ["2026-11-02T13:29:00Z", true],  // Mon 18:59
    ["2026-11-02T13:30:00Z", false], // Mon 19:00
    ["2026-11-02T04:29:00Z", false], // Mon 09:59
    ["2026-11-07T06:00:00Z", true],  // Sat
    ["2026-11-08T06:00:00Z", false], // Sun
  ])("%s -> %s", (iso, open) => expect(isWithinOfficeHours(new Date(iso), OH)).toBe(open));

  it("next opening after Saturday evening is Monday 10:00 IST", () => {
    expect(nextOfficeOpening(new Date("2026-11-07T15:00:00Z"), OH).toISOString()).toBe("2026-11-09T04:30:00.000Z");
  });
  it("next opening before 10 AM is same day", () => {
    expect(nextOfficeOpening(new Date("2026-11-03T02:00:00Z"), OH).toISOString()).toBe("2026-11-03T04:30:00.000Z");
  });
});

describe("csv", () => {
  it("escapes quotes/commas and neutralises formulas but keeps phone numbers", () => {
    const csv = toCsv([{ a: 'x,"y"', b: "=HYPERLINK()", c: "+919876543210", d: "+cmd" }]);
    expect(csv).toBe('a,b,c,d\r\n"x,""y""",\'=HYPERLINK(),+919876543210,\'+cmd');
  });
});

describe("rate limit", () => {
  it("blocks after the limit within a window", () => {
    const k = `t-${Math.random()}`;
    expect([1, 2, 3].map(() => rateLimit(k, 2))).toEqual([true, true, false]);
  });
});

import { pageWindow } from "@/hooks/usePagination";
describe("pagination window", () => {
  it("shows first, last, neighbours and gaps", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 5)).toEqual([1, 2, "gap", 5]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);       // gap of one page is shown as the page itself
    expect(pageWindow(11, 22)).toEqual([1, "gap", 10, 11, 12, "gap", 22]);
    expect(pageWindow(22, 22)).toEqual([1, "gap", 21, 22]);
  });
});
