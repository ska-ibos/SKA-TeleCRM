import { PageHeader } from "@/components/common/ui";
import { TeamManager } from "@/components/team/TeamManager";

export const metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <>
      <PageHeader title="Team" subtitle="Operations staff, roles and availability" />
      <TeamManager />
    </>
  );
}
