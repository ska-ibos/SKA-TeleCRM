import type { OutboundRequest, TelephonyProvider } from "./provider.interface";
import { ProviderNotConfiguredError } from "./provider.interface";
import { AppError } from "../data/types";
import { webhookUrl } from "./webhook";

/**
 * Exotel adapter (PSTN plan: agents answer on their own mobiles).
 *
 * Inbound calls are driven by the Exotel call flow (App Bazaar): Exotel calls our
 * /api/exotel/flow/* endpoints and the Connect applet rings whichever number we return.
 * So `dialAgent` has nothing to send - the Connect applet fetches the agent's number.
 *
 * Outbound click-to-call uses "Connect Two Numbers":
 *   POST https://<subdomain>/v1/Accounts/<sid>/Calls/connect.json   (HTTP Basic: API key / token)
 *   From = agent mobile (rung first), To = client, CallerId = ExoPhone,
 *   StatusCallback -> /api/exotel/status (answered + terminal events, JSON).
 * https://developer.exotel.com/docs/voice-v1/api-reference/connect-two-numbers
 */
export class ExotelProvider implements TelephonyProvider {
  readonly name = "exotel" as const;
  readonly isSimulation = false;

  private env() {
    const e = process.env;
    return {
      sid: e.EXOTEL_ACCOUNT_SID?.trim(), key: e.EXOTEL_API_KEY?.trim(), token: e.EXOTEL_API_TOKEN?.trim(),
      // api.exotel.com (Singapore) or api.in.exotel.com (Mumbai); a full https URL is tolerated
      host: e.EXOTEL_SUBDOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
      callerId: e.EXOTEL_OPERATIONS_NUMBER?.trim(),
    };
  }

  isConfigured() {
    const c = this.env();
    return Boolean(c.sid && c.key && c.token && c.host && c.callerId);
  }

  /** Inbound: the Connect applet asks /api/exotel/flow/connect for the number, so nothing is sent here. */
  async dialAgent(): Promise<{ providerRef: string | null }> {
    return { providerRef: null };
  }

  /**
   * No transfer API on the PSTN plan: the agent transfers on the handset and records the
   * outcome in TeleCRM (/api/call/transfer with `result`), which is what seeds the sticky agent.
   */
  async transfer(): Promise<{ providerRef: string | null }> {
    return { providerRef: null };
  }

  async placeOutbound({ callId, agent, to }: OutboundRequest): Promise<{ providerCallId: string | null }> {
    const c = this.env();
    if (!this.isConfigured()) throw new ProviderNotConfiguredError("Exotel");
    if (!agent.phone) throw new AppError(400, "agent_phone_missing", `${agent.full_name} has no mobile number in TeleCRM`);

    const body = new URLSearchParams({
      From: agent.phone, To: to, CallerId: c.callerId!,
      Record: "true", RecordingChannels: "dual",
      TimeOut: "30",
      CustomField: callId, // echoed back on the status callback, so we can match the call before we know its Sid
      StatusCallback: webhookUrl("/api/exotel/status"),
      "StatusCallbackEvents[0]": "terminal",
      "StatusCallbackEvents[1]": "answered",
      StatusCallbackContentType: "application/json",
    });
    let res: Response;
    try {
      res = await fetch(`https://${c.host}/v1/Accounts/${encodeURIComponent(c.sid!)}/Calls/connect.json`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${c.key}:${c.token}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new AppError(502, "provider_unreachable", `Exotel could not be reached: ${(e as Error).message}`);
    }
    const text = await res.text();
    const json = safeJson(text) as { Call?: { Sid?: string }; RestException?: { Message?: string } } | null;
    if (!res.ok) {
      // e.g. 403 "Your account is not yet KYC compliant" on trial accounts
      const msg = json?.RestException?.Message ?? (/<Message>([^<]+)<\/Message>/.exec(text)?.[1]) ?? `HTTP ${res.status}`;
      throw new AppError(502, "provider_rejected", `Exotel refused the call: ${msg}`);
    }
    const sid = json?.Call?.Sid ?? /<Sid>([^<]+)<\/Sid>/.exec(text)?.[1] ?? null;
    if (!sid) throw new AppError(502, "provider_bad_response", "Exotel accepted the request but returned no call id");
    return { providerCallId: sid };
  }
}

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
