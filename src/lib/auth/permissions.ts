import { PERMISSIONS, type Permission } from "../constants";
import type { AppRole } from "@/types";

export const can = (role: AppRole | null | undefined, p: Permission) =>
  Boolean(role && (PERMISSIONS[p] as readonly string[]).includes(role));
