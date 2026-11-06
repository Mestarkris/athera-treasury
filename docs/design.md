# Design: the Athera design system

Since D19 the console follows [ATHERA_DESIGN_SYSTEM.md](ATHERA_DESIGN_SYSTEM.md): a monochrome look
with Inter at tight tracking, one Source Serif 4 italic word per view, pill controls, soft surfaces
and hairlines in place of cards. It still runs on Tailwind CSS v4 and the shadcn primitives (D16),
re-themed: the doc's tokens live in `apps/web/app/globals.css`, the shadcn variable names are mapped
onto them, and Tailwind's default palette, radius scale and shadows are switched off
(`--color-*: initial`), as the doc's §6.7 allows.

## What carries meaning

- **Real data only.** Every number, chip and status comes from the ledger, `config.yaml` or public
  RPC. The hero ticker is built from the live policy; nothing is hard-coded. Stubs are labelled `STUB`.
- **Signals.** Green, vermilion and amber dots (`--pass-dot`, `--block-dot`, `--pending-dot`) are fills
  only; readable labels use the darker `--*-text` variants, re-checked for AA in both themes.
  Status is always dot + word.
- **Type.** Inter with tabular figures (`.num`) for amounts, limits and times; JetBrains Mono
  (`.data`) only for hashes and IDs; the serif italic (`.serif-accent`) for the wordmark and one
  accent word ("*policy*" in the hero).
- **Policy boundary.** The hero's 20 + 20 pulsing arcs are the constraint the agents work inside. A
  policy block arriving on the live ledger flashes the innermost three once; a halt locks them all
  in the block colour. They pause when off-screen and hold still under reduced motion.
- **Kill switch.** In the navbar on every page from tablet up, pinned bottom-right on phones,
  never in the menu drawer. Hold 1.2s (or hold Enter/Space); the request fires when the hold
  completes and never waits on the fill.
- **Motion.** Transform, opacity and clip-path only; the boundary lines are the single ambient
  motion. Marquee pauses on hover and focus. Reduced motion: static chips, still lines.

## Where this departs from the doc (all to match what actually runs)

- **Network:** the badge says `mainnet` (NEAR Intents has no testnet, D1).
- **"Built on":** lists NEAR Protocol, NEAR Intents, 1Click, NEAR AI Cloud, TypeScript and Next.js.
  It leaves out OutLayer and NEAR Testnet, which the code does not use.
- **Menu:** includes Buy a report and Reports.
- **Hero CTAs:** "View the ledger" and "Run Athera", with a `Mainnet · real funds` sublabel.
- **Boundary-line colour:** the doc's `#FCFAF8` is drawn over a photo. With no photo it is
  invisible on white, so the light theme uses a faint black (`rgba(10,10,10,0.13)`).
- **Kill switch from the keyboard:** a 1.2s hold of Enter or Space, the same gesture as the
  pointer, instead of a confirm popover.
- **Theme switching:** dark mode follows the OS (`prefers-color-scheme`), not a `data-theme`
  attribute.
- **Secondary label colour:** `--muted-2` is darkened from rgb(152,152,152) to #767676 so it
  passes AA as text.

## Checks

axe-core WCAG 2.2 AA: 0 violations across 11 screens (control room, run, ledger, entry, policy,
security, buy, reports, report, order, 404) in light and dark at 1280px and 390px. No horizontal
overflow on any of them.
