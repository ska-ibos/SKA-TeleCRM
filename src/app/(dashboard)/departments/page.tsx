import { PageHeader } from "@/components/common/ui";
import { DepartmentManager } from "@/components/departments/DepartmentManager";

export const metadata = { title: "Departments" };

export default function DepartmentsPage() {
  return (
    <>
      <PageHeader title="Departments & IVR keys" subtitle="Operations IVR mapping. Sticky routing is per client and department." />
      <DepartmentManager />
    </>
  );
}
