import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/data/memory.store";
import { addPhone, createClient, deleteClient, findClientByPhone, getClientDetail, listClients, removePhone, updateClient } from "@/lib/services/client.service";
import { setDepartmentMembers, setExtension, listDepartments } from "@/lib/services/team.service";
import { createReminder, updateReminder } from "@/lib/services/reminder.service";
import { withIdempotency } from "@/lib/services/idempotency.service";
import { buildReport } from "@/lib/services/report.service";
import type { ClientPhone, SessionUser, TeamMember } from "@/types";

const base = { company: null, email: null, pan: null, gstin: null, city: null, status: "active" as const };
const agent = (m: TeamMember): SessionUser => ({ id: m.id, name: m.full_name, email: null, role: "agent", memberId: m.id, mode: "demo" });

describe("seed", () => {
  it("matches the department mapping", async () => {
    const depts = await listDepartments(new MemoryStore());
    const map = Object.fromEntries(depts.map((d) => [d.ivr_key, d.members.map((m) => m.full_name).sort()]));
    expect(map).toEqual({
      1: ["Jinofer"], 2: [], 3: ["Jenish", "Prassana", "Urja"], 4: ["Hiren", "Prassana", "Rajat", "Shruti"],
      5: ["Prachi", "Urja", "Vilas"], 6: ["Hiren", "Komal", "Rajat", "Shruti", "Sneha"], 7: ["Hiren", "Komal", "Rajat", "Shruti"],
      8: ["Hiren", "Komal", "Shruti"], 9: ["Rahul", "Shruti"],
    });
    const team = await new MemoryStore().list<TeamMember>("team_members");
    expect(team.every((m) => m.phone === null && m.extension === null)).toBe(true);
  });
});

describe("client CRUD", () => {
  it("create / read / update / delete with phones", async () => {
    const s = new MemoryStore();
    const c = await createClient(s, { ...base, name: "Rahul", phones: [{ phone: "+919800000001", label: "mobile" }, { phone: "+919800000002", label: "office" }] }, null);
    expect((await findClientByPhone(s, "+919800000002"))?.id).toBe(c.id);
    expect((await listClients(s, { q: "98000" }))).toHaveLength(1);
    await updateClient(s, c.id, { ...base, name: "Rahul Mehta", city: "Pune" }, null);
    const d = await getClientDetail(s, c.id);
    expect(d.client.name).toBe("Rahul Mehta");
    expect(d.phones.filter((p) => p.is_primary)).toHaveLength(1);
    await deleteClient(s, c.id, null);
    expect(await s.list("client_phone_numbers")).toHaveLength(0);
    expect((await s.list<{ action: string }>("audit_logs")).map((a) => a.action)).toEqual(["create", "update", "delete"]);
  });

  it("phone uniqueness across clients and last-phone protection", async () => {
    const s = new MemoryStore();
    const a = await createClient(s, { ...base, name: "A Client", phones: [{ phone: "+919800000001", label: "mobile" }] }, null);
    await expect(createClient(s, { ...base, name: "B Client", phones: [{ phone: "+919800000001", label: "mobile" }] }, null)).rejects.toMatchObject({ status: 409 });
    const [p] = await s.list<ClientPhone>("client_phone_numbers");
    await expect(removePhone(s, p.id, null)).rejects.toMatchObject({ status: 409 });
    const p2 = await addPhone(s, { client_id: a.id, phone: "+919800000003", label: "mobile", is_primary: true }, null);
    await removePhone(s, p.id, null);
    expect((await s.get<ClientPhone>("client_phone_numbers", p2.id))?.is_primary).toBe(true);
  });
});

describe("extensions & departments", () => {
  it("extension must be unique; missed-call dept has no fixed members", async () => {
    const s = new MemoryStore();
    const team = await s.list<TeamMember>("team_members");
    await setExtension(s, team[0].id, "101", null);
    await expect(setExtension(s, team[1].id, "101", null)).rejects.toMatchObject({ status: 409 });
    const d2 = (await listDepartments(s)).find((d) => d.ivr_key === 2)!;
    await expect(setDepartmentMembers(s, d2.id, [team[0].id], null)).rejects.toMatchObject({ status: 409 });
  });
});

describe("reminders", () => {
  it("agents can only update their own reminders; past due rejected", async () => {
    const s = new MemoryStore();
    const [a, b] = await s.list<TeamMember>("team_members");
    await expect(createReminder(s, { title: "Old", due_at: "2020-01-01T00:00:00Z" }, agent(a))).rejects.toMatchObject({ status: 400 });
    const r = await createReminder(s, { title: "Call back", due_at: new Date(Date.now() + 3600_000).toISOString() }, agent(a));
    expect(r.assigned_to).toBe(a.id);
    await expect(updateReminder(s, { id: r.id, status: "done" }, agent(b))).rejects.toMatchObject({ status: 403 });
    expect((await updateReminder(s, { id: r.id, status: "done" }, agent(a))).status).toBe("done");
  });
});

describe("idempotency", () => {
  it("runs once per key and replays the response; failures can retry", async () => {
    const s = new MemoryStore();
    let n = 0;
    const fn = async () => ({ n: ++n });
    expect(await withIdempotency(s, "p", "k1", fn)).toEqual({ n: 1 });
    expect(await withIdempotency(s, "p", "k1", fn)).toEqual({ n: 1 });
    await expect(withIdempotency(s, "p", "k2", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await withIdempotency(s, "p", "k2", fn)).toEqual({ n: 2 });
  });
});

describe("reports", () => {
  it("aggregates empty store", async () => {
    const r = await buildReport(new MemoryStore(), {});
    expect(r.totals.total).toBe(0);
  });
});
