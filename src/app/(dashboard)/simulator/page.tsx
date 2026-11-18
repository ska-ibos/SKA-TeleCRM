import { PageHeader } from "@/components/common/ui";
import { CallSimulator } from "@/components/simulator/CallSimulator";

export const metadata = { title: "Call Simulator" };

export default function SimulatorPage() {
  return (
    <>
      <PageHeader title="Call simulator" subtitle="Test the Operations IVR and routing engine end-to-end before Exotel is connected" />
      <CallSimulator />
    </>
  );
}
