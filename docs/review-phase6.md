# Phase 6 review: Web Interface Guidelines

Source: vercel-labs/web-interface-guidelines `command.md`, fetched 2026-11-05. Scope: every
screen and shared component in `apps/web` (46 files). Status after fixes is in the last column of
each section.

## Findings

### apps/web/components/ui/Sheet.module.css

components/ui/Sheet.module.css:34 - `outline: none` on the dialog panel with no replacement → scope it to `:focus:not(:focus-visible)` (fixed)

### apps/web/components/ui/Sheet.tsx

components/ui/Sheet.tsx:59 - `<div onClick>` scrim → acceptable: `aria-hidden` decoration, with keyboard and AT equivalents (Close button, Escape) (pass, justified)
components/ui/Sheet.tsx - drag-to-dismiss is a gesture → Close button and Escape are the tap and keyboard alternatives (pass)
components/ui/Sheet.tsx - non-modal, focus not trapped → deliberate (D12): the kill switch must stay reachable while a sheet is open (pass, justified)

### apps/web/components/shell/StatusStrip.tsx

components/shell/StatusStrip.tsx:69 - halt band `role="status"` + `aria-live="assertive"` conflict → `role="alert"` (fixed)
styles/base.css - sticky strip and mobile bar can cover anchored or focused rows (`/ledger#id`) → `scroll-padding-top` and `scroll-padding-bottom` on `html` (fixed)

### apps/web/components/ui/Button.module.css, HoldButton.module.css

components/ui/Button.module.css:31 - no hover state → hover added, gated on `(hover: hover) and (pointer: fine)` (fixed)
components/ui/HoldButton.module.css:1 - no hover state → same (fixed)

### apps/web/styles/base.css

styles/base.css:48 - headings lack `text-wrap: balance`; paragraphs `pretty` → added (fixed)
styles/base.css - page rubber-band on fine pointers → `overscroll-behavior: none` on `html` inside `@media (pointer: fine)`; touch keeps pull-to-refresh (fixed)

### apps/web/app/ledger/page.tsx

app/ledger/page.tsx:18 - list renders up to 200 rows without virtualization (> 50) → page of 50, older pages via `?before=<seq>` in the URL (fixed)

### apps/web/app/demo/DemoConsole.tsx

app/demo/DemoConsole.tsx:104 - "Run demo loop" moves real mainnet funds on one click (destructive, irreversible) → two-step confirm that states the exact amount (fixed)
app/demo/DemoConsole.tsx:86 - error "Could not start (HTTP n)" has no next step → names the server log path (fixed)

### apps/web/lib/operator.ts

lib/operator.ts:17 - "Operator token missing or wrong." has no next step → names where the token lives (fixed)

### apps/web/app/security/page.tsx (and other copy)

app/security/page.tsx:38,81,83,87,156,157 - straight apostrophes (`&apos;`) → typographic ’ (fixed)

### apps/web/components/ui/Table.tsx, CodeView.tsx, Hash.tsx

components/ui/Table.tsx:21 - data cells (hashes, IDs, amounts) can be garbled by auto-translate → `translate="no"` on data cells (fixed)
components/ui/CodeView.tsx:27 - `translate="no"` on code (fixed)
components/ui/Hash.tsx:37 - `translate="no"` on hashes (fixed)

## Deliberate deviations (recorded, not fixed)

- **Sentence case, not Title Case,** for headings and buttons. The brief's voice ("plain and
  verifiable") and the art direction (docs/design.md) both specify sentence case.
- **Timestamps are ISO-8601 UTC slices, not `Intl.DateTimeFormat`.** A ledger must show the
  exact, unambiguous instant a reviewer can match against block times; localised times would
  break that. Columns say "(UTC)".
- **Amounts are exact decimal strings, not `Intl.NumberFormat`.** Values come from base units with
  24 decimals. Locale formatting would round or regroup them, so they could no longer be matched
  to on-chain amounts.

## Passes (no findings)

- **Accessibility:** no icon-only buttons; every form control has a wrapping `<label>`; buttons for
  actions, links for navigation; decorative SVG marks are `aria-hidden`; skip link present;
  heading hierarchy h1 → h2 → h3 on every page; live regions on timeline stages, copy
  confirmations, kill-switch errors and new ledger rows.
