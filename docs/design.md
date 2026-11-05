# Design: "the flight recorder"

An instrument panel crossed with an accounting ledger. Exact, quiet, dense. Every element carries
information; nothing is decoration. The brief's own direction wins every conflict below.

## Palette (tokens.css; AA checked by script, lowest text pair 4.55:1)

| Role | Light | Dark | Use |
|---|---|---|---|
| paper | `#F1F0EC` | `#1C1C1F` | page |
| paper-sunk | `#E7E5DF` | `#252528` | code, selected row, sheet |
| ink | `#18181B` | `#E8E6E1` | primary text, primary controls |
| ink-2 / ink-3 | `#45454B` / `#626269` | `#B4B2AC` / `#8E8C87` | secondary / tertiary text |
| rule / rule-strong | `#CFCCC4` / `#9E9B93` | `#36363A` / `#5A5A5F` | hairlines only (not text, not control borders) |
| signal-pass | `#2B6544` | `#71B28A` | confirmed, passed |
| signal-block | `#B83A1E` | `#EE7A5E` | blocked, halted, failed |
| signal-pending | `#855C0B` | `#D6A54C` | submitted, awaiting finality |

The paper is a cool, slightly grey ledger stock rather than warm cream, which is the generic tell.
The dark theme is graphite with warm-white ink and desaturated signals. It is not neon on black.
Everything that is not a status is greyscale.

## Type

- **Archivo** (variable, with a width axis) for the UI. It is a grotesque with real character in its
  narrow widths. Table headers and dense labels use width 87 (semi-condensed, instrument-panel); body
  text uses width 100. Only weights 400 and 600.
- **IBM Plex Mono** for every amount, hash, ID, timestamp and block height. Always right-aligned in
  tables, with tabular figures.
- **Five sizes, no more:** 12 / 14 / 17 / 22 / 32 px (`--text-1…5`). Labels are sentence case, never
  tracked all-caps.

## Layout

A 12-column grid with a 24px gutter and a max width of 1200px. Content is left-aligned. There are no
cards: sections are separated by hairline rules and whitespace. Radii are 0 by default, 2px on
controls and 4px on the sheet. The only shadow is the one under the mobile sheet.

```
┌ status strip ─ mainnet · intents.near │ Policy v2 · 3678ff │ ● running        [ hold to halt ] ┐
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ seq  time      agent       event            amount          policy        result   verify    │
│ 0099 17:14:20  accounting  payout     0.00003 wNEAR   v2 · 3678ff   ✓ conf   nearblocks ↗   │
│ 0098 …                                                                                       │
```

## The one memorable element

A **status strip** that is always present. It holds the network, the policy version and hash, the
run state and the kill switch. When halted, it becomes a vermilion-ruled band that reads "Halted
17:13:48 · operator halt…" on every page at once, and the strip is the only place the
interface raises its voice. Everything else stays quiet.

## Signature detail (from the brief)

Every ledger row shows its policy hash and a verify-on-explorer link. Blocked rows carry a 2px
vermilion left rule.

## Rejected defaults

- **No eyebrows or icons:** no all-caps eyebrows, no "→" on buttons, no icon set. Text labels plus
  the three status glyphs ✓ ✕ ◷ only.
- **No cards or gradients:** no cards, shadows, gradients or glass, and no hero.
- **No ornamental mono:** mono is never used for prose or labels, only for data.
