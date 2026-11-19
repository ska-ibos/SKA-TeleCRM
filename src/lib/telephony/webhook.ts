import { timingSafeEqual } from "node:crypto";
import { AppError } from "../data/types";
import { getProvider } from "./provider.factory";

/**
 * Exotel calls our endpoints with plain GET/POST requests and cannot add custom headers or
 * sign them, so the shared secret travels in the URL we configure in the call flow:
 *   https://<app>/api/exotel/flow/connect?token=<TELEPHONY_WEBHOOK_SECRET>
 * The `x-webhook-secret` header is also accepted (curl tests, other callers).
 */
export function assertWebhook(req: Request) {
  const expected = process.env.TELEPHONY_WEBHOOK_SECRET?.trim();
  if (!expected) throw new AppError(503, "webhook_not_configured", "TELEPHONY_WEBHOOK_SECRET is not set on the server");
  const got = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-webhook-secret") ?? "";
  if (!safeEqual(got, expected)) throw new AppError(401, "invalid_signature", "Webhook authentication failed");
  return getProvider("exotel");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Public URL of one of our webhook endpoints, with the secret, for Exotel to call back. */
export function webhookUrl(path: string): string {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.TELEPHONY_WEBHOOK_SECRET?.trim();
  if (!base || !/^https:\/\//.test(base)) throw new AppError(503, "base_url_missing", "APP_BASE_URL must be set to the app's public https address");
  if (!secret) throw new AppError(503, "webhook_not_configured", "TELEPHONY_WEBHOOK_SECRET is not set on the server");
  return `${base}${path}?token=${encodeURIComponent(secret)}`;
}
