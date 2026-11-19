import { describe, expect, it } from "vitest";
import { teamMemberPatchSchema, routingConfigSchema } from "@/lib/validations";
import { buildReport } from "@/lib/services/report.service";
import { MemoryStore } from "@/lib/data/memory.store";
import { DEFAULT_ROUTING_CONFIG } from "@/lib/constants";

describe("team member PATCH", () => {
  it("changes only the fields that are sent (no defaults filled in)", () => {
    expect(teamMemberPatchSchema.parse({ role: "manager" })).toEqual({ role: "manager" });
    expect(teamMemberPatchSchema.parse({ is_active: false })).toEqual({ is_active: false });
  });
  it("still validates and normalises what is sent", () => {
    expect(teamMemberPatchSchema.parse({ phone: "98765 43210", email: "" })).toEqual({ phone: "+919876543210", email: null });
    expect(() => teamMemberPatchSchema.parse({ status: "asleep" })).toThrow();
  });
});

describe("reports with live telephony", () => {
  it("leave simulated calls out of the numbers when asked", async () => {
    const store = new MemoryStore();
    const base = { direction: "inbound", from_number: "+919800000001", to_number: "OPS", status: "completed", started_at: "2026-11-02T06:00:00.000Z", answered_at: "2026-11-02T06:00:10.000Z", provider: "simulation" };
    await store.insert("calls", { ...base, is_simulated: true });
    await store.insert("calls", { ...base, is_simulated: false, provider: "exotel" });
    expect((await buildReport(store, {})).totals.total).toBe(2);
    const live = await buildReport(store, {}, { excludeSimulated: true });
    expect(live.totals.total).toBe(1);
    expect(live.scanned).toBe(2);
  });
});

describe("live prompts", () => {
  it("default the welcome and recording notice for settings saved before they existed", () => {
    const { known_caller: _k, recording_notice: _r, ...old } = DEFAULT_ROUTING_CONFIG.prompts;
    const cfg = routingConfigSchema.parse({ ...DEFAULT_ROUTING_CONFIG, prompts: old });
    expect(cfg.prompts.known_caller).toBe("Namaste {name} ji.");
    expect(cfg.prompts.recording_notice).toMatch(/recorded/);
  });
  it("allow an empty recording notice and reject unknown placeholders", () => {
    const p = { ...DEFAULT_ROUTING_CONFIG.prompts, recording_notice: "", known_caller: "Hello {client}" };
    const r = routingConfigSchema.safeParse({ ...DEFAULT_ROUTING_CONFIG, prompts: p });
    expect(r.success).toBe(false);
    expect(routingConfigSchema.parse({ ...DEFAULT_ROUTING_CONFIG, prompts: { ...p, known_caller: "" } }).prompts.recording_notice).toBe("");
  });
});
