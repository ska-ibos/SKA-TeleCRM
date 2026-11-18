import type { TelephonyProvider } from "./provider.interface";
import { ProviderNotConfiguredError } from "./provider.interface";

/**
 * Exotel adapter — PLACEHOLDER.
 * Intentionally makes NO network calls and invents NO request/response formats.
 * When official Exotel API documentation and credentials are supplied:
 *   1. implement dialAgent / placeOutbound / transfer against the documented endpoints;
 *   2. implement `toTelephonyEvent` to map Exotel's documented webhook fields into
 *      the provider-neutral `telephonyEventSchema` (src/lib/validations);
 *   3. implement `verifySignature` per Exotel's documented scheme.
 * The routing engine needs no change.
 */
export class ExotelProvider implements TelephonyProvider {
  readonly name = "exotel" as const;
  readonly isSimulation = false;

  isConfigured() {
    const e = process.env;
    return Boolean(e.EXOTEL_ACCOUNT_SID && e.EXOTEL_API_KEY && e.EXOTEL_API_TOKEN && e.EXOTEL_SUBDOMAIN);
  }
  private notReady(): never {
    if (!this.isConfigured()) throw new ProviderNotConfiguredError("Exotel");
    throw new Error("Exotel adapter not implemented yet - awaiting official API details.");
  }
  async dialAgent(): Promise<{ providerRef: string | null }> { this.notReady(); }
  async placeOutbound(): Promise<{ providerCallId: string | null }> { this.notReady(); }
  async transfer(): Promise<{ providerRef: string | null }> { this.notReady(); }
}

/** Map an Exotel webhook into the neutral event shape. Not implemented until the official format is confirmed. */
export function toTelephonyEvent(_raw: unknown): never {
  throw new Error("Exotel webhook mapping not implemented - awaiting official API details.");
}
