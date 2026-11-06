# Athera Treasury: Build Prompt

> Paste everything below the line into your coding agent (Claude Code or similar) at the root of an empty repo. Put the blueprint PDF **and `ATHERA_DESIGN_SYSTEM.md`** in `/docs` so the agent can refer back to them.

---

## 0. Role

You are a senior full-stack engineer and product designer pairing on a hackathon build. You know NEAR (accounts, function-call access keys, NEAR Intents, testnet), TypeScript, Next.js App Router, and interface craft at the level of Linear, Vercel and Emil Kowalski's work. You care more about an honest, verifiable result than a broad demo. If a claim can't be proven by running the repo, it doesn't go in the README or the UI.

## 1. What we're building

**Athera Treasury** is a constrained, AI-native, cross-chain treasury service for DAOs, built for the **NEAR Hackathon Autonomous Business Track**.

**Core idea:** Humans set policy once. Agents execute inside that policy. All value movement goes through NEAR Intents.

**Success criterion (the only one that matters):** One real, independently verifiable loop. It respects human-defined constraints, settles via NEAR Intents, logs every material step to a public ledger, and can be halted by a kill switch. A reviewer can reproduce it from the repo, and every claim in the README and demo matches what actually runs.

The loop:

```
policy validation → treasury action proposed → NEAR Intent created + submitted
→ settlement confirmed → fee collected → revenue-split intent → ledger entry
```

Demo mode runs that whole loop on **testnet in under two minutes**, and you can run it again and get the same result.

## 2. Non-negotiables (from the architecture blueprint)

Treat these as invariants. Encode them in code and tests, not only in comments.

1. **Policy runs before every material action.** No agent can move value or spend money without a successful policy check, and that check happens **before any signing or intent submission**. An invalid proposal never reaches a key.
2. **Policy lives in a versioned `config.yaml`** with at least these hard rules:
   - max inference spend per day
   - max capital movement per transaction **and** per day
   - approved chains, assets, protocols
   - max drawdown / simple risk parameters
   - minimum fee and pricing rules
   - revenue-split percentages
   - approved counterparties and vendors
   - kill-switch flag
3. **Agent boundaries are strict:**

   | Agent | Allowed | Forbidden |
   |---|---|---|
   | Treasury | Propose rebalance/movement within current policy | Sign, submit intents, modify policy |
   | Settlement | Create + submit NEAR Intents after a passed policy check | Decide strategy, alter limits |
   | Accounting | Record events, trigger revenue-split intents per policy | Move client capital outside fee rules |

   Sales and Procurement can be **sequential stubs** that still go through the same policy engine.
4. **Custody:** no full-access keys in plaintext, ever. Use OutLayer agent custody or scoped function-call access keys.
5. **Agents never handle bridges or routing.** They declare outcomes as NEAR Intents, and solvers do the routing.
6. **Public ledger:** every policy check (pass *and* block), proposal, intent, settlement result, cost, fee and payout gets appended. A reviewer must be able to match each entry to an on-chain or Intent settlement without private logs.
7. **The kill switch is a first-class control.** It stops all further agent activity immediately, at any stage.
8. **Swarm-for-Hire (stretch only):** external agents send proposals that are treated as untrusted input. They never get signing authority. Paying them is itself a NEAR Intent, bound by the daily spend and approved-counterparty rules.
9. **If a critical proof can't be shown cleanly, cut scope.** Don't hide a gap behind mocked UI.

### Explicitly out of scope for the MVP
A concurrent multi-agent swarm, multi-protocol yield optimisation, advanced risk models, a production onboarding flow, and dashboards beyond the ledger. The frontend described below is a **ledger plus a control surface**. It is not an analytics product.

