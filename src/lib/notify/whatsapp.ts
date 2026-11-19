import { AppError } from "../data/types";
import { normalizePhone } from "../utils/phone";

/**
 * WhatsApp through SendBuddy (the firm's existing WhatsApp panel, spec §11.2).
 *
 * SendBuddy shows each account its own "send message" API URL (panel → API / Developer),
 * including the account's instance id / access token. Paste that URL into
 * SENDBUDDY_SEND_URL and replace the phone number and the message text with the
 * placeholders {number} and {message}, e.g.
 *
 *   https://<your-panel>/api/send?number={number}&type=text&message={message}&instance_id=…&access_token=…
 *
 * For a panel that expects POST, set SENDBUDDY_METHOD=POST and put the body in SENDBUDDY_BODY
 * (JSON, same placeholders). Values are URL-encoded in the URL and JSON-escaped in the body.
 * SENDBUDDY_NUMBER_FORMAT: "cc" (default, 919876543210), "e164" (+919876543210) or "local" (9876543210).
 *
 * The URL carries the account's token: it lives only in the server environment and is
 * never logged or returned to the browser.
 */
export interface WhatsAppConfig { url: string; method: "GET" | "POST"; body: string | null; numberFormat: "cc" | "e164" | "local" }

export function whatsappConfig(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
  const url = env.SENDBUDDY_SEND_URL?.trim();
  if (!url) return null;
  const method = env.SENDBUDDY_METHOD?.trim().toUpperCase() === "POST" ? "POST" : "GET";
  const f = env.SENDBUDDY_NUMBER_FORMAT?.trim().toLowerCase();
  return { url, method, body: env.SENDBUDDY_BODY?.trim() || null, numberFormat: f === "e164" || f === "local" ? f : "cc" };
}

export const whatsappEnabled = () => whatsappConfig() !== null;

export function formatNumber(phone: string, f: WhatsAppConfig["numberFormat"]): string | null {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  if (f === "e164") return e164;
  if (f === "local") return e164.startsWith("+91") ? e164.slice(3) : e164.slice(1);
  return e164.slice(1);
}

/** Fill the template. Exported for tests. */
export function buildRequest(cfg: WhatsAppConfig, number: string, message: string): { url: string; init: RequestInit } {
  if (!cfg.url.includes("{number}") && !cfg.body?.includes("{number}")) {
    throw new AppError(503, "whatsapp_misconfigured", "SENDBUDDY_SEND_URL (or SENDBUDDY_BODY) must contain {number}");
  }
  const enc = (s: string) => encodeURIComponent(s);
  const url = cfg.url.replaceAll("{number}", enc(number)).replaceAll("{message}", enc(message));
  if (!/^https:\/\//.test(url)) throw new AppError(503, "whatsapp_misconfigured", "SENDBUDDY_SEND_URL must be an https URL");
  if (cfg.method === "GET") return { url, init: { method: "GET" } };
  const json = (s: string) => JSON.stringify(s).slice(1, -1);
  const body = (cfg.body ?? "").replaceAll("{number}", json(number)).replaceAll("{message}", json(message));
  return { url, init: { method: "POST", headers: { "content-type": "application/json" }, body } };
}

/** Panels answer 200 even for some failures; treat an explicit error flag in the body as a failure. */
export function looksFailed(text: string): string | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const status = typeof o.status === "string" ? o.status.toLowerCase() : o.status;
  if (o.success === false || status === false || status === "error" || status === "failed" || status === "failure") {
    return String(o.message ?? o.error ?? o.msg ?? "SendBuddy reported a failure").slice(0, 300);
  }
  return null;
}

export async function sendWhatsApp(phone: string, message: string, opts: { fetchImpl?: typeof fetch; config?: WhatsAppConfig | null } = {}) {
  const cfg = opts.config === undefined ? whatsappConfig() : opts.config;
  if (!cfg) throw new AppError(503, "whatsapp_not_configured", "WhatsApp (SendBuddy) is not configured");
  const number = formatNumber(phone, cfg.numberFormat);
  if (!number) throw new AppError(400, "bad_request", "Not a valid WhatsApp number");
  const { url, init } = buildRequest(cfg, number, message.slice(0, 1000));
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new AppError(502, "whatsapp_unreachable", `SendBuddy could not be reached (${(e as Error).name})`); // no URL: it holds the token
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new AppError(502, "whatsapp_rejected", `SendBuddy answered HTTP ${res.status}`);
  const failed = looksFailed(text);
  if (failed) throw new AppError(502, "whatsapp_rejected", `SendBuddy: ${failed}`);
  return { ok: true as const };
}
