# Saves: Pocket-style "save any link" (plan)

Goal: users can save any URL, read it later in a clean reader view, tag it, and archive it,
alongside the radar's picks. Targets ex-Pocket users (Pocket shut down July 2025).

## Scope (MVP)

1. **Save a link**
   - API `POST /saves { url }`: normalize the URL, dedupe per user (same URL = return the existing save),
     fetch the page server-side (timeout ~10s, size cap ~3 MB, http/https only, block private/loopback
     IPs to avoid SSRF), extract title, site name, excerpt, lead image, main text with the existing
     `@mozilla/readability` + `linkedom` in `packages/core` (reuse any extraction helper that exists).
     Store word count -> read-time minutes. If extraction fails, still save (title = URL host/path).
   - Endpoints: `GET /saves?state=unread|archived&tag=`, `GET /saves/:id` (with content),
     `PATCH /saves/:id { archived?, tags?, favorite? }`, `DELETE /saves/:id`. All per-user, auth required.
2. **Ways to save**
   - "Save a link" input in the web app (paste URL).
   - PWA `share_target` in the web manifest (GET with `url`/`text`/`title` params) -> route that pulls a URL
     out of the params, saves it, shows the result. Sign-in redirect must come back to it.
   - Bookmarklet on the saves page (a "drag this to your bookmarks bar" link) that opens
     `<WEB_ORIGIN>/save?url=...`.
3. **Saves list**: new nav entry "Saved". Tabs Unread / Archived, tag filter, each row shows title,
   site, read time, tags; swipe or buttons for archive and delete. Empty state that explains the
   bookmarklet and share sheet.
4. **Reader view**: `/saved/:id` renders the extracted content (sanitize the HTML on the server
   before storing, or store text and render safely; no raw unsanitized HTML in the DOM),
   good mobile typography, link to the original. Opening it does not auto-archive; an "Archive" button does.
5. **Summary**: "Summarize" button on a save uses the existing summary path/quota (free tier: 3/day).
   Reuse, do not duplicate, the summary code and limits.

Out of scope now: highlights, browser extension, offline caching, Pocket export import (next step).

## Data

New drizzle table `saved_item` in `packages/db`: id, user_id (fk, cascade), url, url_normalized,
title, site_name, excerpt, image_url, content (sanitized html or text), word_count, tags (text[]),
archived_at, favorite, created_at; unique (user_id, url_normalized). Generate a migration with the
repo's existing drizzle-kit script; do not hand-edit old migrations.

## Rules

- Follow the existing code patterns (routes, auth middleware, zod env, tests layout, UI components and styles).
- UI: hand-crafted, mobile-first, matches the existing look; no colored-border cards or generic AI-looking UI.
- pnpm: never bypass `minimumReleaseAge`. Prefer existing deps; if a new one is needed, pin a version old enough.
- Tests: add API tests for save/dedupe/list/patch/delete and the URL guard (SSRF); keep the suite green.
- Do not commit. Do not touch or revert the existing uncommitted Google sign-in changes
  (`.env.example`, `apps/api/src/{app,auth,env}.ts`, `apps/web/src/components/SignIn.tsx`,
  `apps/web/src/lib/auth.ts`, `apps/web/src/styles.css`) except to add to them where needed.
- Dev servers are already running (`pnpm api:dev` on 8787, vite on 5173); do not start or kill them.
