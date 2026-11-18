import { describe, expect, it } from "vitest";
import { alnumUpper, filterOptions, phoneError, sanitizePhone, type Option } from "@/components/common/form";
import { clientSchema, reminderSchema } from "@/lib/validations";

const OPTS: Option[] = [
  { value: "1", label: "Dhruv Patel", hint: "MIS · mis@singlekeyadvisory.com" },
  { value: "2", label: "Prachi Shah", hint: "+91 98765 43210", keywords: "+919876543210" },
  { value: "3", label: "Ramesh Iyer", hint: "GST" },
  { value: "4", label: "Zoë Müller" },
];

describe("searchable select filtering", () => {
  it("returns everything for an empty query", () => expect(filterOptions(OPTS, "  ")).toHaveLength(4));
  it("matches label, hint and is case-insensitive", () => {
    expect(filterOptions(OPTS, "PATEL").map((o) => o.value)).toEqual(["1"]);
    expect(filterOptions(OPTS, "gst").map((o) => o.value)).toEqual(["3"]);
  });
  it("requires every word to match", () => {
    expect(filterOptions(OPTS, "dhruv mis").map((o) => o.value)).toEqual(["1"]);
    expect(filterOptions(OPTS, "dhruv gst")).toEqual([]);
  });
  it("matches phone digits regardless of spacing or +91", () => {
    expect(filterOptions(OPTS, "9876543").map((o) => o.value)).toEqual(["2"]);
    expect(filterOptions(OPTS, "+91 98765").map((o) => o.value)).toEqual(["2"]);
  });
  it("ignores accents", () => expect(filterOptions(OPTS, "zoe muller").map((o) => o.value)).toEqual(["4"]));
});

describe("phone field validation", () => {
  it("strips characters a phone number cannot contain", () => {
    expect(sanitizePhone("98a76-5x4 3210")).toBe("9876-54 3210");
    expect(sanitizePhone("+91+98765")).toBe("+9198765");
    expect(sanitizePhone("1".repeat(30))).toHaveLength(20);
  });
  it("accepts valid Indian and international numbers", () => {
    for (const p of ["9876543210", "+91 98765 43210", "098765 43210", "022 2345 6789", "+44 20 7946 0958"]) expect(phoneError(p)).toBe("");
  });
  it("explains what is wrong", () => {
    expect(phoneError("", true)).toMatch(/required/);
    expect(phoneError("")).toBe("");
    expect(phoneError("98765")).toMatch(/too short/);
    expect(phoneError("5876543210")).toMatch(/start with 6, 7, 8 or 9/);
    expect(phoneError("1234567890123456")).toMatch(/too long/);
  });
});

describe("tightened field schemas", () => {
  it("upper-cases and strips PAN / GSTIN input", () => {
    expect(alnumUpper("abcde 1234-f", 10)).toBe("ABCDE1234F");
    expect(alnumUpper("27abcde1234f1z5xyz", 15)).toBe("27ABCDE1234F1Z5");
  });
  it("rejects odd characters in company and city, collapses spaces", () => {
    expect(clientSchema.safeParse({ name: "Acme", company: "Acme <script>" }).success).toBe(false);
    expect(clientSchema.safeParse({ name: "Acme", city: "Mumbai123" }).success).toBe(false);
    const ok = clientSchema.parse({ name: "Acme", company: "Shah  &  Sons (P) Ltd.", city: "Navi   Mumbai" });
    expect(ok.company).toBe("Shah & Sons (P) Ltd.");
    expect(ok.city).toBe("Navi Mumbai");
    expect(clientSchema.parse({ name: "Acme", company: "", city: "" })).toMatchObject({ company: null, city: null });
  });
  it("rejects reminders more than a year out", () => {
    const far = new Date(Date.now() + 400 * 86400_000).toISOString();
    const soon = new Date(Date.now() + 86400_000).toISOString();
    expect(reminderSchema.safeParse({ title: "Call back", due_at: far }).success).toBe(false);
    expect(reminderSchema.safeParse({ title: "Call back", due_at: soon }).success).toBe(true);
  });
});
