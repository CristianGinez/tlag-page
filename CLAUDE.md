# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (`packageManager: pnpm@10`, Node 22.x). The README still says `npm` — it's outdated.

```bash
pnpm dev           # Start dev server (port 4321)
pnpm build         # Production build (Vercel adapter)
pnpm preview       # Preview production build
pnpm astro check   # TypeScript type-check all .astro/.ts/.tsx files
```

No test suite or linter is configured. `astro check` + `pnpm build` are the verification steps.

UI copy, comments and commit messages are mostly in Spanish (TeamLag is a Spanish-speaking gaming community).

## Architecture

**Stack:** Astro 5 SSR (`output: 'server'`, Vercel adapter) + React 19 islands + Tailwind v4 (via `@tailwindcss/postcss`) + Supabase + Upstash Redis + Convex (Discord bot backend) + GSAP.

### Feature-sliced layout

```
src/
  features/<name>/   components/, lib/, types.ts, index.ts (barrel)
  shared/            lib/, ui/, components/, stores/ — cross-cutting only
  layouts/           Layout.astro (shell, ClientRouter, AdSense), Navbar, Footer
  pages/             thin routing; API routes under pages/api/
  content/           collections: history (JSON), faq (md), legal (md) — schema in content/config.ts
```

Import rules (from `src/features/README.md`):
1. Features may import from `@/shared/*`.
2. Features should **not** import from other features (exception in practice: everything imports the Supabase client from `@/features/auth/lib/supabase`).
3. `@/shared/*` never imports from features.
4. Pages only orchestrate — no business logic.

Features: `awards`, `parsec-league`, `achievements` (badges), `community` (VIPs), `news` (live streams + changelog feed), `chatbot`, `auth`, `admin`, `bot-admin` (Discord bot dashboard), `profile`.

Path aliases: `@/*`, `@/features/*`, `@/shared/*`, `@/layouts/*` → `src/...`.

### Auth — the main source of bugs

Supabase uses the **PKCE flow with the session in localStorage, not cookies**. Consequences:

- `getSupabase(Astro)` (SSR client in `features/auth/lib/supabase.ts`) usually **cannot see the user** in frontmatter. Don't rely on it for authorization.
- Protected API routes read `Authorization: Bearer <access_token>`, and client components must send it (`supabase.auth.getSession()` → `session.access_token`). Pattern: `src/pages/api/vip/update.ts`, `src/pages/api/admin/vips.ts`.
- Admin pages (`/admin`, `/admin/*`) check admin status **client-side** inside an `astro:page-load` handler, then call admin APIs with the Bearer token.
- Admin source of truth is the `admin_users` table; `user.app_metadata.is_admin` (Custom Access Token Hook) is only a fast-path/fallback. See `features/bot-admin/lib/botApiAuth.ts` (`requireBotAdmin`) and `pageAuth.ts`.
- `createServiceClient()` uses `SUPABASE_SERVICE_ROLE_KEY` (server-only) to bypass RLS — used by API routes that validate the token then write (VIPs, badges, Discord sync).
- Client auth state: nanostores `$currentUser` in `features/auth/stores/authStore.ts`.

**Discord linking:** Google login → `supabase.auth.linkIdentity({ provider: 'discord' })` → redirect to `/perfil?linked=discord` → `POST /api/auth/sync-discord` (server reads identities via admin API, because browser `getUser()` doesn't reliably return them) → writes `profiles.discord_id`. **`profiles.discord_id` is the source of truth** for "linked" state, not `user.identities`. Linking also grants the `discord-conectado` badge.

### Data & caching

- Most content lives in Supabase tables (`award_categories`/`award_nominees`, `league_teams`, `vips`/`vip_links`, `profiles`, `events`, …) and RPCs (`get_vote_counts`, `get_category_vote_counts`, `get_event_winners`, `get_badges_with_progress`, `get_admin_stats`).
- Reads go through `getCached({ key, ttl }, fetcher)` in `shared/lib/cache.ts` (Upstash Redis; silently degrades if env vars missing). **After any write, call `invalidateCache(key)` with the matching key** (e.g. `vips:all`, `award_categories:<eventId>`, `league_standings`, `badges:catalog`). External invalidation: `POST /api/internal/invalidate` with `INTERNAL_INVALIDATE_SECRET`.
- `shared/lib/events.ts` is the static catalog of events (slug, type `awards|league`, status) driving `/eventos/[eventId]/*`. The awards DB event id is `EVENT_ID_2025` in `features/awards/lib/awardsData.ts`.

### Voting

`VoteButton` → `features/awards/lib/voting.ts` → Supabase Edge Function `vote` (user JWT; checks `is_voting_open` on the `events` row). `admin-reset-votes` Edge Function archives and clears votes. Open/close voting by toggling `events.is_voting_open` for `856a7c16-5436-4776-a844-04dcaafb4656`.

### Discord bot admin (Convex)

The Discord bot lives in a separate repo (`tlag-discord-bot`, hosted on Oracle Cloud) with Convex as backend. `/admin/bot/*` pages read via `ConvexHttpClient` and write through `/api/bot/*`, which run `requireBotAdmin()` and forward the user's Supabase JWT to Convex (`setAuth(token)`); Convex re-checks admin itself. `convexClient.ts` returns `null` if `PUBLIC_CONVEX_URL` is missing. Steps for adding a section are in `src/features/bot-admin/README.md`.

### Client scripts & View Transitions

`Layout.astro` uses `<ClientRouter />`, so pages are swapped without full reloads:
- Put init code in `document.addEventListener('astro:page-load', ...)` and query DOM elements **inside** the handler, not at module top level.
- GSAP must be imported from `@/shared/lib/gsap` (registers ScrollTrigger and kills triggers on `astro:before-swap`).

### Security headers / external domains

CSP and other headers are defined in **`vercel.json`**. When adding any new external host (images, scripts, Supabase/Convex/Upstash endpoints, iframes, ads), update the CSP there; for images also add it to `image.domains` in `astro.config.mjs` and, if needed, `shared/lib/imageOptimizer.ts` (CDN-specific resize params for Cloudinary, ImageKit, Supabase, YouTube, Discord). AdSense is loaded in `Layout.astro` with `is:inline`.

### Other

- Chatbot: `POST /api/chat` → `features/chatbot/api/chat.ts` → Gemini; rate-limited 10 req/min/IP via Upstash.
- OG images: `/og/default.png`, `/og/categoria/[id].png`, `/og/evento/[slug].png` (`@vercel/og`, helpers in `shared/lib/og*.ts`).
- Design specs and implementation plans live in `docs/superpowers/{specs,plans}/`.

### Environment variables

See `.env.example`. Beyond Supabase/Gemini/Upstash/`INTERNAL_INVALIDATE_SECRET`, the code also needs `SUPABASE_SERVICE_ROLE_KEY` (server API routes — not listed in `.env.example`), `PUBLIC_ADMIN_EMAIL`, `PUBLIC_CONVEX_URL` and `CONVEX_DEPLOY_KEY` (server-only).
