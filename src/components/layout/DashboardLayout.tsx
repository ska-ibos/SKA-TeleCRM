"use client";
import { useState, type ReactNode } from "react";
import type { SessionUser } from "@/types";
import { ToastProvider } from "../common/ui";
import { UserProvider } from "./UserContext";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { IncomingCallScreen } from "../calls/IncomingCallScreen";

export function DashboardLayout({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <UserProvider value={user}>
      <ToastProvider>
        <Sidebar open={open} onNavigate={() => setOpen(false)} />
        {open && <div className="fade-in fixed inset-0 z-30 bg-brand-950/50 backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} />}
        <div className="lg:pl-64">
          <Header onMenu={() => setOpen(true)} />
          <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
        <IncomingCallScreen />
      </ToastProvider>
    </UserProvider>
  );
}
