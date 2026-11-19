import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getProvider } from "@/lib/telephony/provider.factory";
import { whatsappEnabled } from "@/lib/notify/whatsapp";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const { user, signedIn, reason } = await getSessionState();
  // signed in but no TeleCRM access: tell the login page why instead of a silent bounce
  if (!user) redirect(signedIn && reason ? `/login?reason=${reason}` : "/login");
  return <DashboardLayout user={{ ...user, liveTelephony: !getProvider().isSimulation, whatsapp: whatsappEnabled() }}>{children}</DashboardLayout>;
}
