# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VanSpend is a multi-user receipt-scanning and expense-tracking app for a household in BC, Canada (Vancouver) — each household member registers their own account, and the receipts/items they upload are scoped to that account. It uploads receipt photos (Costco, T&T, etc.), sends them to a multimodal LLM via OpenRouter to extract structured line-items, stores them in an external MySQL database, and charts spending/tax breakdowns (GST 5% / PST 7%) in a browser dashboard. Receipt images stay on-disk (`uploads/`); structured data lives in MySQL. Auth is session-cookie based (`iron-session`) with open self-registration — no shared/family visibility across accounts. One role beyond regular accounts: `is_admin`, bootstrapped once from `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `.env`, giving access to an admin console (`/admin`) that can see/manage every user and every receipt.

Frontend + API are a single Next.js (App Router) app. Business logic (DB access, OpenRouter calls) lives in framework-agnostic `.cjs` modules under `src/`, imported by the Route Handlers.

## Commands

```bash
npm install       # next + react + react-dom + react-chartjs-2 + chart.js + iron-session + mysql2 + bcryptjs
cp .env.example .env   # then fill in OPENROUTER_API_KEY, MYSQL_* connection vars, SESSION_SECRET, PORT
                        # optionally ADMIN_USERNAME/ADMIN_PASSWORD to bootstrap one admin account
npm run dev        # next dev, serves http://localhost:3000 (PORT env var; Next.js reads it natively)
npm run build      # next build (Turbopack) — required before `npm start`
npm start          # next start, production mode
npm run selfcheck  # node scripts/selfcheck.cjs — offline checks of normalize()/db logic, no API calls, no test framework

# or via Docker:
docker compose up -d   # app + a bundled MySQL for local trial (see docker-compose.yml comments
                        # for pointing at an external MySQL instead)
```

There is no linter or test framework. `scripts/selfcheck.cjs` is the only correctness check in the repo; run it after touching `src/openrouter.cjs` (parsing/normalization) or `src/db.cjs` (stats queries). It writes/cleans up a test user (`username='__test_selfcheck__'`, cascades to its receipts/items) in the real MySQL database pointed to by `.env`, so it is not fully side-effect-free. It runs via plain `node`, entirely outside Next.js.

Requires a reachable MySQL server (connection configured via `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE` in `.env`) and the `MYSQL_DATABASE` schema must exist beforehand (`sql/schema.sql`, or let the app auto-create tables on startup if the account has DDL privileges).

## Module system (important, easy to get wrong)

`package.json` has `"type": "module"` — plain `.js` files are ES modules (required: Next.js App Router special files like `page.js`/`layout.js`/`route.js` must keep those exact names, so they can't be renamed to `.mjs`; the fix instead is project-wide ESM + `.cjs` for the legacy CommonJS files). Two islands of code:

- **`app/**`, `components/**`, `lib/**`, `src/session.js`, `src/http.js`** — ESM (`import`/`export`). These only ever run inside Next's bundler (Turbopack).
- **`src/db.cjs`, `src/openrouter.cjs`, `src/uploads.cjs`, `scripts/selfcheck.cjs`** — CommonJS (`require`/`module.exports`), explicit `.cjs` extension. These need to stay `require()`-able by plain `node` (specifically `scripts/selfcheck.cjs`, which runs outside Next entirely) — Route Handlers `import` them via **default import**, e.g. `import dbApi from '@/src/db.cjs'` then `dbApi.saveReceipt(...)`, never named imports (CJS/ESM interop for named exports from a plain `module.exports = {...}` object is not reliably synthesized by Turbopack — default-import-then-property-access is the safe pattern used everywhere in this repo).
- **`@/*` path alias** (`jsconfig.json`) maps to the project root — used by every `app/api/**/route.js` file to avoid fragile relative-path counting at 3–4 levels of nesting.
- **Never use `__dirname`-relative `fs` reads in code that gets bundled by Next** (anything reachable from `app/**`). Turbopack virtualizes `__dirname` into a fake path during `next build`'s "collecting page data" step, so `fs.readFileSync(path.join(__dirname, ...))` throws `ENOENT` at build time even though it works fine under plain `node`. Use `process.cwd()` instead (real process working directory, unaffected by bundling — see `src/uploads.cjs`'s `UPLOAD_DIR` and the `.env` loaders in `src/db.cjs`/`src/openrouter.cjs`), or for static config, a plain `require('../config/config.json')` so the bundler inlines it at build time instead of reading it at runtime (see `src/openrouter.cjs`).

