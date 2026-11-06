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

## D16 — Switch to a standard component look: Tailwind + shadcn/ui (2026-11-05, user decision)

- **What changed:** the user chose "standard frontend": Tailwind CSS v4 and shadcn/ui with the default
  neutral theme (light and dark, Geist fonts, cards, lucide icons). This **overrides the brief's
  "flight recorder" art direction** (paper and ink, no cards, no generic icons, custom grotesk). The
  previous design system is preserved in git history (commit 5590f8e).
- **Unchanged:** behaviour, data sources and safety: the non-modal sheet (kill switch reachable),
  hold-to-halt, live stream, the run lock, operator token, view transitions, reduced motion, the
  44px targets and the mobile kill-switch bar. Status keeps icon + word + colour, with `success` and
  `warning` added to shadcn's theme (AA checked by script).
- **Removed:** the bespoke tokens, CSS modules, StatusMark and the internal `/design` reference
  page (it documented the old system).
- **JS cost:** first-load JS rose about 13 KB (tailwind-merge, class-variance-authority, clsx, lucide
  icons). `/ledger` is 153.2 KB and `/demo` 154.6 KB, over D13's 140 KB. This was accepted as the price of the
  standard stack, which the user was told beforehand.
- **Verified after the switch:**
  - axe-core WCAG 2.2 AA: 0 violations across 8 screens × 2 themes × 2 widths. One target-size
    issue on the demo timeline was found and fixed.
  - No horizontal overflow on any screen at 1280px or 390px. Several grid and long-hash overflows were found
    and fixed (docs/design.md, "Layout rule").
  - View-transition and phone-sheet tests pass; 84 unit tests pass.

## D17: The business loop: selling AI treasury reports through 1Click (2026-11-06, user decision)

The track asks for an autonomous business that earns, spends on AI, settles through NEAR Intents and
splits revenue. The movement loop showed the controls, but nothing was sold and no model was called.
The user chose this product: **Athera sells AI-written treasury reports on NEAR accounts.** Payment
goes through 1Click, AI calls run on NEAR AI Cloud, and every step stays under the same policy engine.

- **Sale loop** (`Orchestrator.runSale`, `pnpm demo --mode=sale`, and "Sell a treasury report" on /demo).
  Each step below is written to the ledger as its own entry.
  1. **Offer.** Sales offers the report: a `sale_offer` proposal, checked by `pricing_rule` against
     `sales.min/max_price_usd`.
  2. **Quote.** 1Click quotes `EXACT_OUTPUT`: exactly the price in USDC, delivered to the revenue
     account inside the verifier (`depositType` and `recipientType` are both `INTENTS`).
  3. **Payment.** The customer pays the quote's deposit address with a `service_purchase` transfer
     intent. It passes `purchase_rule` and every movement rule (limits, reserve, drawdown):
     - the quote must pay Athera's revenue account;
     - it must settle in the configured asset;
     - it must not have expired;
     - the payment must be exactly `amountIn` of the origin asset, sent to the deposit address.
  4. **Swap.** 1Click's solvers do the swap. Athera never routes or bridges, as the blueprint
     requires. If the status ends `REFUNDED` or `FAILED`, a failed sale is logged and nothing is split.
  5. **Revenue split.** Accounting splits the USDC received (70/30). Reconcile treats a confirmed
     `sale` like a collected fee, so a halted split is finished later.
  6. **Report.** The Analyst reads the subject account from public RPC: NEAR balance, intents.near
     holdings and 1Click USD prices. It then writes the report with one metered AI call and saves it
     to `data/reports/<id>.json`, served at `/reports/<id>`.
- **Metered AI.** Every model call is first an `inference_spend` proposal. Before the call:
  - its worst case (estimated prompt tokens plus the full output budget, at the price listed in
    `/v1/models`) is checked against `inference.approved_models`, `inference.max_call_usd` and the
    daily budget;
  - after the call, the billed cost from the reported token usage is written as a `cost` entry.

  `deriveState` adds today's `cost` entries, so the budget is enforced from the ledger alone. The
  control room meter now shows real spend.
- **Who pays in the demo.** The only account Athera can sign for is the treasury, so the self-run
  demo has the treasury buy a report on itself. External customers paying from any chain need an
  order page plus a fulfilment step that watches 1Click status. That is not built (see README gaps).
- **Order of steps.** The revenue split runs before the report, because it depends only on money
  already received. If the AI call is blocked or returns unusable output, the sale and split stand.
  The run then ends `blocked` or `failed` with no report, and the call's cost is still recorded.
  There is no automatic report retry yet.
- **Config v3.** v3 adds the following:
  - USDC as an approved asset;
  - `sales` and `inference` sections;
  - `sales` and `analyst` agent roles;
  - `service_purchase` for the treasury.

  Older versions stay loadable, because `sales`, `inference` and missing agent roles are optional
  in the schema. A version without them sells nothing and approves no model.

  `pnpm verify` now loads `config.yaml` from git by the hash each check recorded, so all 21
  v2-era checks still recompute. Rules added since then must evaluate to `skip` for those
  proposals.
