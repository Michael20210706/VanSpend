# AGENTS.md — VanSpend

Multi-user (per-account) receipt scanner & itemized bookkeeping for a Vancouver BC household (GST/PST split). Each user registers their own account (open self-registration, session-cookie auth); receipts/items are scoped to `user_id`. Structured data lives in an external MySQL database; receipt images stay on the local machine (`uploads/`).

## Layout
- `src/` — backend logic (`server.js`, `db.js`, `openrouter.js`)
- `config/config.json` — model slug, port, tax rates, category whitelist
- `sql/schema.sql` — standalone MySQL DDL (kept in sync by hand with `src/db.js`'s embedded DDL)
- `scripts/selfcheck.js` — offline correctness check
- `public/index.html` — the entire frontend
- `Dockerfile` / `docker-compose.yml` / `.dockerignore` — container build/release

## Architecture
- **`src/server.js`** — Express app. Serves `public/` statically and exposes a JSON API. Loads `.env` manually (no dotenv dep) via a regex parser at the top. Wraps handlers in `wrap()` to catch async errors → `500 {error}`. `express-session` (store: `express-mysql-session` backed by the same MySQL DB) sits in front of everything; `/api/auth/register|login|logout|me` are public, `/api/scan`, `/api/receipts`, `/api/stats`, `/api/items` require `requireAuth` (401 without `req.session.userId`) and are scoped to it.
- **`src/openrouter.js`** — Multimodal OCR. `scanReceipt(dataUrl)` posts a base64 image + prompt to OpenRouter (`config.model`, default `google/gemini-2.5-flash`; overridable via `OPENROUTER_MODEL` in `.env` without touching `config.json`). `buildPrompt()` injects `config.categories` so the model's output matches the DB/frontend. `extractJson()` strips ``` fences and slices first `{`→last `}`. `normalize()` is the single source of truth for field defaults, category validation (falls back to `其他`), and derived values (unit_price = amount/qty, subtotal = Σitems, total = subtotal+gst+pst).
- **`src/db.js`** — `mysql2/promise` connection pool to an external MySQL database (no ORM, named-placeholder prepared statements). Every exported function is `async`. Three tables: `users`, `receipts` (FK `user_id ON DELETE CASCADE`, nullable to support the upgrade-path migration), `items` (FK `receipt_id ON DELETE CASCADE`). Tries `CREATE TABLE IF NOT EXISTS` on startup, then adds `receipts.user_id` via `ALTER TABLE` if missing (pre-multi-user DBs) — both warn (don't crash) if the DB account lacks DDL privileges. `saveReceipt` wraps inserts in a transaction (`beginTransaction`/`commit`/`rollback`). Stats functions (`statsByCategory`, `statsBySubcategory`, `statsMonthly`, `overview`) all take `from`/`to`/`userId` and build WHERE clauses via the shared `dateFilter()` (always includes `r.user_id = :userId`); `priceTrend`/`distinctItemNames` filter by `userId` directly. User helpers: `createUser`, `findUserByUsername`, `countUsers`, `backfillOwnerlessReceipts`.
- **`public/index.html`** — Single-file vanilla-JS SPA (no build step, Chart.js via CDN). Checks `GET /api/auth/me` on load; shows a login/register card (`#authWrap`) if unauthenticated, else the app (`#appWrap`). Talks to the API with a tiny `api()` fetch wrapper that redirects to the auth card on any 401. Three tabs: scan / dashboard / list.

## Data flow
Register/login → `POST /api/auth/register` or `/login` (session cookie set) → upload image → `POST /api/scan` (returns `{receipt, items, raw}`, **not persisted**) → user edits in editable table → `POST /api/receipts` (persists with `user_id`, saves image to `uploads/`). The human review step before save is mandatory; never auto-persist scan output.

## Conventions & patterns
- **CommonJS** (`"type": "commonjs"`), `'use strict'` at top of every file. No TypeScript, no bundler.
- **Config-driven behavior**: `config/config.json` (`model`, `port`, `taxRates`, `categories`) drives both the prompt and the frontend dropdowns. Add a category there and it propagates automatically — don't hardcode category lists elsewhere.
- **Money**: `DECIMAL` columns in MySQL, returned as plain JS numbers (`decimalNumbers: true`); `currency` defaults to `CAD`. Tax split is BC GST 5% / PST 7%.
- **`name_norm`** (normalized item name) is what enables cross-time price trends (`priceTrend` matches via `LIKE '%name%'`); inconsistent norms break trend charts.
- **API error shape**: always `{ error: string }` with appropriate HTTP status (400 for bad input, 401 for unauthenticated, 500 for thrown errors).
- **Per-user data isolation**: every `dbApi` call touching receipts/items takes a `userId` and filters/sets by it — never add a query that reads across users.

## Commands
- `npm install` — `express` + `mysql2` + `express-session` + `express-mysql-session` + `bcryptjs`.
- `npm start` — runs `node --no-warnings src/server.js` on `config.port` (default 5173). Needs `OPENROUTER_API_KEY`, `MYSQL_*`, and `SESSION_SECRET` vars in `.env` (copy from `.env.example`).
- `npm run selfcheck` — **offline** test of `normalize()` + DB stats (no OpenRouter API call, but does write/delete a `__test_selfcheck__` test user + its rows in the real MySQL database). Run this to validate parsing/stats changes.
- `docker compose up -d` — app + a bundled MySQL for local trial (see `docker-compose.yml` comments for pointing at an external MySQL instead).

## Scope boundaries (do not add)
No roles/permissions, no shared/family visibility across accounts, no password reset/email verification, no login rate-limiting, no cloud sync, no budget/income/export features, no batch import, no offline OCR fallback, no migration framework beyond `sql/schema.sql` + the app's own DDL/backfill. Open self-registration, session-cookie auth, localhost-only by design.
