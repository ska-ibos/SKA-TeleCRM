import { requireUser } from "../auth/session";
import { getStore } from "../data/store";
import type { Permission } from "../constants";
import type { EngineCtx } from "../routing/routing.engine";
import { getProvider } from "../telephony/provider.factory";
import { badRequest } from "../data/types";

/** Authenticated + authorised request context for API routes. */
export async function apiCtx(permission?: Permission) {
  const user = await requireUser(permission);
  return { user, store: await getStore() };
}

/** Engine context. `at` lets the simulator/tests control the clock (sticky expiry, office hours). */
export async function engineCtx(opts: { at?: string; simulation?: boolean } = {}): Promise<EngineCtx> {
  const now = opts.at ? new Date(opts.at) : new Date();
  if (Number.isNaN(now.getTime())) throw badRequest("Invalid simulated date");
  return { store: await getStore(), provider: getProvider(opts.simulation ? "simulation" : undefined), now };
}

export const param = (req: Request, key: string) => new URL(req.url).searchParams.get(key) ?? undefined;
