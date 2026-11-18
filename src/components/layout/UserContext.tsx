"use client";
import { createContext, useContext } from "react";
import type { SessionUser } from "@/types";
import { can } from "@/lib/auth/permissions";
import type { Permission } from "@/lib/constants";

const Ctx = createContext<SessionUser | null>(null);
export const UserProvider = Ctx.Provider;
export function useUser() {
  const u = useContext(Ctx);
  if (!u) throw new Error("useUser outside provider");
  return { user: u, can: (p: Permission) => can(u.role, p) };
}
