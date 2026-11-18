import { describe, expect, it } from "vitest";
import { clientCreateSchema, extensionSchema, reminderSchema, routingConfigSchema, simulatorSchema, teamMemberSchema } from "@/lib/validations";
import { can } from "@/lib/auth/permissions";
import { DEFAULT_ROUTING_CONFIG } from "@/lib/constants";
import { decodeDemoSession, encodeDemoSession } from "@/lib/auth/session";

describe("client validation", () => {
  it("normalises and uppercases", () => {
    const r = clientCreateSchema.parse({ name: " Rahul ", pan: "abcde1234f", email: "", phones: [{ phone: "98765 43210" }] });
    expect(r).toMatchObject({ name: "Rahul", pan: "ABCDE1234F", email: null, phones: [{ phone: "+919876543210", label: "mobile" }] });
  });
  it("rejects bad PAN/GSTIN/email/phones/duplicates", () => {
    const r = clientCreateSchema.safeParse({ name: "A", pan: "123", gstin: "XX", email: "x@", phones: [{ phone: "9876543210" }, { phone: "+919876543210" }] });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["name", "pan", "gstin", "email", "phones"]));
  });
  it("requires at least one phone and blocks script-like names", () => {
    expect(clientCreateSchema.safeParse({ name: "Valid", phones: [] }).success).toBe(false);
    expect(clientCreateSchema.safeParse({ name: "<script>", phones: [{ phone: "9876543210" }] }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("extensions must be 2–6 digits (single digits reserved for IVR)", () => {
    const id = "6f1c1d2e-8c1a-4b7a-9d55-1a2b3c4d5e6f";
    expect(extensionSchema.safeParse({ team_member_id: id, extension: "7" }).success).toBe(false);
    expect(extensionSchema.parse({ team_member_id: id, extension: "205" }).extension).toBe("205");
    expect(extensionSchema.parse({ team_member_id: id, extension: "" }).extension).toBeNull();
  });
  it("team member role enum + phone", () => {
    expect(teamMemberSchema.safeParse({ full_name: "Komal", role: "superuser" }).success).toBe(false);
    expect(teamMemberSchema.parse({ full_name: "Komal", role: "agent", phone: "" }).phone).toBeNull();
  });
  it("reminder needs ISO date", () => {
    expect(reminderSchema.safeParse({ title: "Call", due_at: "tomorrow" }).success).toBe(false);
  });
  it("routing config: closing after opening, at least one day", () => {
    const bad = { ...DEFAULT_ROUTING_CONFIG, office_hours: { ...DEFAULT_ROUTING_CONFIG.office_hours, start: "19:00", end: "10:00", days: [] } };
    expect(routingConfigSchema.safeParse(bad).success).toBe(false);
    expect(routingConfigSchema.safeParse(DEFAULT_ROUTING_CONFIG).success).toBe(true);
  });
  it("simulator requires idempotency key", () => {
    expect(simulatorSchema.safeParse({ action: "start", from: "9876543210" }).success).toBe(false);
  });
});

describe("roles", () => {
  it.each([
    ["admin", "settings:write", true], ["manager", "settings:write", false], ["agent", "clients:write", false],
    ["crm_desk", "clients:write", true], ["manager", "clients:delete", true], ["crm_desk", "clients:delete", false],
    ["agent", "simulator:use", true], ["agent", "reports:read", false], ["admin", "audit:read", true], ["manager", "audit:read", false],
  ] as const)("%s %s -> %s", (role, perm, expected) => expect(can(role, perm)).toBe(expected));
});

describe("demo session cookie", () => {
  it("round-trips and rejects tampering", () => {
    const t = encodeDemoSession({ id: "demo-admin", name: "Demo Admin", email: null, role: "admin", memberId: null });
    expect(decodeDemoSession(t)?.role).toBe("admin");
    const [p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), role: "admin", name: "x" })).toString("base64url");
    expect(decodeDemoSession(`${forged}.${s}`)).toBeNull();
    expect(decodeDemoSession("garbage")).toBeNull();
  });
});

import { loginSchema } from "@/lib/validations";
import { authMode } from "@/lib/data/store";
describe("login", () => {
  it("accepts SKA OS usernames and emails, rejects junk", () => {
    expect(loginSchema.safeParse({ identifier: " dhruv ", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "a.b_c2", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "me@singlekeyadvisory.com", password: "short" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "ab", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: "bad name!", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: "dhruv", password: "" }).success).toBe(false);
  });
  it("partial Supabase config is reported, never a silent half-mode", () => {
    const keep = { ...process.env };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(authMode()).toEqual({ mode: "misconfigured", missing: ["SUPABASE_SERVICE_ROLE_KEY"] });
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    expect(authMode().mode).toBe("supabase");
    process.env = keep;
  });
});
