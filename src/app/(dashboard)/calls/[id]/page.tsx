"use client";
import { use } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { BackLink, ErrorBox, Loading, PageHeader } from "@/components/common/ui";
import { CallDetails } from "@/components/calls/CallDetails";
import type { getCallDetail } from "@/lib/services/call.service";

export default function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useApi<Awaited<ReturnType<typeof getCallDetail>>>(`/api/calls?id=${id}`, 5000);
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading rows={6} />;
  const inbound = q.data.call.direction === "inbound";
  return (
    <>
      <BackLink href="/calls">Call history</BackLink>
      <PageHeader title={`${inbound ? "Inbound" : "Outbound"} call`} subtitle={q.data.call.client_name ?? "Unknown caller"}
        leading={<span className={`grid h-14 w-14 place-items-center rounded-full ${inbound ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"}`}>{inbound ? <ArrowDownLeft className="h-6 w-6" /> : <ArrowUpRight className="h-6 w-6" />}</span>} />
      <CallDetails d={q.data} reload={q.reload} />
    </>
  );
}
