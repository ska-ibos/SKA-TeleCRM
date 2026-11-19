"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { apiFetch, useApi } from "@/hooks/useApi";
import { Button, useToast } from "../common/ui";
import { Select, type Option } from "../common/form";
import { useUser } from "../layout/UserContext";
import { formatPhone } from "@/lib/utils/phone";
import type { ClientRow } from "../clients/ClientTable";

/** Unknown caller: pick the client this number belongs to (pins caller ID from now on). */
export function LinkClient({ callId, phone, onLinked }: { callId: string; phone: string; onLinked: () => void }) {
  const { user } = useUser();
  const toast = useToast();
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState("");
  const [clientId, setClientId] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const clients = useApi<ClientRow[]>(debounced.length >= 2 ? `/api/clients?q=${encodeURIComponent(debounced)}` : null);
  const options: Option[] = [{ value: "", label: "— choose the client —" },
    ...(clients.data ?? []).slice(0, 30).map((c) => ({ value: c.id, label: c.name, hint: c.company ?? c.phones[0]?.phone ?? "" }))];

  async function link() {
    if (!clientId) return toast.error("Choose the client first");
    setBusy(true);
    try {
      await apiFetch("/api/calls/link", { body: { call_id: callId, client_id: clientId } });
      toast.success(`${formatPhone(phone)} is now linked to this client`);
      onLinked();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="mb-2 text-sm font-semibold text-amber-900">Unknown caller {formatPhone(phone)} — whose number is this?</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className="input" placeholder="Search client name, company, PAN…" value={q} maxLength={100} onChange={(e) => { setQ(e.target.value); setClientId(""); }} aria-label="Search clients" />
        <Select value={clientId} onChange={setClientId} options={options} aria-label="Client" placeholder={debounced.length >= 2 ? "— choose the client —" : "Type 2+ letters first"} disabled={debounced.length < 2} />
        <Button loading={busy} onClick={link}><Link2 className="h-4 w-4" />Link</Button>
      </div>
      {!user.clientsManagedExternally && (
        <p className="mt-2 text-xs text-slate-600">New client? <Link className="link" href={`/clients/new?phone=${encodeURIComponent(phone)}`}>Create one with this number</Link>.</p>
      )}
      {user.clientsManagedExternally && <p className="mt-2 text-xs text-slate-600">New client? Add them in SKA OS first, then link the number here.</p>}
    </div>
  );
}
