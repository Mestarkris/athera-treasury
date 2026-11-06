# Athera Treasury: Design System
*Extracted from the "Alwayzz" hero spec and adapted to Athera*

> This file is the single source of truth for Athera's visual language. The build prompt (section 5) points here. The Alwayzz spec supplied the **look**: monochrome, Inter paired with a serif italic, tight negative tracking, pill shapes, soft surfaces, marquee rhythm and pulsing curved lines. Athera's blueprint supplies the **rules**: honest data, policy first, a kill switch that can always be reached. Where the two conflict, the blueprint wins. Each conflict is marked **⚠ Adapted**.

---

## 1. What we're keeping from Alwayzz

| Trait | Alwayzz | Why it fits Athera |
|---|---|---|
| Palette | Pure white / near-black / one muted grey / one green | A treasury should look calm and exact. Monochrome makes the few colour signals unmissable. |
| Type pairing | Inter for UI, **Source Serif 4 *italic*** for one accent word | The serif italic becomes Athera's "human voice", used for the word that carries the idea (*policy*, *verify*, *halted*). |
| Tight tracking | −0.04em to −0.08em on everything large | Dense and engineered. It reads as a deliberate typographic choice, not a template. |
| Pills | Rounded-full buttons, tags, nav trigger | Statuses and rule chips fit naturally in pills. |
| Soft surfaces | `rgb(251,251,251)` fills, `rgb(248,248,248)` 4px borders, 8% black hairlines | Separation without cards and shadows. |
| Marquee + edge fade | 30s linear loop with a masked fade on both edges | Reused to show the **policy rules** that bind the agents. |
| Curved pulsing lines | 20 + 20 arcs framing the hero | Reinterpreted as the **policy boundary** that the content sits inside. |
| Progressive blur | White fade at the bottom of the hero | Hands the eye off from the hero to the live ledger. |
| Full-screen menu drawer | Fade 0.4s, large centred links | Kept for navigation. **The kill switch is never inside it** (see §6). |

---

## 2. Tokens

Put these in `apps/web/styles/tokens.css`. Values marked *(Alwayzz)* are copied exactly. Everything else is an Athera addition.

```css
:root {
  /* — Colour (Alwayzz) — */
  --bg:            #ffffff;
  --text:          #0a0a0a;
  --muted:         #6b6b6b;
  --button-bg:     #0a0a0a;
  --button-text:   #ffffff;
  --border-soft:   rgba(0, 0, 0, 0.08);
  --surface-1:     rgb(251, 251, 251);   /* ticker chips, table zebra */
  --surface-2:     rgb(248, 248, 248);   /* 4px "book" button border */
  --muted-2:       rgb(152, 152, 152);   /* secondary micro-label */
  --line-arc:      #FCFAF8;              /* curved boundary lines */

  /* — Semantic signals (Athera) — ⚠ Adapted
     Alwayzz's #17c964 only reaches ~2:1 contrast on white, so it is used
     for DOTS AND FILLS ONLY. Text versions are darkened to pass AA. */
  --pass-dot:      #17c964;              /* (Alwayzz green) live / passed / settled */
  --pass-text:     #0b7a3b;
  --block-dot:     #ff4d2e;
  --block-text:    #c02a10;              /* policy blocked, kill switch, halted */
  --pending-dot:   #f5a524;
  --pending-text:  #8a5a00;              /* intent in flight */

  /* — Type — */
  --font-sans:  "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Source Serif 4", Georgia, serif;
  --font-mono:  "JetBrains Mono", ui-monospace, monospace; /* ⚠ Adapted: hashes & IDs only */

  --track-logo:    -0.08em;
  --track-display: -0.07em;
  --track-serif:   -0.08em;
  --track-heading: -0.04em;
  --track-body:    -0.01em;

  /* — Radius — */
  --r-pill: 9999px;
  --r-sm:   6px;      /* table rows, code blocks */

  /* — Elevation (Alwayzz hover only) — */
  --lift-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);

  /* — Motion — */
  --ease-out:      cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out:   cubic-bezier(0.65, 0, 0.35, 1);
  --dur-fast:      150ms;
  --dur-base:      240ms;
  --dur-drawer:    400ms;   /* Alwayzz */
  --dur-marquee:   30s;     /* Alwayzz */
  --dur-pulse:     5s;      /* Alwayzz */

  /* — Layout — */
  --max-w:  1200px;
  --pad-x:  36px;
  --nav-pad: 19px 36px;
}

@media (max-width: 1199px) { :root { --pad-x: 32px; --nav-pad: 32px; } }
@media (max-width: 809px)  { :root { --pad-x: 24px; --nav-pad: 20px; } }
```

