import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const body = Instrument_Sans({ subsets: ["latin"], variable: "--ff-body", display: "swap" });
const display = Fraunces({ subsets: ["latin"], variable: "--ff-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--ff-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SKA TeleCRM", template: "%s · SKA TeleCRM" },
  description: "Operations CRM & smart call routing — Single Key Advisory Pvt. Ltd.",
  icons: { icon: "/logo/logo.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