## Architecture

- **`app/api/**/route.js`** — one file per endpoint, each exporting `GET`/`POST`/`DELETE` etc. Thin: validate → call into `src/db.cjs`/`src/openrouter.cjs` → `NextResponse.json(...)`. Every handler wraps its body in `wrap()` (`src/http.js`) for uniform error → `{error}` 500 responses, mirroring the old Express `wrap()` middleware. Auth-gated routes start with `const { session, response } = await requireSession(); if (response) return response;` (`src/session.js`) — 401 `{error}` if not logged in. Public routes: `POST /api/auth/register|login|logout`, `GET /api/auth/me`, `GET /api/config`. Scanning (`POST /api/scan`) and persisting (`POST /api/receipts`) stay separate steps — the API never auto-saves an AI read.
- **`app/api/admin/**/route.js`** — admin-only, gated by `requireAdmin()` (`src/session.js`, 401 if not logged in / 403 if not `session.isAdmin`) instead of `requireSession()`. Mirror the regular `receipts`/`stats` endpoints but call the *same* `src/db.cjs` functions with `userId` omitted (global, across all users) or set to an admin-chosen target user — see `dateFilter`'s optional-`userId` note below. Plus two admin-only reads: `users` (`dbApi.listUsers()`), `stats/by-user` (`dbApi.statsByUser()`, spend-per-user, a dimension that doesn't exist in the single-user view). `users/[id]` `DELETE` refuses to delete the currently-logged-in admin (`+id === session.userId` check) to avoid self-lockout.
- **`app/uploads/[...file]/route.js`** — replaces the old `express.static('/uploads')`. Streams a file from `UPLOAD_DIR` (`src/uploads.cjs`) given a catch-all path segment; manually re-implements path-traversal protection (`express.static` used to do this for free) by resolving the joined path and rejecting anything that doesn't stay under `UPLOAD_DIR`. Deliberately at `app/uploads/...`, not under `app/api/...`, so image URLs (`/uploads/<file>`) are unchanged from the pre-migration app. Not auth-gated (same trade-off as before the migration — see Scope Boundaries).
- **`src/session.js`** — `iron-session` config + `getSession()` (reads/writes the encrypted session cookie via `next/headers` `cookies()`) + `requireSession()`/`requireAdmin()` (the shared 401-or-session / 401-or-403-or-session helpers used by every protected/admin route). Session data (`userId`, `username`, `isAdmin`) lives entirely in the signed cookie — no session table in MySQL (unlike the interim `express-mysql-session` version this replaced). `isAdmin` is set once at login/register time; revoking admin in the DB doesn't take effect until that session's cookie is renewed.
- **`src/http.js`** — the `wrap()` helper.
- **`src/openrouter.cjs`** — builds the vision prompt (in Chinese, matching the product's audience) sent to the configured OpenRouter model, calls `chat/completions` with the image as a data URL, extracts/repairs JSON from the model response (`extractJson`), then `normalize()`s it: clamps categories to the configured whitelist, backfills missing `unit_price`/`subtotal`/`total` by cross-deriving from other fields, coerces `taxable` to 0/1. `normalize()` is exported and unit-tested directly by `scripts/selfcheck.cjs` without hitting the network. Unchanged by the Next.js migration except for the `__dirname`→`require()`/`process.cwd()` fixes noted above.
- **`src/db.cjs`** — owns a `mysql2/promise` connection pool to the external MySQL database and schema (`users` 1—N `receipts` 1—N `items`, cascade delete via `ON DELETE CASCADE` at both levels). The pool is memoized on `globalThis.__vanspendPool` so `next dev`'s hot-reload doesn't leak a new pool (and exhaust MySQL connections) on every file save. On startup it tries to `CREATE TABLE IF NOT EXISTS` the schema, then runs upgrade-path migrations (`receipts.user_id`, `users.is_admin` — both checked via `information_schema.COLUMNS`, `ALTER TABLE`d in if missing), then `seedAdmin()` (creates the `ADMIN_USERNAME`/`ADMIN_PASSWORD` account once, if set and not already present — never overwrites an existing account) — all soft-fail (warn, don't crash) if the DB account lacks DDL privileges, in which case `sql/schema.sql` must be run manually first. All queries use named-placeholder prepared statements (`namedPlaceholders: true`) — no ORM. Money/qty columns are `DECIMAL` (returned as JS numbers via `decimalNumbers: true`); `purchased_at`/timestamps are returned as strings via `dateStrings: true`. Every exported function is `async`. Stats functions (`overview`, `statsByCategory`, `statsBySubcategory`, `statsMonthly`) share a `dateFilter(from, to, userId)` helper that builds a parameterized `WHERE` clause including `r.user_id = :userId` **only when `userId` is truthy** — regular per-user routes always pass their own `session.userId` (unchanged, still isolated); the admin routes are the only callers that omit it (global) or pass a different user's id (drill-down). `listReceipts`/`getReceipt`/`deleteReceipt` follow the same optional-`userId` pattern. `priceTrend`/`distinctItemNames` still require `userId` (not exposed in the admin console). Admin-only additions: `listUsers()` (users + aggregate receipt count/spend via `LEFT JOIN`), `deleteUser(id)`, `statsByUser(from, to)` (spend per user, `LEFT JOIN` so zero-receipt users still show up with 0). User-account helpers: `createUser` (never sets `is_admin` — self-registration can't grant it), `findUserByUsername`, `countUsers`, `backfillOwnerlessReceipts`, `seedAdmin`.
- **`sql/schema.sql`** — standalone MySQL DDL (`CREATE DATABASE` + `users`/`receipts`/`items` tables), kept in sync by hand with the DDL embedded in `src/db.cjs`.
- **`config/config.json`** — single source of truth for the model slug, tax rates, and the category whitelist. Changing `categories` here changes both the AI prompt (`src/openrouter.cjs`) and the frontend `<select>` options simultaneously. `model` can be overridden per-deployment via `OPENROUTER_MODEL` in `.env`. **`port` is no longer read** — Next.js reads the `PORT` env var natively instead (set it in `.env`/compose, default `3000`).
- **`app/page.js`** (client component) — checks `GET /api/auth/me` on load; renders `components/AuthGate.js` if unauthenticated, else the tab shell (scan / dashboard / list). All three tab components stay mounted at all times (visibility toggled via the `.hide` CSS class, not conditional unmounting) so switching tabs doesn't reset in-progress state (e.g. the scan tab's editable table) — this matches the original vanilla-JS app's DOM-toggling behavior. `components/Header.js` shows a "管理后台" link to `/admin` when `user.isAdmin`.
- **`app/admin/page.js`** (client component) — same auth-check shape as `app/page.js`, but checks `isAdmin` from `/api/auth/me` and shows a plain "no permission" card (not the login gate) if the logged-in user isn't an admin. Three tabs, same always-mounted/`.hide` pattern: `components/admin/StatsPanel.js` (KPIs + category/subcategory/monthly charts, all with an optional user-scope dropdown, plus a `stats/by-user` bar chart that doesn't exist in the regular dashboard), `components/admin/ReceiptsPanel.js` (structurally `ReceiptsTab` + an owner-username column + a user filter dropdown, hitting `/api/admin/receipts*`), `components/admin/UsersPanel.js` (user list + delete).
- **`components/ScanTab.js` / `DashboardTab.js` / `ReceiptsTab.js`** — direct structural ports of the three original `<section>`s. `DashboardTab` renders Chart.js via `react-chartjs-2` (`Doughnut`/`Bar`/`Line`) instead of imperative `new Chart(...)` calls; same series colors/options (already CVD/contrast-checked, see `dataviz` skill), same 4 charts (category doughnut, subcategory bar, monthly stacked bar, price-trend line).
- **`lib/api.js`** — client-side `api()` fetch wrapper (mirrors the old page-scoped `api()`); on a 401 response it calls a registered "unauthorized" callback (set by `app/page.js`) that bounces the UI back to the login gate, so an expired session anywhere in the app recovers gracefully instead of showing a raw error.
- **`lib/toast.js`** / **`components/Toast.js`** — small pub-sub replacing the old global `toast()` function + `#toast` div.
- **`lib/dateRange.js`** — the shared date-preset helpers (当月/上月/近3个月/近半年/近1年) used by both `DashboardTab` and `ReceiptsTab`.
- **`app/globals.css`** — the original `<style>` block ported verbatim (same CSS vars, dark theme, chart-series colors) — no visual redesign, no CSS framework.
- **`scripts/selfcheck.cjs`** — the offline correctness check described above.
- **`Dockerfile`** — multi-stage (`deps` → `builder` runs `next build` → `runner`), using Next's `output: 'standalone'` (`next.config.js`) so the final image only ships the traced dependency graph, not the whole `node_modules`. `config/` and `sql/` are copied explicitly into the runner stage since they're read via `fs`/`require` at runtime, not part of the traced JS import graph the standalone build follows for everything. Still Alpine, still a non-root user, still `EXPOSE 3000`.

### Data flow for a receipt

1. Frontend posts the image as a base64 data URL to `POST /api/scan` → `openrouterLib.scanReceipt()` → normalized `{receipt, items, raw}`, **not yet persisted**.
2. User reviews/edits the extracted line items in the editable table (`ScanTab`) — AI misreads are expected and must be caught here, there is no offline OCR fallback.
3. Frontend posts the (possibly edited) `{receipt, items, image}` to `POST /api/receipts` → image is base64-decoded to a file in `uploads/` (`saveImage()`, `src/uploads.cjs`), then `dbApi.saveReceipt()` inserts receipt + items in one transaction.
4. `DashboardTab` reads aggregates from the `/api/stats/*` endpoints, all of which accept optional `from`/`to` date-range query params.

### Domain-specific rules to preserve

- GST/PST splitting follows BC-specific tax rules (5%/7%); when a receipt only prints a combined tax line, the app estimates the 5/7 split rather than guessing — this logic lives in the AI prompt (`openrouter.cjs:buildPrompt`), not in code.
- `name_norm` (AI-normalized item name) is what powers cross-time price trend matching (`priceTrend`) — it's inherently fuzzy since it's model-generated, not a canonical SKU.

## Scope Boundaries

**Known trade-offs and risks**
- AI extraction is not 100% accurate; the manual review/edit step before save is a required control, not optional UX polish.
- Tax split (GST/PST) is estimated by ratio when a receipt only prints one combined tax total.
- Cross-time price comparison relies on fuzzy `name_norm` matching.
- Every scan costs an OpenRouter API call (billed, though cheap with the default Gemini 2.5 Flash model).
- Session cookie is signed/encrypted but stateless (`iron-session`) — no server-side way to force-invalidate one session before its cookie expires (no "log out all devices"), and `isAdmin` revocation has the same lag.
- `next build` meaningfully increases Docker image size/build time versus a zero-build static-file image.
- The admin console can view/delete any user's receipts and delete any user account (cascades their data) — real destructive cross-user power, no undo, no audit log of who did what.

**Strict constraints**
- Requires a reachable external MySQL server; `MYSQL_*` credentials live in `.env` (never commit real credentials).
- Multi-user by account, but still household-scale and localhost-only by design — not for public exposure; the MySQL server should also not be exposed beyond what's needed for this app to reach it. Session cookie is `secure: false` accordingly; don't flip that on without also adding TLS.
- Receipt images (`uploads/`) remain local disk files, not stored in MySQL. `/uploads` is served without per-user access control (filenames are timestamp+random, not sequential, but not cryptographically secret either) — acceptable under the localhost/trusted-household trust model.
- Registration is open/self-service — no admin approval, no invite codes. Exactly one elevated role (`is_admin` boolean, no finer-grained permissions), grantable only via the `ADMIN_USERNAME`/`ADMIN_PASSWORD` bootstrap — never through the registration API.
- Plain JS/JSX, no TypeScript, no ESLint config, no state-management library, no CSS framework.

**Explicitly not included**
- No editing receipts/line-items from the admin console (view + delete only — the regular user flow doesn't support post-save editing either).
- No audit log of admin actions, no "log in as" / impersonation flow.
- No in-app admin creation/promotion UI or self-service admin password change.
- No password reset, email verification, or brute-force lockout on login.
- No cloud backup/sync of `uploads/`.
- No budgets/alerts, no income tracking, no PDF/Excel export.
- No batch receipt import or bank/credit-card statement reconciliation.
- No offline OCR fallback.
- No server-side rendering/data-fetching optimizations — everything stays client-rendered (`"use client"`), same as the original SPA.
- No connection-pool tuning, retry/backoff, or migration framework beyond `schema.sql` + the app's own `CREATE TABLE IF NOT EXISTS` / `user_id` backfill.
