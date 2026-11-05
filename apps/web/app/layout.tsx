import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { StatusProvider } from "../components/shell/StatusProvider";
import { StatusStrip } from "../components/shell/StatusStrip";
import { killSwitchState, readRunLock } from "../lib/status";
import { currentPolicy } from "../lib/ledger";
import { operatorEnabled } from "../lib/operator";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Athera Treasury", template: "%s | Athera Treasury" },
  description: "Policy-bound DAO treasury agents settling through NEAR Intents, with a verifiable ledger.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const policy = currentPolicy();
  const ks = killSwitchState();
  const halted = ks.engaged || ks.configFlag;
  return (
    <html lang="en" data-halted={halted ? "true" : "false"}>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        <a
          href="#main"
          className="bg-primary text-primary-foreground absolute top-[-100px] left-2 rounded-md px-3 py-2 text-sm focus:top-2"
          style={{ zIndex: "var(--z-toast)" }}
        >
          Skip to content
        </a>
        <StatusProvider initial={{ killSwitch: ks, run: readRunLock() }} operatorEnabled={operatorEnabled()}>
          <StatusStrip network={policy.network} verifier={policy.verifier} policyVersion={policy.version} policyHash={policy.hash} />
          <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-8 pb-[calc(var(--bar-h)+4rem+env(safe-area-inset-bottom))] sm:px-6 lg:pb-16">
            {children}
          </main>
        </StatusProvider>
      </body>
    </html>
  );
}
