# Phase 2 report: fee, revenue split, demo, ledger API (2026-11-05)

Network: **NEAR mainnet**, tiny amounts (D1, D5). Policy v2 · `3678ff…`.
Runs: `pnpm demo` → `pnpm demo:halt` → `pnpm halt --release && pnpm demo`.
Re-verified with `pnpm verify` (public RPC + ledger file only).

## Results

| Item | Evidence | Status |
|---|---|---|
| Fee intent per policy | 5 fee settlements of 0.0001 wNEAR (100 bps of 0.01, minimum applied), e.g. `ef00c07841322aca` | proven |
| Revenue-split intent | 5 split settlements of 70/30 (0.00007 / 0.00003), each with two dip4 `transfer` events, e.g. `7d2dfa75888f3273` | proven |
| `pnpm demo` under 2 min | Ledger timestamps per run: reconcile + block + full loop in about 20 s (17:13:10 → 17:13:30; 17:14:01 → 17:14:20) | proven |
| Kill switch from a separate process | `4363e28a5ad49edf` "Halted before fee proposal: operator halt from separate process (pid 11694 demo)" | proven |
| Halted work finished exactly once | Reconcile charged the fee for principal `7b3577e468772250` (Phase 1 halt) and `f88178c96b528d67` (demo:halt). `pendingAccounting` is now empty. | proven |
| Ledger JSON endpoint | `GET /api/ledger`, `GET /api/ledger/:id` (apps/web). The printed RPC `curl` was run as-is and matched the tx, intent_hash and memo. | proven (local only) |
| Every check verifiable | `pnpm verify`: hash chain over 100 entries intact; 15/15 settlements match chain; 19/19 policy checks (pass and block) recompute identically | proven |

## Balance reconciliation (wNEAR inside intents.near)

| Account | Now | Explained by |
|---|---|---|
| mestarkris2.near (treasury) | 0.4495 | 0.5 − 5 × 0.01 principal − 5 × 0.0001 fee |
| athera-vendor.mestarkris2.near | 0.05 | 5 × 0.01 |
| 21dc…fd3c (revenue) | 0 | 5 fees in, 5 splits out |
| athera-ops.mestarkris2.near | 0.00035 | 5 × 0.00007 |
| athera-reserve.mestarkris2.near | 0.00015 | 5 × 0.00003 |
| **Total** | **0.5** | conserved; ledger fees 0.0005 = ledger payouts 0.0005 |

## Still open

- **Public hosting:** the ledger and API are served only on the VPS (127.0.0.1). Public hosting is undecided (D11).
- **Git:** nothing is committed, so there is no git history yet to prove "no secrets in history".
- **Unchanged limits:** same-asset transfers, no solver routing (D7); rule-based Treasury agent (D8).
