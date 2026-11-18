"use client";
import Link from "next/link";
import { Avatar, Badge, Empty, Pagination, enter, statusTone } from "../common/ui";
import { usePagination } from "@/hooks/usePagination";
import { formatPhone } from "@/lib/utils/phone";
import type { Client, ClientPhone, Tag } from "@/types";

export type ClientRow = Client & { phones: ClientPhone[]; tags: Tag[] };

/** `resetKey`: current search/filter, so a new search starts at page 1. */
export function ClientTable({ rows, resetKey }: { rows: ClientRow[]; resetKey?: string }) {
  const pg = usePagination(rows, { resetKey });
  if (!rows.length) return <Empty title="No clients found" hint="Try a different search, or add a new client." />;
  return (
    <div className="table-bleed">
      <table className="table">
        <thead><tr><th>Client</th><th>Primary phone</th><th>Email</th><th>Tags</th><th>Status</th></tr></thead>
        <tbody key={`${pg.page}-${pg.pageSize}`}>
          {pg.rows.map((c, i) => (
            <tr key={c.id} {...enter(i)}>
              <td>
                <Link href={`/clients/${c.id}`} className="group flex items-center gap-3">
                  <Avatar name={c.name} size="sm" className="transition-transform duration-200 ease-soft group-hover:scale-110" />
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap font-semibold text-slate-900 transition-colors group-hover:text-brand-600">{c.name}</span>
                    {c.company && <span className="block whitespace-nowrap text-xs text-slate-500">{c.company}</span>}
                  </span>
                </Link>
              </td>
              <td className="whitespace-nowrap font-mono text-[13px]">{formatPhone(c.phones[0]?.phone)}{c.phones.length > 1 && <span className="ml-1 text-xs text-slate-500">+{c.phones.length - 1}</span>}</td>
              <td className="text-slate-600">{c.email ?? "—"}</td>
              <td><div className="flex flex-wrap gap-1">{c.tags.map((t) => <span key={t.id} className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: t.color }}>{t.name}</span>)}</div></td>
              <td><Badge tone={statusTone(c.status === "active" ? "answered" : c.status === "prospect" ? "pending" : "offline")}>{c.status}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination p={pg} noun="clients" />
    </div>
  );
}
