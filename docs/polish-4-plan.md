# Polish 4 (plan)

Use the `impeccable:impeccable` skill for design decisions. Owner taste: hand-crafted, mobile-first, no
generic AI look, no colored-border cards. Check at 390px and 1280px.

## 1. Keys popover (Ideas page, `components/Queue.tsx` `<details className="keys">`)

Closes on outside click/tap and on Escape (focus back to the summary). More comfortable padding and line
height; keys and labels as a small tidy list (one shortcut per row or neat two-column grid), not a cramped
inline sentence. Keep it keyboard accessible. Hide the "Keys" control on touch-only devices
(`(hover: none)`), since shortcuts need a keyboard.

## 2. Show the user's plan

Users cannot tell if they are Pro. Use the existing /me data (plan, status, trial end, pass end):

- Account menu: plan line under the name/email, e.g. "Pro" / "Pro · trial, 5 days left" / "Pro · until
  12 Mar 2027" / "Free". A small, quiet badge style, not loud.
- Settings: a "Plan" section with the same status, and the right action (see passes / extend / nothing).
- Pricing page when signed in: a status strip at the top for Pro users ("You're on Pro until …" or "You're on
  Pro" for no end date); buying would extend (keep coming-soon rules). For trial users, show days left.
  Handle a Pro user with no end date (granted manually): show "Pro" without a date.

## 3. Radar arcs motif, sparingly

The `RadarArcs` motif (icons.tsx, used on Pricing hero and the 1-year card) is the brand's signature. Reuse
it in a few places only, same subtle line weight: landing page hero, the sign-in screen (behind the mark,
very faint), and empty states (Read/Ideas/Saved "nothing yet"). Never behind body text where it hurts
reading; respect dark theme; decorative only (aria-hidden). Do not add it to every page.

## Rules

- Do not commit. Never add Co-authored-by or AI attribution. Never bypass pnpm minimumReleaseAge.
- No dev servers are running; start your own on other ports for screenshots and stop them after.
- Keep typecheck, lint (incl. prettier) and tests green.
