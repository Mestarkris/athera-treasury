# Decisions

Ambiguities resolved conservatively. Newest last. Each entry: decision, reason, consequence.

## D1 — Settlement network: NEAR mainnet, tiny amounts (2026-11-05)

- **Finding:** NEAR Intents has no official testnet. `intents.testnet` exists but has no contract
  (code hash `111…1`), and the NEAR Intents FAQ says there is no testnet deployment and none
  is planned. They recommend testing on mainnet with separate dev accounts.
- **Decision (user):** Run the settlement loop against the production verifier `intents.near` on
  mainnet, with tiny amounts held by dedicated dev accounts.
- **Consequence:** The brief says "testnet" and we are not on testnet. The README, UI and demo
  output must say "mainnet, tiny amounts" wherever the network is named. Policy limits in
  `config.yaml` are sized so a worst-case bug can only lose a trivial amount.
- **Rejected:** Self-deploying the official `defuse.wasm` to testnet (no solvers, so no routing).
  A third-party hackathon verifier on testnet (we don't control it).

## D2 — Tooling installed user-locally (2026-11-05)

- Node v22.23.4 (SHA-256 checked against nodejs.org SHASUMS256) and pnpm 12.16.1 (via corepack)
  are in `~/.local/node`. Shell startup files were left alone, so commands put
  `~/.local/node/bin` on PATH explicitly.

## D3 — Accounts and keys provided by the user (2026-11-05)

- The user provides the NEAR account(s) and adds keys themselves. The repo never creates,
  receives or stores a full-access key. Details are pending; see D4 once settled.

## D4 — Custody model: two narrow keys, no full-access key in the runtime (2026-11-05)

- **Treasury key:** a function-call access key on `accounts.treasury`, scoped to receiver
  `intents.near`, method `execute_intents`, 0.25 NEAR gas allowance. The same public key is
  registered inside the verifier (`add_public_key`) so it can sign the treasury's intents.
  `pnpm preflight` and every run refuse a full-access or mis-scoped key (`assertScopedSubmitKey`).
- **Revenue key:** registered *only* inside `intents.near` for `accounts.revenue`. It is not an
  access key on the NEAR account. The treasury key's transaction carries its signed intents.
- **Where secrets live:** `.env` (gitignored, mode 600), written by `pnpm keygen`, which prints
  public keys only. A pre-commit hook rejects secret-like strings.
- **Accepted risk:** inside the verifier, the treasury key can sign any intent for the treasury's
  balance there. The policy engine sits in front of every signature, and the exposure is capped
  at the deposit (0.5 wNEAR, D5). OutLayer TEE custody was not used: its testnet/mainnet
  agent-custody docs were incomplete at decision time.

## D5 — Money at risk: 0.5 wNEAR (2026-11-05)

- User-chosen cap. `config.yaml`: per-tx 0.05, per-day 0.20, min reserve 0.10, fee 100 bps with
  a 0.0001 minimum. One demo run moves 0.01 + 0.0001 fee.

## D6 — Transaction and intent encoding hand-written (2026-11-05)

- NEAR transactions (Borsh), NEP-413 prehash, and VersionedNonce V1 are implemented in
  `packages/settlement` on `@noble/curves` / `@noble/hashes` instead of near-api-js, so every
  signed byte is readable in ~150 lines.
- Evidence: the unit tests verify the official near/intents NEP-413 test vector. A read-only
  mainnet probe (`scripts/demo/probe-format.ts`) gets as far as the verifier's
  "public key doesn't exist" check, so the payload, nonce and signature parse on mainnet.

## D7 — No solver routing in the demo loop (2026-11-05)

- The loop uses intents.near `transfer` intents (same asset, account to account inside the
  verifier). Settlement is final on-chain, but no solver is involved, since nothing is swapped
  or bridged. Cross-chain or swap intents (`token_diff` and solver quotes) are out of scope
  until the core loop is proven. The README must say this plainly.

## D8 — Treasury agent is rule-based; inference budget enforced but unused (2026-11-05)

- The MVP Treasury agent turns an operator instruction into a proposal and makes no LLM call,
  so it records no inference cost. The `inference_budget` rule is implemented and unit-tested.
  The UI must not imply that the agent "thinks".

## D9 — Concrete accounts and the revenue-key bootstrap (2026-11-05)

- **Accounts:** treasury `mestarkris2.near` (user's existing account; its only full-access key
  stays in the user's Meteor wallet), revenue `athera-revenue.mestarkris2.near` (new sub-account).
- **Recipients:** vendor `athera-vendor.`, split `athera-ops.` and `athera-reserve.`
  (all `.mestarkris2.near`) are balance holders inside `intents.near` only. They are not created
  on-chain. Only the owner of `mestarkris2.near` can ever create those sub-accounts and claim
  the balances, so the funds stay recoverable by the user. If the verifier rejects transfers to
  non-existent accounts, we create them.
- **Revenue-key bootstrap:** `intents.near.add_public_key` asserts exactly 1 yoctoNEAR, so a
  function-call key cannot call it. The revenue sub-account is created (from the user's wallet)
  with two full-access keys: the user's own wallet key, so the user keeps control, and a one-time
  key generated in the setup server's memory. The server uses that key for exactly two
  transactions: `add_public_key(REVENUE_PK)`, then `DeleteKey` of itself. It is never written to
  disk or printed. Both transactions are on-chain and auditable.
- **Wallet:** the user approves transactions in Meteor via NEAR Wallet Selector, on a local
  page (`pnpm setup:wallet`). The repo and this machine never see the user's key. There is no
  OS keychain on this machine, so near-cli would store keys in plaintext; it is not used.

## D10 — Revenue account is an implicit account; Meteor blocks full-access AddKey (2026-11-05)

- **Finding:** Meteor refuses any transaction that adds a full-access key ("Full access key
  request blocked … only allowed for approved account recovery services"), including one adding
  the owner's own key to a brand-new sub-account. D9's named sub-account flow is impossible from
  Meteor.
- **Decision:** the revenue account is the 64-hex implicit account of the one-time setup key.
  The owner approves only a plain 0.02 NEAR transfer to it. The setup server, signing as that
  account with the setup key (memory only), then sends two transactions:
  (A) `intents.near`: `add_public_key(REVENUE_PK)` and `remove_public_key(setup key)`. The verifier
  registers an implicit account's own key by default; the removal is confirmed in
  `contracts/defuse/src/contract/accounts/account/mod.rs`.
  (B) on the account: `AddKey(owner's wallet key, FullAccess)` and `DeleteKey(setup key)`.
- **Result:** the account is controlled by the owner's wallet key, `REVENUE_PK` can only sign
  intents inside the verifier, and the setup key is gone from both places. All of it is
  verifiable on-chain.
- **Cost:** the revenue account has a hex ID, not `athera-revenue.mestarkris2.near`.
  `config.yaml accounts.revenue` is updated to it once setup completes (a human-reviewed policy
  change, new version).
- **Encoder evidence:** AddKey(FullAccess) and DeleteKey were added to the hand-written
  encoder and are byte-identical to near-js (`packages/settlement/test/tx-crosscheck.test.ts`).
- **RPC:** fastnear's free tier rate-limited this server (HTTP 429). `NearRpc` now rotates across
  fastnear, free.fastnear and rpc.mainnet.near.org with backoff (`test/rpc.test.ts`).

## D11 — Phase 2: reconciliation, out-of-process halt, ledger API (2026-11-05)

- **A halt cannot recall a broadcast intent.** The kill switch is checked synchronously before
  every stage, so it stops the next stage, not one already on-chain. Phase 1's halted run left a
  settled principal with no fee. `Orchestrator.reconcile()` finds such work from the ledger alone
  (`pendingAccounting`) and finishes it through the same policy checks. `fee_rule` and
  `revenue_split_rule` also refuse to charge or pay twice for the same basis. `pnpm demo` runs
  reconcile first, and reconcile refuses to act while halted.
- **Out-of-process halt:** `pnpm demo:halt` spawns `scripts/demo/halt.ts` as a separate OS
  process when the principal intent is submitted. The halt reaches the loop only through the
  shared `data/HALT` file, exactly as an operator's `pnpm halt` would. The demo waits for that
  process to exit before the next stage check so the run is deterministic, and says so in code.
- **Ledger API:** `apps/web` route handlers `GET /api/ledger` (filters: type, agent, result,
  run, limit) and `GET /api/ledger/:id` (entry, upstream, downstream, same-run entries, and a
  copy-paste RPC command with what to expect). The file is read on every request; no cache.
- **Blocks are verifiable too:** `pnpm verify` recomputes every recorded policy check (pass and
  block) from the ledger prefix, the recorded balance snapshot and config.yaml, and requires
  identical results per rule. Checks made under an older policy hash are skipped (reported)
  until config history is available from git.
- **Open: where the public ledger is hosted.** The ledger is a file on the VPS. Making it
  public means serving `apps/web` from the VPS (or syncing the file somewhere). This is decided
  with the user before Phase 4 deployment; until then the README must not call it public.

## D12 — Phase 4: web console architecture (2026-11-05)

- **The web server never holds signing keys.** "Run demo loop" and "Trigger invalid action" POST
  to `/api/runs`, which spawns `scripts/demo/run.ts --mode=… --run-id=…` as a separate process.
  That process reads `.env` itself. The UI follows the run only through `/api/stream` (SSE
  tailing the ledger file), so the screen can only show what the ledger records.
- **Single ledger writer:** `data/RUN.lock` (pid-checked, stale locks taken over). `FileLedger`
  holds the chain head in memory, so concurrent writers would fork the hash chain. The CLI demo,
  phase1 and UI-started runs all take the lock; a second run is refused.
- **Operator token:** mutations (start a run, engage the kill switch) need
  `ATHERA_OPERATOR_TOKEN` (apps/web/.env.local, mode 600, gitignored), sent as an
  `x-athera-operator` header, never a cookie. With no token set, the deployment is read-only.
  The token is kept in sessionStorage for the tab only.
- **Halt is one-way from the web.** The UI can engage the kill switch; release only happens on
  the server (`pnpm halt --release`), so a browser tab can't undo a halt.
- **No unconfirmed success:** the UI shows "Halting…" the instant the hold completes and
  "Halted" only once the server has written the flag. Every page shows the halt at once through
  one SSE stream per tab and a `data-halted` attribute on `<html>`.
- **The Sheet is non-modal** so the kill switch stays operable while it is open.
- **Ledger rows are immutable, so the display resolves them:** intent rows show "Settled" when the
  ledger records their settlement (`lib/display.ts`).
- **JS budget finding:** `/ledger` modern first-load JS is 140 KB gz against a brief target of
  < 120 KB. The Next.js 16 + React 19 framework alone is about 125 KB gz (react-dom 70, router 44+8+3);
  app code is about 12 KB. The 38 KB `noModule` polyfill chunk is skipped by modern browsers. This
  is escalated to the user rather than hidden: the target is not reachable on this stack without
  removing hydration from the page.

## D13 — JS budget revised to 140 KB gz for /ledger (2026-11-05, user decision)

- **Revised target:** the brief's < 120 KB first-load JS for `/ledger` is not reachable on Next.js 16 + React 19, whose
  framework alone is about 125 KB gz. The user chose to revise the budget to ≤ 140 KB gz (modern browsers; the
  `noModule` polyfill chunk excluded) and keep one rendering model, instead of a no-hydration
  special case for `/ledger`.
- **Holding the line:** app code on top of the framework stays under ~15 KB gz. Phase 6 re-measures.

## D14 — Phase 5: motion and mobile finishing (2026-11-05)

- **View transitions:**
  - Ledger row event → entry heading is a shared element (`entry-<id>`, class `entry-morph`, 240ms ease-in-out).
  - List → detail slides 24px forward (`nav-forward`); the breadcrumb slides back (`nav-back`).
  - Nav links and browser Back are untyped, so they do not slide; the morph still plays.
  - Policy versions cross-fade (lateral, no slide).
  - The status strip is pinned (`view-transition-name: status-strip`, no animation).
  - Reduced motion zeroes every view-transition animation.
- **Known limitation (Next.js 16.4.2):** in headless tests, about 1 in 3 link navigations lost their
  `nav-forward` type. Then only the 24px slide is skipped; the shared morph still plays.
  Nothing misleading is shown, so this is not worked around.
- **Animate only real events:** timelines animate only for a live run (`live` prop). Historical runs
  (the "last run" on /demo, the /design specimens) render still.
- **400ms ceiling kept:** the new-row highlight holds (no motion) ~900ms, then fades over 400ms. The
  only animation over 400ms is the timeline connector fill (600ms), as the brief allows.
- **Phone sheet:** on narrow screens a ledger row opens a bottom sheet (fetches `/api/ledger/:id`)
  with drag-to-dismiss. It sits above the kill-switch bar, which stays on top and reachable.
  Sheet and bar share the 1000px breakpoint.
- **Mobile baseline:**
  - tap highlight off on `html`;
  - `touch-action: manipulation`, with no long-press select or callout on controls;
  - 16px minimum input font;
  - `interactive-widget=resizes-content`;
  - safe-area insets on the strip, bar and sheet.
  - Document overscroll is left as is (a scrolling ledger).
- **Needs a real phone; not verifiable here:**
  - sticky hover and tap delay;
  - drag-to-dismiss feel and velocity;
  - safe areas under a notch;
  - the keyboard with the token field;
  - hold-to-halt under a thumb.

## D15 — Phase 6: review outcomes (2026-11-05)

- The Web Interface Guidelines review, AI-look checklist and axe scan are in `docs/review-phase6.md`.
- **Deliberate deviations from the guidelines:** sentence case (brief voice), ISO UTC timestamps
  and exact decimal amounts instead of `Intl` (both verifiability).
- **Real-money button:** "Run demo loop" moves real funds, so it now needs two clicks within 6s, and the
  second click states the exact amount. The amount is computed on the server from config.yaml.
- **Ledger paging:** 50 rows per page, with `?before=<seq>` in the URL (no virtualization needed).
- **JS budget:** /ledger is 133 B and /demo 1.3 KB over the 140 KB target after Phase 5 features;
  escalated to the user.