- **Verified so far.** These checks have passed:
  - 112 unit tests, including 6 for the sale loop against fake 1Click, NEAR AI and chain;
  - typecheck and the production build;
  - a mainnet dry check: a real 1Click quote passed `pricing_rule`, `purchase_rule` and all
    movement rules, with nothing signed.

- **First mainnet sale (2026-11-06, run `r261106002713ca7b`).**
  - **Money:** the payment settled, 1Click delivered 0.05 USDC to the revenue account, and the
    split paid 0.035 / 0.015.
  - **Report:** the report call on `z-ai/glm-5.3-flash` used all 1,200 output tokens on hidden
    reasoning and returned no JSON. Its $0.000622 cost is in the ledger.
  - **Fix:** reports now default to `anthropic/claude-haiku-5-5` (already approved, so the policy
    did not change), with a 2,500-token budget. `Orchestrator.retryReport` and
    `pnpm demo --mode=report --sale=<id>` write a missing report from the ledger alone, with no
    second payment, and refuse a sale that already has a report.
  - **Result:** the retry wrote report `r261106003131c6rf-report` for $0.000539.
  - **Guard:** a sale now makes one metered AI check before any money moves, so an AI account
    without credits (HTTP 402, seen during setup) stops the sale before payment.

## D18: Customers paying from any chain, and reports that retry themselves (2026-11-06)

- **Orders** (`/buy`, `/orders/<id>`, `createOrder`, `Orchestrator.fulfilOrder`, `pnpm demo --mode=fulfil`).
  - **Creating an order (web server, no keys):**
    1. The server checks that the subject account exists on mainnet.
    2. `pricing_rule` checks the offer.
    3. 1Click returns an `ORIGIN_CHAIN` quote, so the customer pays from their own chain. The
       quote is `EXACT_OUTPUT`: the price in USDC to the revenue account inside intents.near,
       with refunds going to the customer's address on the paying chain.
  - **Fulfilling it (run process):** this starts only when 1Click reports `SUCCESS` for the
    deposit address. It records the offer, its check, the quote and the sale, then pays the
    split and writes the report. Athera signs nothing for the customer; the only signature is
    the revenue account's split.
  - **No double recording:** an order whose deposit address already has a sale is never
    recorded twice.
- **Bridge minimums:** 1Click refuses tiny bridged amounts. For example, USDC from Base needed
  about $0.15. When 1Click names a minimum, the order is re-quoted at that minimum plus 5%,
  rounded up to the cent, and only if that stays within `sales.max_price_usd`. That price passes
  `pricing_rule` again. Otherwise the customer is told to pay with a NEAR token. Checked live: a
  Base USDC order was quoted at $0.16, with a Base deposit address.
- **Who starts fulfilment:** the order page polls status and asks the server to fulfil once paid.
  The server only spawns the run when all of these hold:
  - 1Click itself says `SUCCESS`;
  - the kill switch is off;
  - no run holds the ledger;
  - the order has not been started in the last 20 seconds.

  For anything a closed browser missed, `pnpm demo --mode=fulfil` (all open orders) is safe to
  run from cron.
- **Privacy:** orders hold the customer's refund address, so `data/orders/` is gitignored. Pages
  and APIs show that address only shortened. Reports use public chain data only and are public
  by id.
- **Reports retry automatically:** reconcile, which runs at the start of every run, writes
  reports still owed for paid sales. Each sale gets at most 3 costed AI attempts
  (`MAX_REPORT_ATTEMPTS`, counted from the ledger); after that an operator uses
  `--mode=report`. A failed attempt is logged and does not stop the run.
- **Limits:** order creation is rate-limited in memory (10 per hour per client IP), which is
  enough for a single server. Unauthenticated 1Click quotes carry a 0.25% fee: a $0.05 order on
  NEAR asks 0.050506 USDC.

## D19: Restyle to the Athera design system (2026-11-06, user decision)

The user supplied `docs/ATHERA_DESIGN_SYSTEM.md` and `docs/ATHERA_BUILD_PROMPT.md` and chose two
things:
- **Restyle, keeping Tailwind:** the doc's tokens are mapped onto the shadcn variables, and
  Tailwind's default palette, radius scale and shadows are switched off. The alternative was a
  full rewrite in CSS Modules.
- **Match reality where the doc predates the build:** the badge says mainnet; "Built on" lists
  1Click and NEAR AI Cloud instead of OutLayer and testnet; the menu includes Buy and Reports;
  the ticker values come from the live `config.yaml`.

What was added:
- the hero, with policy-boundary lines that flash on a live block and lock on a halt, the rule
  ticker, and a fade into the latest 5 ledger rows;
- the serif wordmark navbar, with a network pill, a pill kill switch and a full-screen menu
  drawer;
- the pinned bottom-right kill switch on phones;
- dot status pills, hairline sections instead of cards, and 52px table rows;
- 24px timeline nodes.

One fix along the way: the Run page now shows a sale run together with a report written later
by a retry. Every departure from the doc is listed in docs/design.md.

Checked: axe-core reports 0 violations across 11 screens × 2 themes × 2 widths, with no overflow.
All 118 tests pass.
