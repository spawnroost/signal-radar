# Polish 3 (plan)

Use the `impeccable` skill (Skill tool) for the design work in steps 2 and 3, reading only the parts you
need. Owner taste: hand-crafted, mobile-first, no generic AI look, no colored-border cards; keep the
existing type (serif titles, sans UI) and palette. Check every change at 390px and 1280px widths.

## 1. Install app out of the Read toolbar

The "Install app" button sits in the Read filter row (All topics / All sources / Install app / Customize)
and wraps badly on phones. Remove it from there. Put install in quieter places: the account menu / Settings
("Install app" row, only when installable), and a small one-time dismissible hint (not a banner that
pushes content) shown after the second visit, never on first load. Keep existing install logic
(beforeinstallprompt, iOS instructions); hide everything when already installed (standalone).

## 2. Pricing page: give it character

It reads like bland paper. Do a real design pass with impeccable: stronger hierarchy and rhythm, a hero
that sells the outcome, the three passes with the 1-year one clearly recommended, a crisp Free vs Pro
comparison, short FAQ-style reassurance (no subscription, time adds up, refunds), tasteful use of the accent
color and texture/depth that fits the existing look. No stock gradients, no emoji, no colored borders.
Keep the pre-rendered pricing route working (it is SSG'd at build).

## 3. Payments "coming soon"

While the server reports checkout disabled (`/api/billing/passes` -> `enabled: false`, i.e. no Razorpay
keys), the Pricing page must not show live Buy buttons. Show a clear, well-designed "Pro opens soon" state:
prices still visible, buttons replaced by a disabled "Coming soon" control, one line saying payments open
shortly and Free works fully now. Same for any other upgrade entry points (upgrade prompts, settings,
SignInSheet upsells): they say "Pro is coming soon" instead of linking to a dead checkout.
When `enabled: true`, everything works as today.

## 4. Read empty-state copy

With no topics chosen ("Skip, show everything") the empty state says "No stories match your topics", which
is wrong. Use copy per case: no topics + empty feed -> "The first stories are on their way. The radar
checks sources twice a day." ; topics chosen + no match -> current text.

## 5. Sign-in screen check

Confirm the redesigned sign-in (Google / GitHub buttons; email only when no provider) looks finished at
390px and 1280px with only Google configured (one button). Polish if it looks sparse.

## Rules

- Do not commit. Never add Co-authored-by or AI attribution. Never bypass pnpm minimumReleaseAge.
- No dev servers are running; start your own on other ports if you need screenshots, and stop them after.
- Keep typecheck, lint (incl. prettier) and tests green.
