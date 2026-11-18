import { timingSafeEqual } from "node:crypto";
import { AppError } from "../data/types";
import { getProvider } from "./provider.factory";

/** Guards provider webhooks: provider must be configured and the shared secret must match. */
export function assertWebhook(req: Request) {
  const provider = getProvider("exotel");
  if (!provider.isConfigured()) throw new AppError(503, "provider_not_configured", "Exotel credentials are not configured. Use the simulator.");
  const expected = process.env.TELEPHONY_WEBHOOK_SECRET;
  const got = req.headers.get("x-webhook-secret") ?? "";
  if (!expected || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    throw new AppError(401, "invalid_signature", "Webhook authentication failed");
  }
  return provider;
}
