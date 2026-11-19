import { describe, expect, it } from "vitest";
import { buildRequest, formatNumber, looksFailed, sendWhatsApp, whatsappConfig, type WhatsAppConfig } from "@/lib/notify/whatsapp";
import { dispatchDueReminders } from "@/lib/services/reminder-dispatch.service";
import type { Reminder } from "@/types";
import { MON_11AM, at, setup } from "../helpers";

const GET_CFG: WhatsAppConfig = {
  url: "https://panel.sendbuddy.test/api/send?number={number}&type=text&message={message}&instance_id=I1&access_token=T1",
  method: "GET", body: null, numberFormat: "cc",
};

describe("SendBuddy request", () => {
  it("fills the panel's URL template, URL-encoding the message", () => {
    const { url, init } = buildRequest(GET_CFG, "919876543210", "Due: 10:00 & call Hiren");
    expect(url).toBe("https://panel.sendbuddy.test/api/send?number=919876543210&type=text&message=Due%3A%2010%3A00%20%26%20call%20Hiren&instance_id=I1&access_token=T1");
    expect(init.method).toBe("GET");
  });

  it("supports a POST JSON body template", () => {
    const cfg: WhatsAppConfig = { url: "https://panel.sendbuddy.test/api/send", method: "POST", numberFormat: "e164",
      body: '{"number":"{number}","message":"{message}","instance_id":"I1"}' };
    const { init } = buildRequest(cfg, "+919876543210", 'Line 1\nsays "hi"');
    expect(JSON.parse(String(init.body))).toEqual({ number: "+919876543210", message: 'Line 1\nsays "hi"', instance_id: "I1" });
  });

  it("formats numbers the way the panel expects", () => {
    expect(formatNumber("98765 43210", "cc")).toBe("919876543210");
    expect(formatNumber("98765 43210", "e164")).toBe("+919876543210");
    expect(formatNumber("98765 43210", "local")).toBe("9876543210");
    expect(formatNumber("12", "cc")).toBeNull();
  });

  it("reads the configuration from the environment and refuses unsafe templates", () => {
    expect(whatsappConfig({})).toBeNull();
    expect(whatsappConfig({ SENDBUDDY_SEND_URL: GET_CFG.url, SENDBUDDY_METHOD: "post", SENDBUDDY_NUMBER_FORMAT: "LOCAL" }))
      .toMatchObject({ method: "POST", numberFormat: "local" });
    expect(() => buildRequest({ ...GET_CFG, url: "https://panel.test/api/send?to=x" }, "91", "m")).toThrow(/\{number\}/);
    expect(() => buildRequest({ ...GET_CFG, url: "http://panel.test/send?n={number}" }, "91", "m")).toThrow(/https/);
  });

  it("treats an error flag in a 200 response as a failure, and never leaks the URL", async () => {
    expect(looksFailed('{"status":"error","message":"Instance disconnected"}')).toBe("Instance disconnected");
    expect(looksFailed('{"success":false}')).toMatch(/failure/);
    expect(looksFailed('{"status":"success"}')).toBeNull();
    expect(looksFailed("OK")).toBeNull();
    const fail = (async () => new Response('{"status":"error","message":"Instance disconnected"}')) as typeof fetch;
    await expect(sendWhatsApp("9876543210", "hi", { config: GET_CFG, fetchImpl: fail })).rejects.toThrow("SendBuddy: Instance disconnected");
    const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const err = await sendWhatsApp("9876543210", "hi", { config: GET_CFG, fetchImpl: down }).catch((e: Error) => e);
    expect((err as Error).message).not.toContain("access_token");
  });
});

describe("reminder dispatch", () => {
  async function seed() {
    const t = await setup();
    await t.store.update("team_members", t.member("Hiren").id, { phone: "+919811100002" });
    const mk = (title: string, due: Date, extra: Record<string, unknown> = {}) => t.store.insert<Reminder>("reminders", {
      title, due_at: due.toISOString(), status: "pending", source: "manual", assigned_to: t.member("Hiren").id, client_id: t.client.id, ...extra,
    });
    return { t, mk };
  }

  it("sends each due reminder once to the assignee's mobile", async () => {
    const { t, mk } = await seed();
    await mk("Send GSTR-3B copy", at(MON_11AM, -0.5));
    await mk("Later", at(MON_11AM, 2));
    const sent: { to: string; text: string }[] = [];
    const send = async (to: string, text: string) => { sent.push({ to, text }); return { ok: true as const }; };
    expect(await dispatchDueReminders(t.store, { now: MON_11AM, send })).toMatchObject({ sent: 1, failed: 0 });
    expect(sent[0].to).toBe("+919811100002");
    expect(sent[0].text).toContain("SKA TeleCRM reminder: Send GSTR-3B copy");
    expect(sent[0].text).toContain("Client: Rahul Client");
    expect(await dispatchDueReminders(t.store, { now: at(MON_11AM, 0.1), send })).toMatchObject({ sent: 0 }); // not again
  });

  it("retries a failed send on the next run and keeps the error", async () => {
    const { t, mk } = await seed();
    const r = await mk("Call back", at(MON_11AM, -0.1));
    const boom = async () => { throw new Error("Instance disconnected"); };
    expect(await dispatchDueReminders(t.store, { now: MON_11AM, send: boom })).toMatchObject({ failed: 1 });
    expect(await t.store.get<Reminder>("reminders", r.id)).toMatchObject({ notified_at: null, notify_error: "Instance disconnected" });
    const ok = async () => ({ ok: true as const });
    expect(await dispatchDueReminders(t.store, { now: at(MON_11AM, 0.1), send: ok })).toMatchObject({ sent: 1 });
  });

  it("skips in-app-only reminders, assignees without a mobile, old and finished reminders", async () => {
    const { t, mk } = await seed();
    await mk("In app only", at(MON_11AM, -0.1), { notify_via: "in_app" });
    const noPhone = await mk("Komal's", at(MON_11AM, -0.1), { assigned_to: t.member("Komal").id });
    await mk("Two days old", at(MON_11AM, -48));
    await mk("Done already", at(MON_11AM, -0.1), { status: "done" });
    const sent: string[] = [];
    const send = async (to: string) => { sent.push(to); return { ok: true as const }; };
    expect(await dispatchDueReminders(t.store, { now: MON_11AM, send })).toMatchObject({ sent: 0, skipped: 2 });
    expect((await t.store.get<Reminder>("reminders", noPhone.id))!.notify_error).toMatch(/No WhatsApp number for Komal/);
    expect(sent).toEqual([]);
  });

  it("does nothing when SendBuddy is not configured", async () => {
    const { t, mk } = await seed();
    await mk("x", at(MON_11AM, -0.1));
    expect(await dispatchDueReminders(t.store, { now: MON_11AM })).toMatchObject({ sent: 0, note: expect.stringMatching(/not configured/) });
  });
});
