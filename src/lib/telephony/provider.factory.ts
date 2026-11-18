import type { TelephonyProvider } from "./provider.interface";
import { SimulationProvider } from "./simulation.provider";
import { ExotelProvider } from "./exotel.provider";

const g = globalThis as unknown as { __skaProviders?: Record<string, TelephonyProvider> };

export function getProvider(kind = process.env.TELEPHONY_PROVIDER ?? "simulation"): TelephonyProvider {
  g.__skaProviders ??= {};
  const key = kind === "exotel" ? "exotel" : "simulation";
  return (g.__skaProviders[key] ??= key === "exotel" ? new ExotelProvider() : new SimulationProvider());
}

export const getSimulationProvider = () => getProvider("simulation");
