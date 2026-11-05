"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LedgerEntry } from "@athera/ledger";

export interface LiveStatus {
  killSwitch: { engaged: boolean; reason: string | null; since: string | null; configFlag: boolean };
  run: { runId: string; since: string } | null;
}

interface Ctx {
  live: LiveStatus;
  operatorEnabled: boolean;
  token: string | null;
  setToken: (t: string | null) => void;
  /** Engage the halt. `halting` is true at once; `live` shows halted only once the server confirms. */
  engageHalt: () => Promise<string | null>;
  halting: boolean;
  /** Subscribe to ledger entries as the server tails the file. Returns unsubscribe. */
  onEntry: (fn: (e: LedgerEntry) => void) => () => void;
  operatorFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const StatusContext = createContext<Ctx | null>(null);
const TOKEN_KEY = "athera.operator";

export function useStatus(): Ctx {
  const c = useContext(StatusContext);
  if (!c) throw new Error("useStatus outside StatusProvider");
  return c;
}

export function StatusProvider({ initial, operatorEnabled, children }: { initial: LiveStatus; operatorEnabled: boolean; children: ReactNode }) {
  const [live, setLive] = useState(initial);
  const [token, setTokenState] = useState<string | null>(null);
  const [halting, setHalting] = useState(false);
  const listeners = useRef(new Set<(e: LedgerEntry) => void>());

  useEffect(() => {
    try {
      setTokenState(sessionStorage.getItem(TOKEN_KEY));
    } catch {
      // storage unavailable: token stays in memory only
    }
  }, []);

  const setToken = useCallback((t: string | null) => {
    setTokenState(t);
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  }, []);

  // One EventSource per tab: ledger entries + kill switch / run lock changes.
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("status", (ev) => setLive(JSON.parse((ev as MessageEvent<string>).data) as LiveStatus));
    es.addEventListener("entry", (ev) => {
      const e = JSON.parse((ev as MessageEvent<string>).data) as LedgerEntry;
      for (const fn of listeners.current) fn(e);
    });
    return () => es.close();
  }, []);

  // The halt shows everywhere at once: a single attribute on <html> drives every halted style.
  useEffect(() => {
    const halted = live.killSwitch.engaged || live.killSwitch.configFlag;
    document.documentElement.dataset["halted"] = halted ? "true" : "false";
  }, [live.killSwitch.engaged, live.killSwitch.configFlag]);

  const operatorFetch = useCallback(
    (path: string, init: RequestInit = {}) =>
      fetch(path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}), "x-athera-operator": token ?? "" } }),
    [token],
  );

  const engageHalt = useCallback(async () => {
    // The request goes out the instant the hold completes. The interface says "Halting…" at once
    // and "Halted" only after the server has written the flag: never an unconfirmed success.
    setHalting(true);
    try {
      const res = await operatorFetch("/api/kill-switch", { method: "POST", body: JSON.stringify({ reason: "operator halt from the web console" }) });
      const b = (await res.json().catch(() => ({}))) as { error?: string } & Partial<LiveStatus["killSwitch"]>;
      if (!res.ok) return b.error ?? `Halt failed (HTTP ${res.status})`;
      setLive((s) => ({ ...s, killSwitch: { engaged: Boolean(b.engaged), reason: b.reason ?? null, since: b.since ?? null, configFlag: Boolean(b.configFlag) } }));
      return null;
    } catch {
      return "Halt request did not reach the server. Use pnpm halt on the server.";
    } finally {
      setHalting(false);
    }
  }, [operatorFetch]);

  const onEntry = useCallback((fn: (e: LedgerEntry) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const value = useMemo(
    () => ({ live, operatorEnabled, token, setToken, engageHalt, halting, onEntry, operatorFetch }),
    [live, operatorEnabled, token, setToken, engageHalt, halting, onEntry, operatorFetch],
  );
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}
