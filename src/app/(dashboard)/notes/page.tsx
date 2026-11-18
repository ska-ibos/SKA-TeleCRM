"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch, useApi } from "@/hooks/useApi";
import { Avatar, Card, ConfirmButton, Empty, ErrorBox, Loading, PageHeader, Pagination, SearchInput, enter, useToast } from "@/components/common/ui";
import { usePagination } from "@/hooks/usePagination";
import { useUser } from "@/components/layout/UserContext";
import { fmtDateTime } from "@/lib/utils/date";
import type { Note } from "@/types";

type Row = Note & { author_name: string; client_name: string | null };

export default function NotesPage() {
  const { user } = useUser();
  const toast = useToast();
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const notes = useApi<Row[]>(`/api/notes${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`);
  const pg = usePagination(notes.data, { resetKey: debounced, pageSize: 20 });
  return (
    <>
      <PageHeader title="Notes" subtitle="All client conversation notes. Add notes from a client or call page." />
      <Card>
        <SearchInput className="mb-5" placeholder="Search notes" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} />
        {notes.error ? <ErrorBox message={notes.error} onRetry={notes.reload} /> : notes.loading ? <Loading /> : !notes.data?.length ? <Empty title="No notes yet" /> : (
          <>
          <ul key={`${pg.page}-${pg.pageSize}`} className="grid gap-3 lg:grid-cols-2">
            {pg.rows.map((n, i) => (
              <li key={n.id} {...enter(i)} className="row-enter flex items-start gap-3 rounded-xl border border-slate-100 p-3.5 transition duration-200 hover:border-brand-200">
                <Avatar name={n.author_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500"><b className="font-semibold text-slate-800">{n.author_name}</b> on <Link className="link" href={`/clients/${n.client_id}`}>{n.client_name}</Link> · {fmtDateTime(n.created_at)}
                    {n.call_id && <> · <Link className="link" href={`/calls/${n.call_id}`}>call</Link></>}</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{n.body}</p>
                </div>
                {(user.role === "admin" || n.author_id === user.memberId) && (
                  <ConfirmButton size="sm" variant="ghost" aria-label="Delete note" message="Delete this note?" onConfirm={async () => {
                    try { await apiFetch(`/api/notes?id=${n.id}`, { method: "DELETE" }); toast.success("Note deleted"); notes.reload(); } catch (e) { toast.error((e as Error).message); }
                  }}><Trash2 className="h-3 w-3" /></ConfirmButton>
                )}
              </li>
            ))}
          </ul>
          <Pagination p={pg} noun="notes" />
          </>
        )}
      </Card>
    </>
  );
}
