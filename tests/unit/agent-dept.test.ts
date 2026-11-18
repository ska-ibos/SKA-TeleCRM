import { describe, expect, it } from "vitest";
import { agentChoices, deptChoices, pickAgent, pickDept } from "@/lib/utils/agent-dept";

const GST = { id: "gst" }, MIS = { id: "mis" }, TAX = { id: "tax" }, ROC = { id: "roc" };
const DEPTS = [GST, MIS, TAX, ROC];
const MEMBERS = [
  { id: "priya", departments: [GST] },            // one department
  { id: "amit", departments: [GST, MIS] },        // several
  { id: "neha", departments: [TAX] },             // TAX has a single member
  { id: "ravi", departments: [] },                // none
];

describe("agent -> department", () => {
  it("auto-selects the only department", () => expect(pickAgent(MEMBERS, DEPTS, "priya", "")).toEqual({ agent: "priya", dept: "gst" }));
  it("narrows to the agent's departments when several", () => {
    expect(deptChoices(MEMBERS, DEPTS, "amit").map((d) => d.id)).toEqual(["gst", "mis"]);
    expect(pickAgent(MEMBERS, DEPTS, "amit", "mis").dept).toBe("mis");   // keeps a valid choice
    expect(pickAgent(MEMBERS, DEPTS, "amit", "tax").dept).toBe("");      // drops one that no longer fits
  });
  it("leaves departments open for an agent with none", () => {
    expect(deptChoices(MEMBERS, DEPTS, "ravi")).toHaveLength(4);
    expect(pickAgent(MEMBERS, DEPTS, "ravi", "roc").dept).toBe("roc");
  });
  it("clearing the agent keeps the department", () => expect(pickAgent(MEMBERS, DEPTS, "", "gst")).toEqual({ agent: "", dept: "gst" }));
});

describe("department -> agent", () => {
  it("auto-selects the only member", () => expect(pickDept(MEMBERS, "tax", "")).toEqual({ agent: "neha", dept: "tax" }));
  it("narrows to the department's members when several", () => {
    expect(agentChoices(MEMBERS, "gst").map((m) => m.id)).toEqual(["priya", "amit"]);
    expect(pickDept(MEMBERS, "gst", "amit").agent).toBe("amit");
    expect(pickDept(MEMBERS, "gst", "ravi").agent).toBe("");
  });
  it("leaves agents open for a department with no members", () => {
    expect(agentChoices(MEMBERS, "roc")).toHaveLength(4);
    expect(pickDept(MEMBERS, "roc", "ravi").agent).toBe("ravi");
  });
  it("clearing the department shows everyone again", () => {
    expect(pickDept(MEMBERS, "", "amit")).toEqual({ agent: "amit", dept: "" });
    expect(agentChoices(MEMBERS, "")).toHaveLength(4);
  });
});
