import { api, ok } from "@/lib/utils/response";
import { requireUser } from "@/lib/auth/session";

export const GET = api(async () => ok(await requireUser()));
