# Polish 5: Pro-aware pricing + whole-app consistency review (plan)

Use the `impeccable:impeccable` skill (audit/critique, then polish). Owner taste: hand-crafted,
mobile-first, no generic AI look, no colored-border cards, keep the existing type and palette.
Check every screen at 390px and 1280px, light and dark theme, with headless Chromium.

## 1. Pricing for Pro users

Pro users keep the Pricing nav item, but the page speaks to them:

- Pro with an end date: top of page is their status (Pro until <date>, N days left) and the passes are
  framed as "Add days" (buying extends from the current end date). Hero copy changes from the sales pitch to
  extending ("Add more days to Pro"). Free vs Pro table can collapse or move lower.
- Pro with no end date (granted manually): "You have Pro, no end date. Nothing to buy." Passes shown muted
  or hidden; link back to the radar.
- Trial: days left + passes framed as "Keep Pro after your trial".
- Free / signed out: current sales page.
  Keep coming-soon rules (no live Buy while payments are off).

## 2. The Pro status strip

"[Pro] You're on Pro." in a full-width grey rounded bar reads like a long button. Redesign it as a
non-interactive status line that clearly is not clickable (e.g. small serif/sans status text with the
badge inline, no button-like container, aligned with the page column). Same badge style everywhere the plan
shows (account menu, Settings, Pricing).

## 3. Radar arcs placement

On Pricing the arcs float detached at the right edge, clipped, and look unanchored. Anchor them to the hero
(tie them to a corner of the hero block or the brand mark) or remove there. Add the motif, subtle, to the
Ideas and Saved page heads (decorative, behind nothing readable, aria-hidden, dark-theme aware), so the
signature shows across the app in a consistent way. Same size/weight/opacity rules everywhere.

## 4. Whole-app consistency review and fixes

Walk every screen: landing, sign-in (and ?method=password), Read (with and without topics), search,
Ideas (all tabs), Saved list, reader view, Pricing (each plan state), Settings, Notifications, Welcome/
onboarding, legal pages, 404, account menu, sign-in sheet, install hint, skeletons, empty and error states.
Fix inconsistencies in: page header block (title/lede spacing), button styles and sizes, chip/badge styles,
link styles, card/surface treatments, spacing scale, type sizes, empty-state pattern, focus states,
dark theme contrast, touch targets (44px) on mobile. Prefer reusing existing classes/tokens; remove one-offs.
Keep copy changes minimal and in the same voice.

## Rules

- Do not commit. Never add Co-authored-by or AI attribution. Never bypass pnpm minimumReleaseAge.
- Start your own dev/preview servers on unused ports for screenshots and STOP them when done.
- Keep typecheck, lint (incl. prettier on everything you touch, including this file if needed) and tests green.
