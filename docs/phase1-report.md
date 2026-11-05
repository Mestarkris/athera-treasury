# Phase 1 report: backend proofs (2026-11-05)

Network: **NEAR mainnet**, tiny amounts (decisions D1, D5). Policy v2 · `3678ff…`.
Run: `pnpm phase1`, 16.4 s total. Re-verified from chain alone with `pnpm verify`.

## Proofs

| # | Claim | Evidence | Status |
|---|---|---|---|
| P1 | Agent account is controlled only by scoped keys | `pnpm preflight`: the treasury runtime key is `FunctionCall → intents.near.execute_intents` (0.25 NEAR allowance); the revenue key is registered only inside `intents.near`, not on the account. Owner's full-access key stays in their wallet. | proven |
| P2 | Invalid proposal is blocked before intent creation or signing | Ledger `d5c95704aa98308c`: "Blocked: transfer 1.2 wNEAR exceeds per-tx limit (0.05 wNEAR)". Live signer call count 0, no intent entries. Unit tests assert the signer spy and the network fake are never touched (`packages/agents/test/orchestrator.test.ts`). | proven |
| P3 | Valid proposal becomes a NEAR Intent and is tracked to settlement | Principal tx `EpMiYusecyJkG5CTNcscbD6N1uHMBY2wYkAGdKzy89RN`, block 223194285, dip4 `transfer` + `intents_executed` carrying intent_hash `HSgerAikN6kBR2n9XVa3gS3MG8qLWrmyhtvNiAAZoTDN`. | proven |
| P4 | Settlement is logged and independently verifiable | 26 ledger entries, hash chain intact. For each settlement, `pnpm verify` re-reads the tx from public RPC and checks success, receiver `intents.near`, that the verifier's own events carry the ledger's intent_hash and memo, and the block height. 4/4 OK. | proven |
| P5 | Kill switch stops a running loop | Run `r261105170225qzws`: halt engaged while the principal settled; ledger `1ddec096d41dea3c` "Halted before fee proposal". No fee or split intent was created. | proven (see limits) |

Also already working (Phase 2 items): fee intent `DTj7oJ1n…` (0.0001 = 100 bps, minimum applied)
and revenue-split intent `7xMrFVgk…` (0.00007 / 0.00003, i.e. 70/30).

## Balance reconciliation (wNEAR inside intents.near, after the run)

| Account | Before | After | Change |
|---|---|---|---|
| mestarkris2.near (treasury) | 0.5 | 0.4799 | −0.01 −0.0001 −0.01 |
| athera-vendor.mestarkris2.near | 0 | 0.02 | +0.01 +0.01 |
| 21dc…fd3c (revenue) | 0 | 0 | +0.0001 −0.0001 |
| athera-ops.mestarkris2.near | 0 | 0.00007 | +0.00007 |
| athera-reserve.mestarkris2.near | 0 | 0.00003 | +0.00003 |
| **Total** | 0.5 | 0.5 | 0 |

## Limits

- **Halt is between stages:** the kill switch takes effect at the next stage boundary. It cannot recall an intent already
  broadcast. In P5 the principal had been submitted, so it settled without a fee. That settlement
  (`7b3577e468772250`) has no fee entry yet.
- **Same-process halt:** P5's halt was engaged from inside the same process (a ledger subscription). A halt from a
  separate process (`pnpm halt`, or the UI later) uses the same file flag but has not been run live.
- **No solver routing:** same-asset transfers inside the verifier (D7). Nothing cross-chain is demonstrated.
- **Ledger is local:** `data/ledger.jsonl` exists only on the VPS. "Public ledger" is not true until Phase 2 publishes it.
- **Uncreated recipients:** vendor/ops/reserve are uncreated sub-account IDs holding verifier balances (D9).
  The revenue account is an implicit hex account (D10).
- **Rule-based agent:** the Treasury agent is rule-based and spends no inference budget (D8).
