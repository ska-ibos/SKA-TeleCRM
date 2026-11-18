"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, Plus } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Button, Card, ErrorBox, Loading, PageHeader, SearchInput } from "@/components/common/ui";
import { ClientTable, type ClientRow } from "@/components/clients/ClientTable";
import { Select } from "@/components/common/form";
import { useUser } from "@/components/layout/UserContext";
import type { Tag } from "@/types";

export default function ClientsPage() {
  const { can, user } = useUser();
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState(""), [tag, setTag] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ ...(debounced && { q: debounced }), ...(status && { status }), ...(tag && { tag }) }).toString();
  const clients = useApi<ClientRow[]>(`/api/clients?${qs}`);
  const tags = useApi<Tag[]>("/api/tags");

  return (
    <>
      <PageHeader title="Clients" subtitle={`${clients.data?.length ?? 0} clients`} actions={<>
        <a href={`/api/clients?${qs}&format=csv`}><Button variant="secondary"><Download className="h-4 w-4" />Export CSV</Button></a>
        {can("clients:write") && !user.clientsManagedExternally && <Link href="/clients/new"><Button><Plus className="h-4 w-4" />New client</Button></Link>}
      </>} />
      <Card>
        <div className="mb-5 flex flex-wrap gap-3">
          <SearchInput className="min-w-60 flex-1" placeholder="Search name, company, phone, PAN, GSTIN…" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-full sm:w-44" value={status} onChange={setStatus} aria-label="Status filter"
            options={[{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "prospect", label: "Prospect" }, { value: "inactive", label: "Inactive" }]} />
          <Select className="w-full sm:w-44" value={tag} onChange={setTag} aria-label="Tag filter" searchPlaceholder="Search tags…"
            options={[{ value: "", label: "All tags" }, ...(tags.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
        </div>
        {clients.error ? <ErrorBox message={clients.error} onRetry={clients.reload} /> : clients.loading ? <Loading rows={6} /> : <ClientTable rows={clients.data ?? []} resetKey={qs} />}
      </Card>
    </>
  );
}
