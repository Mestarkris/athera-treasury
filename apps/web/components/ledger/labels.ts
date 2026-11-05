import type { LedgerEntry } from "@athera/ledger";

export const eventLabel = (t: LedgerEntry["type"]) => t.replace("_", " ");