- **Focus:** global `:focus-visible` ochre ring, AA-visible on paper and graphite.
- **Forms:** filters are a plain GET form (works without JS); the token field has `name`,
  `autocomplete="off"`, `spellCheck={false}`, and a submit that stays enabled.
- **Animation:** transform, opacity and clip-path only; no `transition: all`; reduced motion
  honoured (D14); transitions are interruptible.
- **Typography:** "…" in all loading states; tabular figures on all data (`.data`).
- **Content:** long hashes wrap (`overflow-wrap: anywhere`); `min-width: 0` on flex and grid
  children; empty states for ledger, filters, policy history, demo and RPC failure.
- **Images:** no raster images.
- **Navigation:** filters and run selection live in the URL; every ledger row has a URL; links are
  `<a>` or `<Link>`.
- **Touch:** `touch-action: manipulation`; tap highlight set; `overscroll-behavior: contain` in the
  sheet; no `autoFocus`.
- **Theming:** safe areas; `color-scheme` per theme; `theme-color` matches paper in both themes;
  `<select>` has explicit background and colour.
- **Hydration:** no client-rendered dates from the client clock; uncontrolled inputs.

## Automated accessibility scan (axe-core 4.14, WCAG 2.0/2.1/2.2 A and AA)

8 screens (`/`, `/demo`, `/ledger`, two entry pages, `/policy`, `/security`, 404) × light and dark ×
1280px and 390px = 32 runs.

- **First pass, 18 violations, 2 kinds:**
  - `label-content-name-mismatch` (WCAG 2.5.3, Label in Name): row sequence links and explorer hash
    links had accessible names that did not contain their visible text.
  - `scrollable-region-focusable`: wide tables that scroll sideways at 390px were not keyboard-reachable.
- **Fixes:**
  - Row links keep their visible text as their name.
  - Hash-link names start with the visible text.
  - Table scroll containers are focusable, labelled regions.
- **Final pass: 0 violations.** No colour-contrast violations in either theme at any point.

## AI-look checklist (brief), checked by grep over the source

| # | Avoid | Result |
|---|---|---|
| 1 | purple/blue gradients | none |
| 2 | blobs | none (round shapes = timeline status markers only) |
| 3 | glassmorphism | none |
| 4 | glows | none |
| 5 | neon on black | none (graphite dark theme, desaturated signals) |
| 6 | centred hero, gradient word, 2 buttons, 3 cards | none |
| 7 | Inter/system-ui everywhere | none (Archivo + IBM Plex Mono) |
| 8 | rounded-2xl | none (radii 0–4px) |
| 9 | emoji, generic icons | none (four drawn status marks, always with a word) |
| 10 | fake metrics, decorative sparklines | none (all numbers from the ledger or RPC) |
| 11 | "AI-powered ✨" | none |
| 12 | lorem ipsum | none |
| 13 | shadows everywhere | one: the mobile sheet |
| 14 | nested cards | none |
| 15 | centre alignment by default | none (only inside button labels and markers) |
| 16 | gratuitous motion | audited (D14) |
| skill | tracked all-caps eyebrows, "→" on links, middle-dot joiners | `STUB` only (brief); no arrows; middle dot kept only in the brief's policy tag |

## JS budget (modern first-load, gzip -9, `noModule` polyfill excluded; limit 143,360 B = 140 KB, D13)

| Route | Bytes | |
|---|---|---|
| /security | 140,737 | within |
| /policy | 140,737 | within |
| / | 141,474 | within |
| /ledger/[id] | 141,813 | within |
| /ledger | 143,493 | **133 B over** |
| /demo | 144,655 | **1,295 B over** |

Phase 5 (view transitions, phone entry sheet) pushed /ledger and /demo over. Trims made:
- the sheets load on first use with `React.lazy` (`next/dynamic` added more runtime than it saved);
- the sheet CSS is split out;
- the demo timeline shows hashes as plain explorer links.

The rest would mean removing features or copy, so it is escalated to the user.
