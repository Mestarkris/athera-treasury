import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { StatusProvider } from "../components/shell/StatusProvider";
import { StatusStrip } from "../components/shell/StatusStrip";
import { killSwitchState, readRunLock } from "../lib/status";
import { currentPolicy } from "../lib/ledger";
import { operatorEnabled } from "../lib/operator";
import "../styles/base.css";
import styles from "../components/shell/shell.module.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

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
    { media: "(prefers-color-scheme: light)", color: "#f1f0ec" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1c1f" },
  ],
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const policy = currentPolicy();
  const ks = killSwitchState();
  const halted = ks.engaged || ks.configFlag;
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`} data-halted={halted ? "true" : "false"}>
      <body>
        <a href="#main" className={styles.skip}>
          Skip to content
        </a>
        <StatusProvider initial={{ killSwitch: ks, run: readRunLock() }} operatorEnabled={operatorEnabled()}>
          <StatusStrip network={policy.network} verifier={policy.verifier} policyVersion={policy.version} policyHash={policy.hash} />
          <main id="main" className={styles.main}>
            {children}
          </main>
        </StatusProvider>
      </body>
    </html>
  );
}