## 3. Architecture and stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces: `packages/policy`, `packages/agents`, `packages/settlement`, `packages/ledger`, `apps/web`, `scripts/demo` |
| Agent runtime | TypeScript, NEAR agent patterns |
| Policy | `config.yaml` + schema validation (Zod), with a version hash attached to every check |
| Custody | OutLayer agent custody **or** scoped function-call keys |
| Settlement | NEAR Intents (create → submit → track → confirm) |
| Ledger | Append-only events, exposed through an indexed public page plus a JSON endpoint |
| Frontend | Next.js (App Router, RSC), TypeScript strict, CSS variables + CSS Modules or Tailwind with custom tokens (no default palette) |
| Demo | `pnpm demo`: a testnet script that runs the full loop and prints ledger links |

Data flow: `Policy Engine.load()` → `TreasuryAgent.propose()` → `PolicyEngine.validate(proposal)` → (pass) `Settlement.submitIntent()` → `Settlement.track()` → `Accounting.recordFee()` → `Settlement.submitIntent(split)` → `Ledger.append()` at **every** step. The kill switch is checked before each step.

## 4. Skills: load them and use them on purpose

Load each skill below when you get to the phase where it applies (section 8). Before writing code in that phase, read the skill's instructions. If a skill isn't installed, install it from its published source (Vercel: `vercel-labs/agent-skills`; Emil Kowalski's design skills; Anthropic's `frontend-design`) and tell me what you installed. When a skill conflicts with a non-negotiable from section 2, the non-negotiable wins.

| Skill | Source | Use it for |
|---|---|---|
| `frontend-design` | Anthropic | Setting the art direction before any UI code: type, colour, layout, voice. Its job is to make sure the result **doesn't look like a site made by an AI**. |
| `react-best-practices` | Vercel | All of `apps/web`: RSC/client boundaries, no request waterfalls, Suspense, bundle size, rendering perf. |
| `react-view-transitions` | Vercel | Moving between pages and states: ledger list ↔ entry detail, the demo-loop stages, policy versions. |
| `web-design-guidelines` | Vercel | A UX/a11y review pass on every screen before you call it done. |
| `animate` | Emil Kowalski | Every micro-interaction: easing, duration, which properties animate. |
| `choreograph` | Emil Kowalski | Sequencing the demo loop as a staged reveal, staggering ledger rows, ordering state changes. |
| `apple-design` | Emil Kowalski | Restraint, hierarchy, material and depth, and the feel of controls (especially the kill switch). |
| `mobile-native` | Emil Kowalski | Making the ledger and the kill switch feel native on a phone: touch targets, gestures, safe areas, sheets. |
| *(other Emil skills, e.g. finishing touches)* | Emil Kowalski | A final polish pass: focus rings, hover/press states, loading and empty states, number formatting. |

## 5. Art direction (DA)

**The full spec is in `docs/ATHERA_DESIGN_SYSTEM.md`. Read it before writing any UI.** It was taken from a reference hero ("Alwayzz") and adapted to Athera's honesty and safety rules. Summary:

- **Look:** pure white / near-black monochrome, one muted grey, soft `rgb(251,251,251)` surfaces, 8%-black hairlines. Pills for buttons, chips and statuses. No cards, no gradients, no glass.
- **Type:** Inter (400–700) with **tight negative tracking** (−0.07em display, −0.04em headings), plus **one Source Serif 4 *italic* accent word** per view (e.g. "moves only inside *policy*"). Monospace (JetBrains Mono) only for hashes and IDs. `tabular-nums` on every number.
- **Signature elements:** the hero's 20+20 pulsing curved lines are reused as the **policy boundary** (they flash on a block and lock on a halt). The marquee ticker shows the **real `config.yaml` rules**. A progressive blur hands the hero off to the live ledger. A full-screen fade drawer handles navigation.
- **Signals:** green `#17c964` (dots only, darker for text), plus vermilion for block/halt and amber for pending. Everything else is greyscale.
- **Departures from the reference** (all required): no borrowed images or avatars, no fake "trusted by" logos (use a "Built on" strip of infra the code really uses), no ®, the kill switch is never inside the drawer.
- **Styling:** custom CSS (CSS Modules + `tokens.css`), not Tailwind utilities.

