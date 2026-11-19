import { api, ok } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { buildReport } from "@/lib/services/report.service";
import { toCsv } from "@/lib/utils/csv";
import { dateRangeSchema } from "@/lib/validations";
import { getProvider } from "@/lib/telephony/provider.factory";
import { scopeFor } from "@/lib/services/access.service";

export const GET = api(async (req) => {
  const { store, user } = await apiCtx("reports:read");
  const r = await buildReport(store, dateRangeSchema.parse({ from: param(req, "from"), to: param(req, "to") }),
    { excludeSimulated: !getProvider().isSimulation, scope: await scopeFor(store, user) });
  const format = param(req, "format");
  if (format) {
    const key = format === "agents" ? "byAgent" : format === "departments" ? "byDepartment" : null;
    const csv = key ? toCsv(r[key]) : toCsv(r.calls, ["started_at", "direction", "from_number", "client_name", "status", "ivr_input", "department_name", "agent_name", "route_reason", "duration_sec"]);
    return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename=report-${format}.csv` } });
  }
  // buildReport reads at most 2,000 calls; tell the UI when the totals may be cut short
  const { scanned: _s, ...rest } = r;
  return ok({ ...rest, calls: r.calls.slice(0, 50), truncated: r.scanned >= 2000 });
});
