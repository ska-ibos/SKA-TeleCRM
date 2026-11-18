import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/data/memory.store";
import { createMember, listDepartments, listTeam, setMemberDepartments } from "@/lib/services/team.service";
import { memberDepartmentsSchema } from "@/lib/validations";

async function fresh() {
  const store = new MemoryStore();
  const depts = await listDepartments(store);
  const byKey = (k: number) => depts.find((d) => d.ivr_key === k)!;
  const m = await createMember(store, { full_name: "Nisha Rao", role: "agent", status: "available", is_crm_desk: false, is_active: true, email: null, phone: null }, null);
  const deptMembers = async (k: number) => (await listDepartments(store)).find((d) => d.ivr_key === k)!.members.map((x) => x.full_name);
  return { store, byKey, m, deptMembers };
}

describe("departments chosen on the Team form", () => {
  it("show the member under exactly those departments on the Departments page", async () => {
    const { store, byKey, m, deptMembers } = await fresh();
    await setMemberDepartments(store, m.id, [byKey(3).id, byKey(5).id], null);
    expect(await deptMembers(3)).toContain("Nisha Rao");
    expect(await deptMembers(5)).toContain("Nisha Rao");
    expect(await deptMembers(4)).not.toContain("Nisha Rao");
    const row = (await listTeam(store)).find((x) => x.id === m.id)!;
    expect(row.departments.map((d) => d.ivr_key).sort()).toEqual([3, 5]);
  });
  it("moves the member when the selection changes, and is idempotent", async () => {
    const { store, byKey, m, deptMembers } = await fresh();
    await setMemberDepartments(store, m.id, [byKey(3).id], null);
    await setMemberDepartments(store, m.id, [byKey(4).id], null);
    await setMemberDepartments(store, m.id, [byKey(4).id], null);
    expect(await deptMembers(3)).not.toContain("Nisha Rao");
    expect((await deptMembers(4)).filter((n) => n === "Nisha Rao")).toHaveLength(1);
  });
  it("survives two parallel saves of the same selection", async () => {
    const { store, byKey, m, deptMembers } = await fresh();
    await Promise.all([setMemberDepartments(store, m.id, [byKey(6).id], null), setMemberDepartments(store, m.id, [byKey(6).id], null)]);
    expect((await deptMembers(6)).filter((n) => n === "Nisha Rao")).toHaveLength(1);
  });
  it("rejects the missed-call key and unknown departments", async () => {
    const { store, byKey, m } = await fresh();
    await expect(setMemberDepartments(store, m.id, [byKey(2).id], null)).rejects.toThrow(/missed-call/i);
    await expect(setMemberDepartments(store, m.id, ["00000000-0000-4000-8000-000000000000"], null)).rejects.toThrow(/not found/i);
  });
  it("validates the request field", () => {
    expect(memberDepartmentsSchema.parse({}).department_ids).toBeUndefined();
    expect(memberDepartmentsSchema.safeParse({ department_ids: ["x"] }).success).toBe(false);
    const id = "11111111-1111-4111-8111-111111111111";
    expect(memberDepartmentsSchema.safeParse({ department_ids: [id, id] }).success).toBe(false);
  });
});
