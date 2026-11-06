"use client";

import { useEffect, useRef, useState } from "react";
import { useStatus } from "../shell/StatusProvider";
import styles from "./hero.module.css";

const N = 20;
const lines = (dir: "left" | "right" | "top", count = N) =>
  Array.from({ length: count }, (_, i) => (
    <span
      key={i}
      // Innermost three (closest to the content) flash on a policy block.
      className={`${styles.line} ${i >= count - 3 ? styles.inner : ""}`}
      style={{ [dir === "top" ? "height" : "width"]: `${(dir === "top" ? 40 : 60) + i * (dir === "top" ? 8 : 10)}px`, animationDelay: `${i * 0.25}s` }}
    />
  ));

/**
 * The policy boundary (design system §4.3): 20 + 20 pulsing arcs the agents work inside. A policy
 * block arriving on the live ledger flashes the innermost lines once; a halt locks them all.
 * Off-screen, the animation pauses.
 */
export function BoundaryLines() {
  const { live, onEntry } = useStatus();
  const halted = live.killSwitch.engaged || live.killSwitch.configFlag;
  const [flash, setFlash] = useState(false);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onEntry((e) => {
        if (e.type === "policy_check" && e.result === "block") {
          setFlash(true);
          setTimeout(() => setFlash(false), 650);
        }
      }),
    [onEntry],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([en]) => setPaused(!en?.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={styles.lines} aria-hidden="true" data-halted={halted} data-flash={flash} data-paused={paused}>
      <div className={`${styles.side} ${styles.left}`}>{lines("left")}</div>
      <div className={`${styles.side} ${styles.right}`}>{lines("right")}</div>
      <div className={styles.top}>{lines("top", 12)}</div>
    </div>
  );
}