**Dark theme** (`[data-theme="dark"]`): `--bg #0a0a0a`, `--text #f5f5f4`, `--muted #9a9a9a`, `--surface-1 #121212`, `--surface-2 #1a1a1a`, `--border-soft rgba(255,255,255,0.08)`, `--button-bg #f5f5f4`, `--button-text #0a0a0a`, `--line-arc rgba(255,255,255,0.14)`. Re-check AA for every `*-text` signal on the dark background.

**Fonts** (index.html / `next/font`): Inter 400, 500, 600, 700. Source Serif 4 400 and 600, normal and italic. JetBrains Mono 400. Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`, or self-host with `next/font` (preferred, no layout shift).

**Numbers:** every amount, limit and timestamp uses `font-variant-numeric: tabular-nums` in Inter and is right-aligned in tables. Hashes, account IDs and intent IDs use `--font-mono` at 0.92em, middle-truncated (`a1f9c2…7be0`) with copy-on-click.

---

## 3. Type scale

| Role | Font | Size / line-height | Weight | Tracking |
|---|---|---|---|---|
| Logo "Athera" | Serif *italic* | 30px | 600 | −0.08em |
| Display (hero title) | Inter + one serif-*italic* word | 82px / 1.03 → `clamp(60px,8vw,72px)` <1200 → `clamp(44px,13vw,52px)` <810 | 600 | −0.07em (serif word −0.08em) |
| Drawer links | Inter | 48 → 40 → 32px | 500 | −0.04em |
| Page heading | Inter | 40px / 1.1 | 600 | −0.04em |
| Section heading | Inter | 22px / 1.2 | 600 | −0.03em |
| Subtitle / lead | Inter | 17px / 1.45, `--muted` | 400 | −0.01em |
| Body / table | Inter | 14–15px / 1.5 | 400–500 | −0.01em |
| Chip / label | Inter | 13px | 500 | −0.01em |
| Micro (secondary) | Inter | 12px, `--muted-2` | 500 | 0 |

**Serif-italic rule:** at most **one** serif-italic word per view, and it must be the word that carries the meaning. Never use it for a whole sentence.

---

## 4. Components

### 4.1 Navbar (fixed, z-index 100)
- Padding `var(--nav-pad)`, max-width `1200px`, centred.
- Left: **"Athera"** wordmark (serif italic, 30px, 600, −0.08em). ⚠ Adapted: no ® symbol, because Athera isn't a registered trademark. If you want the superscript rhythm, use a small Inter 600 14px **"TS"** or the network badge `testnet` in a pill instead.
- Right, in this order: **network pill** (`● testnet`, green dot), **kill switch** (see 4.7), and the **"Menu" pill** (black, white, 14px 500, `ChevronUp` 16px from lucide-react, rotated 180° while the drawer is open).

### 4.2 Menu drawer
- Full-screen, `--bg`, opacity fade over `--dur-drawer`, with links rising 8px and staggered 40ms apart.
- Links (centred vertically, 48px 500, −0.04em): **Control room · Demo loop · Ledger · Policy · Security**.
- Footer: `© 2026 Athera Treasury · Built for the NEAR Hackathon` on the left, and the current policy version `policy v3 · a1f9c2` in mono on the right.
- Focus trap, Esc to close, `aria-modal`, and focus goes back to the Menu button on close.

### 4.3 Hero (landing / control room top)
- `min-height 850px` (760 <810), padding `160px 36px` → `140px 32px` → `120px 24px 96px`, centred flex column.
- **Background:** ⚠ Adapted. Don't hotlink the Alwayzz image, which is their asset. Use either a self-hosted abstract texture of your own (soft monochrome, low contrast, stored in `/public/hero.webp`) or no image at all, letting the boundary lines (below) carry the hero. Apply it through `::before` with `background-size: cover`, and rotate it 90° under 810px, as in the original.
- **Policy-boundary lines** (the Alwayzz curved lines, with a new meaning):
  - 20 left and 20 right, absolutely positioned, tall rectangles, `2.5px solid var(--line-arc)`, 80% radius on the inner side only. Widths start at 60px and grow by 10px; `animation-delay: i × 0.25s`; `line-pulse 5s ease-in-out infinite`.
  - **Meaning:** these lines are the constraint the agents work inside. On `/demo`, when a proposal is **blocked**, the innermost 3 lines on both sides flash once in `--block-dot` (one cycle, 600ms), then go back to normal.
  - When the kill switch is **halted**, the pulse stops, all lines hold at opacity 0.5 in `--block-dot` at 40% alpha, and the whole hero visibly "locks".
  - Under 810px: hide the side lines and show horizontal top lines (same animation, bottom radius).
- **Ticker row** (max-width 500px, height 36px): the marquee from Alwayzz, but the chips are the **real rule names from `config.yaml`**, with live values where they're short:
  `Per-tx limit · 1,000 USDC` · `Daily cap · 5,000 USDC` · `Approved: NEAR, USDC, ETH` · `Max drawdown · 8%` · `Revenue split · 70/30` · `Inference · 20 NEAR/day` · `Kill switch · armed`
  Chips: 13px 500, `--muted`, padding `6px 14px`, pill, `--surface-1`. Edge mask `linear-gradient(90deg, transparent 0%, black 12%, black 88%, transparent 100%)`. Repeat the track 4× and translate it −50%. **Pause on hover/focus.** The data comes from the policy engine, so the chips are never hard-coded.
- **Title** (max-width 550px):
  `Autonomous treasury that moves only inside <em class="serif">policy</em>.`
  Other options: `Agents propose. <em>Policy</em> decides.` / `Every move, <em>verifiable</em>.`
- **Subtitle** (max-width 476px): `Humans set the rules once. Agents act inside them. Every value movement settles through NEAR Intents and lands on a public ledger you can check yourself.`
- **CTA row** (gap 16px; stacks full-width, max 320px, under 810px):
  - **Primary, "View the ledger":** 56px tall, padding `18px 30px`, pill, black, 15px 600. Hover: `translateY(-1px)` + `--lift-shadow`. Active: `translateY(0) scale(0.98)`.
  - **Secondary, the "book" button reused as "Run the demo loop":** white background, 4px `--surface-2` border, pill, padding `8px 24px 8px 8px`. ⚠ Adapted: replace the avatar with a **40px black circle containing a play glyph** (or the Athera mark), not a stock person photo. Text stack: `Run the demo loop` (14px 600) over `● Testnet · ~2 min` (12px 500, `--muted-2`, green 8px dot). While a run is in progress, the dot turns `--pending-dot` and the label becomes `Running · stage 3/7`.
- **Progressive blur** at the bottom: absolute, full width, 178px, `linear-gradient(to bottom, transparent, rgba(255,255,255,0.4) 40%, #fff)`. Under it, the **latest 5 ledger rows** start, so the hero flows straight into real data.

### 4.4 "Built on" strip (replaces Alwayzz's TrustedBy) ⚠ Adapted
The Alwayzz section lists Airbnb, Shopify, Stripe and others as "partners". For Athera that would be a false claim and would break the blueprint's honesty rule. Replace it with:
- Label (max-width 163px, 14px 500, muted): **"Built on infrastructure you can verify"**
- Marquee (30s, same edge mask) of what the code **actually** uses, as plain Inter 600 16px text. **No logos you aren't licensed to use.** The list: `NEAR Protocol · NEAR Intents · OutLayer · NEAR Testnet · TypeScript · Next.js`. Each one links to its docs.
- If the list is too short to scroll naturally, make it a static row instead of a marquee.

### 4.5 Ledger table
- Real `<table>`. Header 12px 500 `--muted`, uppercase off (keep it sentence case), hairline `--border-soft` below.
- Rows 52px, hairline separators, hover `--surface-1`. No cards, no shadows.
- Columns: Time (tnum) · Agent (pill) · Event · Amount (right, tnum) · Policy (mono hash) · Result (status pill) · Verify (↗ link).
- New rows slide in from −8px at opacity 0 → 0 / 1 over `--dur-base`, staggered 35ms, with a `--surface-1` highlight that fades over 1.2s.

### 4.6 Status pills
`● Passed` · `● Blocked` · `● Pending` · `● Settled` · `● Halted` · `STUB`
13px 500, pill, `--surface-1` background, coloured **dot** + `*-text` label. `STUB` is mono 11px, `--muted`, with a dashed 1px border.

### 4.7 Kill switch ⚠ Adapted (not part of Alwayzz; it's an Athera non-negotiable)
- Lives **in the navbar on every page**, **never** inside the drawer, and is pinned bottom-right in the thumb zone on mobile.
- Default: a pill with a white background, 1px `--border-soft` border, `● Kill switch` with a `--block-dot` dot, 14px 500.
- Interaction: **press and hold for 1.2s**. A `--block-dot` fill sweeps left→right using `clip-path` (linear, so the timing is honest). Release early and it reverses over 150ms. Keyboard: Enter opens a confirm popover, Enter again triggers it.
- Halted: the pill becomes a solid `--block-text` background with white `Halted · 14:02:31`. The hero lines lock (§4.3). A full-width 36px banner slides down under the navbar. An `aria-live="assertive"` announcement fires.
- **The halt request is sent the moment the hold completes. Animation never delays it.**

### 4.8 Demo-loop timeline (`/demo`)
- A vertical list of 7 stages, each with a 24px node and a connector line. Pending node: 1.5px `--muted` ring. In progress: `--pending-dot` with a 1.6s opacity breathe. Passed: filled `--pass-dot` with a check that draws in 200ms. Blocked: `--block-dot` with an ✕.
- A stage advances **only when its real event arrives**. The connector to the next stage draws (`scaleY` 0→1, 300ms `--ease-out`) at that moment.
- The ID or hash fades in using mono, next to a `↗ explorer` link.

---

## 5. Motion

| Motion | Spec | Source |
|---|---|---|
| `marquee-left` | `translateX(0 → -50%)`, 30s linear infinite, 4× track, paused on hover/focus | Alwayzz |
| `line-pulse` | 0% opacity 0 scale 1 → 15% 0.9 → 70% 0.4 → 100% 0 scale 0.85; 5s ease-in-out infinite; delay `i × 0.25s` | Alwayzz |
| Drawer | opacity fade 400ms + links rising 8px, 40ms stagger | Alwayzz + |
| Button hover | `translateY(-1px)` + lift shadow, 150ms ease-out | Alwayzz |
| Button press | `scale(0.98)`, 100ms | Athera |
| Ledger row enter | from −8px / opacity 0, 240ms, 35ms stagger, highlight fade 1.2s | Athera |
| Block cue | innermost boundary lines flash once, 600ms; row 2px left rule in `--block-dot` | Athera |
| Kill-switch hold | linear `clip-path` fill 1.2s; reverse 150ms on early release | Athera |
| Page transitions | `react-view-transitions`: ledger row ↔ detail as a shared element on the ID; cross-fade elsewhere, 240ms | Athera |

```css
@keyframes marquee-left { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes line-pulse {
  0%   { opacity: 0;   transform: scale(1); }
  15%  { opacity: 0.9; }
  70%  { opacity: 0.4; }
  100% { opacity: 0;   transform: scale(0.85); }
}
@media (prefers-reduced-motion: reduce) {
  .marquee-track { animation: none; }          /* show a static, wrapped chip list */
  .boundary-line { animation: none; opacity: 0.35; }
  * { transition-duration: 0.01ms !important; }
}
```

Only `transform`, `opacity` and `clip-path` are animated. The 40 boundary lines use `will-change: opacity, transform` and **pause when the hero is off-screen** (IntersectionObserver), so they don't burn battery on `/ledger`.

---

## 6. Where Athera deliberately departs from Alwayzz

1. **No borrowed assets.** The Alwayzz hero image and Framer avatar belong to someone else. Use self-hosted, original assets, or none.
2. **No "trusted by" logos.** Athera can only list infrastructure it actually runs on.
3. **No ®.** Use a plain wordmark unless the mark is registered.
4. **The green is a dot, not text.** `#17c964` fails AA as text, so readable labels use darker `*-text` variants.
5. **Monospace added.** Alwayzz has no mono. Athera needs it for hashes and IDs so they can be checked by eye.
6. **The kill switch sits outside the drawer.** A safety control must never be one tap away behind a menu.
7. **"Custom CSS, not Tailwind utilities"** from the Alwayzz spec still applies. Use CSS Modules + `tokens.css`. If Tailwind is installed for tooling, its default palette and radius scale are switched off.
8. **Inter is allowed here** (in the earlier build prompt it was on the "AI tell" list) because it's being used *deliberately*: tight negative tracking, paired with a serif italic, inside a strict monochrome system. Using Inter at default tracking is still a tell.
