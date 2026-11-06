import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { StatusProvider } from "../components/shell/StatusProvider";
import { StatusStrip } from "../components/shell/StatusStrip";
import { killSwitchState, readRunLock } from "../lib/status";
import { currentPolicy } from "../lib/ledger";
import { operatorEnabled } from "../lib/operator";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const serif = Source_Serif_4({ variable: "--font-serif4", subsets: ["latin"], weight: ["400", "600"], style: ["normal", "italic"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400"] });

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

export default async function RootLayout({ children }: { children: ReactNode }) {
  const policy = await currentPolicy();
  const ks = await killSwitchState();
  const halted = ks.engaged || ks.configFlag;
  return (
    <html lang="en" data-halted={halted ? "true" : "false"}>
      <body className={`${inter.variable} ${serif.variable} ${mono.variable} font-sans`}>
        <a
          href="#main"
          className="bg-primary text-primary-foreground absolute top-[-100px] left-2 rounded-md px-3 py-2 text-sm focus:top-2"
          style={{ zIndex: "var(--z-toast)" }}
        >
          Skip to content
        </a>
        <StatusProvider initial={{ killSwitch: ks, run: (await readRunLock()) }} operatorEnabled={operatorEnabled()}>
          <StatusStrip network={policy.network} verifier={policy.verifier} policyVersion={policy.version} policyHash={policy.hash} />
          <main id="main" className="shell pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pt-10 sm:pb-20">
            {children}
          </main>
        </StatusProvider>
      </body>
    </html>
  );
}