### Signs of "made by an AI". Do none of these:
- Purple/blue gradients, mesh blobs, glassmorphism, glowing borders, neon on black
- A centred hero with a gradient word, two buttons and three feature cards (our hero is centred, but it's driven by real policy data and has no feature cards)
- Inter at default tracking, everything `rounded-2xl`, shadows on everything, cards nested in cards
- Emoji or generic icons standing in for meaning; fake metrics, decorative sparklines, "AI-powered ✨" copy, lorem ipsum
- Motion for its own sake (floating, parallax). The boundary lines are the single ambient motion, and they carry meaning.

## 6. Screens (MVP frontend)

Build only these screens. Each one maps to something in the blueprint.

1. **`/` Control room.** Opens with the hero from the design system (§4.3): title, live policy ticker, "View the ledger" + "Run the demo loop" CTAs, boundary lines, then a progressive blur into the content below. Below the hero: the current policy version, live kill-switch state, today's spend vs. limits (shown as plain numbers and thin bars, not charts), the most recent ledger entries, and a "Run demo loop" button.
2. **`/demo` Loop runner.** Runs the real testnet loop. Shows the seven stages as one vertical timeline that fills in as **real backend events** arrive (SSE or polling). Every stage shows its tx/intent ID and explorer link the moment one exists. Includes a "trigger invalid action" button that shows the policy engine blocking a proposal **before** an intent exists.
3. **`/ledger` Public ledger.** An append-only table: time, actor (agent), event type, amount/asset, policy version, result, verify link. Filter by event type and agent. Every row is reachable by URL.
4. **`/ledger/[id]` Entry detail.** The full event payload, the policy rules evaluated (with pass/fail for each rule), linked upstream and downstream events in the loop, and a step-by-step "how to verify this yourself" section.
5. **`/policy` Policy.** The current `config.yaml`, rendered read-only, plus version history with diffs. The UI does **not** edit policy, because changes go through git.
6. **`/security` Custody and assumptions.** The custody model, key handling, what's protected, what's out of scope, and known limitations. This is honest documentation, styled as a page.
7. **Kill switch (global).** Always reachable, from every screen and on mobile. It takes a deliberate gesture (press-and-hold, about 1.2s, with a progress fill; or an explicit confirm on keyboard). Once triggered, the halted state shows everywhere at once.

**Honesty rule for the UI:** every number and status comes from the backend or the chain. If something is stubbed (for example the Sales or Procurement agents), it carries a visible `STUB` label. Never animate a "success" the backend hasn't confirmed.

## 7. Motion and choreography

Follow `animate`, `choreograph` and `apple-design`. Project-specific rules:

- **Animate only `transform` and `opacity`** (and `clip-path` where it's cheap). Never animate layout properties.
- **Durations:** UI feedback 120–200ms, entering elements 200–300ms, nothing over 400ms except the demo timeline's stage fill. Use a custom ease-out (e.g. `cubic-bezier(0.22, 1, 0.36, 1)`) for entrances, ease-in-out for things that move on screen, and springs only for gesture-driven elements.
- **Safety beats delight.** The kill switch's *effect* is instant. Its confirmation feedback can animate, but a halt is never waiting on an animation. A policy **block** gets one short, firm cue (a 2px left rule plus a slight horizontal settle, under 150ms), never a shake loop.
- **Demo loop choreography:** stages come to life one after another *when their real event arrives*, not on a timer. Each stage: the pending indicator gives way to the result, the ID types in or fades in using monospace, and the connector line to the next stage draws. New ledger rows slide in from the top with a 30–40ms stagger and a brief highlight that fades to the normal background.
- **View transitions** (`react-view-transitions`): ledger row → detail page as a shared-element transition on the row/ID; policy version → version as a cross-fade of the diff. Make sure Back reverses the transition.
- **No animation on high-frequency actions:** typing, filtering and keyboard navigation in the ledger are instant.
- **`prefers-reduced-motion`:** swap movement for opacity or nothing at all. All information stays intact.
- **Mobile (`mobile-native`):** 44px minimum touch targets, the kill switch in the thumb zone, ledger detail as a bottom sheet with drag-to-dismiss, and respect for safe-area insets.

## 8. Work plan (in this order)

**Phase 1: Critical technical proof (backend only, no UI).** Prove each of these with a script or test before anything else:
1. An agent account is created and controlled through OutLayer or a scoped function-call key.
2. An invalid proposal is blocked by policy **before** an intent is created or anything is signed (test that the signing function is never called).
3. A valid proposal becomes a NEAR Intent and is tracked to settlement on testnet.
4. The settlement is logged and can be verified independently through the ledger and an explorer.
5. The kill switch stops further execution mid-loop.

**Stop and report to me** after Phase 1: what's proven, what isn't, and any scope you propose to cut.

**Phase 2: Full loop + demo script.** Fee collection, the revenue-split intent, `pnpm demo` under 2 minutes, a ledger JSON endpoint.

**Phase 3: Design system.** Load `frontend-design` and `apple-design`. Read `docs/ATHERA_DESIGN_SYSTEM.md`. Copy its `tokens.css` exactly, set up type, build base primitives (Table, Row, Badge, Button, HoldButton, Timeline, Sheet, Code/YAML view, Hash/ID with copy). Show me a single token-and-primitives page before building screens.

**Phase 4: Screens.** Load `react-best-practices` and `react-view-transitions`. Build the screens in section 6 in order, wired to real data.

**Phase 5: Motion and finishing.** Load `animate`, `choreograph`, `mobile-native` and the finishing skills. Apply section 7.

**Phase 6: Review.** Run `web-design-guidelines` over every screen and fix what it finds. Then check the "made by an AI" list in section 5 against the actual UI, one item at a time, and fix any matches.

## 9. Engineering standards

- TypeScript `strict`, no `any` in the policy, settlement or ledger packages.
- Policy engine: pure functions with unit tests for every rule, both passing and blocking cases, including per-day accumulation and the kill switch.
- Secrets only through env/custody. A `.env.example` with no values. A pre-commit check that rejects anything that looks like a private key.
- RSC by default, `"use client"` only for interactive leaves. No client-side fetch waterfalls. Stream the ledger with Suspense.
- Accessibility: semantic table markup, visible focus, a keyboard path to the kill switch, `aria-live` announcements for loop stages and halts, AA contrast in both themes.
- Performance budget: first-load JS on `/ledger` under 120 KB gzipped, with no layout shift as rows come in.

## 10. Deliverables and acceptance criteria

- [ ] `pnpm install && pnpm demo` runs the full loop on testnet in under 2 minutes and prints explorer + ledger links
- [ ] A test proves an invalid action never reaches signing
- [ ] The kill switch halts a running loop, and the halt is recorded in the ledger
- [ ] Every ledger entry is reachable by URL and can be verified without private logs
- [ ] No full-access key exists in plaintext anywhere in the repo or its history
- [ ] The UI shows only real or clearly labelled `STUB` data
- [ ] `web-design-guidelines` review passes, and the "made by an AI" checklist comes up clean
- [ ] Reduced-motion and mobile layouts checked
- [ ] README: what it does, how to run it, how to verify a settlement, custody model, security assumptions, known limitations. Every claim matches what the code does.

## 11. How to work with me

- Before each phase, give me a 5-line plan. After each phase, give me a short report: what works, what's proven, what's faked or stubbed (if anything), and the next step.
- When the blueprint is ambiguous, pick the more **conservative and verifiable** option and write down the decision in `docs/decisions.md`.
- Don't widen scope without asking. A smaller loop that works beats a bigger one that doesn't.
