"use client";
import { useRouter } from "next/navigation";
import { PhoneCall, Star, UserSearch } from "lucide-react";
import { Card, ErrorBox, PageHeader, useToast } from "@/components/common/ui";
import { ClientForm } from "@/components/clients/ClientForm";
import { useUser } from "@/components/layout/UserContext";

const WHY = [
  { icon: UserSearch, title: "Caller identification", text: "When this number calls, the team sees the client record instead of an unknown caller." },
  { icon: Star, title: "Primary number", text: "The first number you add becomes the primary number for this client." },
  { icon: PhoneCall, title: "Smarter routing", text: "Sticky agents and missed-call callbacks follow the client across all their numbers." },
];

export default function NewClientPage() {
  const router = useRouter();
  const toast = useToast();
  const { can, user } = useUser();
  if (!can("clients:write")) return <ErrorBox message="You do not have permission to create clients." />;
  if (user.clientsManagedExternally) return <ErrorBox message="Clients are managed in SKA OS. Create the client there - TeleCRM picks it up automatically, including its mobile number and contacts for caller identification." />;
  return (
    <>
      <PageHeader title="New client" subtitle="Add a client and their phone numbers for caller identification" />
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <ClientForm onCancel={() => router.back()} onSaved={(c) => { toast.success(`Client "${c.name}" created`); router.push(`/clients/${c.id}`); }} />
        </Card>
        <Card title="Why phone numbers matter">
          <ul className="stagger space-y-4">
            {WHY.map((w) => (
              <li key={w.title} className="flex gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><w.icon className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-semibold">{w.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{w.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
