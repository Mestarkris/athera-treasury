"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { Dot } from "../ui/badge";
import { useStatus } from "../shell/StatusProvider";
import styles from "./hero.module.css";

/** The "book" button from the reference, reused as the way into a live run (design system §4.3). */
export function RunButton({ network }: { network: string }) {
  const { live } = useStatus();
  const halted = live.killSwitch.engaged || live.killSwitch.configFlag;
  const sub = halted ? "Halted" : live.run ? `Running · ${live.run.runId}` : `${network[0]?.toUpperCase()}${network.slice(1)} · real funds`;
  return (
    <Link href="/demo" className={styles.book}>
      <span className={styles.mark} aria-hidden="true">
        <Play className="size-4 fill-current" />
      </span>
      <span className={styles.bookText}>
        <span className={styles.bookTitle}>Run Athera</span>
        <span className={styles.bookSub}>
          <Dot tone={halted ? "block" : live.run ? "pending" : "pass"} />
          {sub}
        </span>
      </span>
    </Link>
  );
}
