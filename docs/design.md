# Design: shadcn/ui on Tailwind CSS

Since D16 the web console uses a standard component look: Tailwind CSS v4 plus shadcn/ui, with
the shadcn default "neutral" theme in light and dark (following the OS), Geist and Geist Mono,
cards, and lucide icons. The earlier bespoke "flight recorder" direction was replaced at the
user's request. Git history keeps it, for reference.

## What stayed, because it carries meaning

- **Real data only.** Every number comes from the ledger, `config.yaml` or public RPC. Stubbed
  components are labelled `STUB`.
- **Data in monospace.** Amounts, hashes, IDs and timestamps use Geist Mono with tabular figures
  (the `.data` utility). Amounts are right-aligned in tables.
- **Status = icon + word + colour.** `success` (passed, confirmed), `warning` (pending) and `destructive`
  (blocked, halted, failed). shadcn ships only `destructive`, so the other two are added to the theme. All three pass
  WCAG AA as text on the page background in both themes (lowest 4.73:1). Status text is never
  placed on the light-grey `muted` surface, where shadcn's own grey drops to 4.34:1.
- **Signature detail.** Every ledger row shows its policy hash and a verify link. Blocked rows and rules
  get a 2px red left rule.
- **Motion rules** (D14): transform, opacity and clip-path only. 120–240ms; nothing over 400ms
  except the timeline connector. Animate only real events. Reduced motion respected. View
  transitions run from ledger row to entry.
- **Mobile:** 44px targets on touch, the kill switch in a bottom bar within thumb reach, the entry detail as a
  bottom sheet with drag-to-dismiss, safe areas.

## Components (`apps/web/components/ui`)

| Kind | Components |
|---|---|
| Standard shadcn (copied, lightly adapted) | `button`, `card`, `badge` (+ `success`, `warning`, `danger` variants), `table` (focusable scroll region), `input`, `label`, `separator` |
| Project components on that base | `status-badge`, `hash` (copy), `hold-button` (kill switch), `sheet` (non-modal, drag-to-dismiss), `timeline`, `code-view`, `page-header`, `PageTransition` |

The sheet is deliberately not Radix Dialog's modal mode: a modal makes the rest of the page
inert, and the kill switch must stay reachable while a sheet is open.

## Layout rule learned the hard way

Grids default to `auto` columns that grow to fit their content. Every page grid, card body and
content grid uses `grid-cols-[minmax(0,1fr)]`, and cards are `min-w-0`, so long hashes and code
scroll or wrap inside their box instead of widening the page. Unbreakable hashes in running text
get `overflow-wrap: anywhere`.
