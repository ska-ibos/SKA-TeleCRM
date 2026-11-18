"use client";
import { use } from "react";
import { useApi } from "@/hooks/useApi";
import { Avatar, BackLink, ErrorBox, Loading, PageHeader } from "@/components/common/ui";
import { ClientDetails } from "@/components/clients/ClientDetails";
import type { getClientDetail } from "@/lib/services/client.service";

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useApi<Awaited<ReturnType<typeof getClientDetail>>>(`/api/clients?id=${id}`);
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading rows={6} />;
  return (
    <>
      <BackLink href="/clients">Clients</BackLink>
      <PageHeader title={q.data.client.name} subtitle={q.data.client.company ?? undefined} leading={<Avatar name={q.data.client.name} size="lg" />} />
      <ClientDetails d={q.data} reload={q.reload} />
    </>
  );
}
