import { api, ok } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { dateRangeSchema, uuid } from "@/lib/validations";
import { getCallDetail, listCalls, liveCalls } from "@/lib/services/call.service";
import { toCsv } from "@/lib/utils/csv";

export const GET = api(async (req) => {
  const { store } = await apiCtx();
  const id = param(req, "id");
  if (id) return ok(await getCallDetail(store, uuid.parse(id)));
  if (param(req, "live")) return ok(await liveCalls(store));
  const range = dateRangeSchema.parse({ from: param(req, "from"), to: param(req, "to") });
  const rows = await listCalls(store, {
    status: param(req, "status"), direction: param(req, "direction"), agentId: param(req, "agent"),
    departmentId: param(req, "department"), ...range, q: param(req, "q")?.slice(0, 50),
    limit: Math.min(Math.max(Number(param(req, "limit")) || 500, 1), 2000),
  });
  if (param(req, "format") === "csv") {
    return new Response(toCsv(rows, ["started_at", "direction", "from_number", "to_number", "client_name", "status", "ivr_input", "department_name", "agent_name", "initiated_by_name", "route_reason", "duration_sec", "after_hours", "is_simulated"]), {
      headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=calls.csv" },
    });
  }
  return ok(rows);
});
