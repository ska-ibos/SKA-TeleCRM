import { api, ok } from "@/lib/utils/response";
import { authMode } from "@/lib/data/store";

/** Which sign-in the login page should show. Never returns secret values, only missing variable names. */
export const GET = api(async () => ok(authMode()));
