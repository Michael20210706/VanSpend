# AGENTS.md — VanSpend

Multi-user (per-account) receipt scanner & itemized bookkeeping for a Vancouver BC household (GST/PST split). Each user registers their own account (open self-registration, `iron-session` cookie auth); receipts/items are scoped to `user_id`. Structured data lives in an external MySQL database; receipt images stay on the local machine (`uploads/`). Next.js (App Router) full-stack app: Route Handlers for the API, React client components for the UI.

## Layout
- `app/` — Next.js App Router: `page.js`/`layout.js`/`globals.css`, `api/**/route.js` (one file per endpoint), `uploads/[...file]/route.js` (image serving)
- `components/` — React components: `Header`, `AuthGate`, `Toast`, `ScanTab`, `DashboardTab`, `ReceiptsTab`
- `lib/` — client-side helpers: `api.js` (fetch wrapper), `toast.js`, `dateRange.js`
- `src/` — framework-agnostic backend logic: `db.cjs`, `openrouter.cjs`, `uploads.cjs` (CommonJS, also used by `scripts/selfcheck.cjs` via plain `node`); `session.js`, `http.js` (ESM, Next-only)
- `config/config.json` — model slug, tax rates, category whitelist (**not** port — see Commands)
- `sql/schema.sql` — standalone MySQL DDL (kept in sync by hand with `src/db.cjs`'s embedded DDL)
- `scripts/selfcheck.cjs` — offline correctness check
- `jsconfig.json` — `@/*` path alias to the project root, used by `app/api/**` to avoid fragile relative-path counting
- `Dockerfile` / `docker-compose.yml` / `.dockerignore` — container build/release (multi-stage, Next `standalone` output)

## Module system
`package.json` has `"type": "module"`. `app/**`/`components/**`/`lib/**`/`src/session.js`/`src/http.js` are ESM. `src/db.cjs`/`src/openrouter.cjs`/`src/uploads.cjs`/`scripts/selfcheck.cjs` are explicit-extension CommonJS (kept `.cjs` so `scripts/selfcheck.cjs` stays plain-`node`-runnable outside Next). Route Handlers import the `.cjs` modules via **default import + property access** (`import dbApi from '@/src/db.cjs'; dbApi.saveReceipt(...)`), not named imports — CJS→ESM named-export interop isn't reliable under Turbopack for a plain `module.exports = {...}` object. Never do `__dirname`-relative `fs` reads in anything reachable from `app/**` — Turbopack virtualizes `__dirname` during `next build`'s page-data-collection step; use `process.cwd()` (see `src/uploads.cjs`) or a static `require('../config/config.json')` (see `src/openrouter.cjs`) instead.

## Architecture
- **`app/api/**/route.js`** — thin Route Handlers, each `wrap()`-ped (`src/http.js`) for uniform `{error}` 500s. Auth-gated ones start with `const { session, response } = await requireSession(); if (response) return response;` (`src/session.js`). Public: `/api/auth/register|login|logout|me`, `/api/config`.
- **`app/uploads/[...file]/route.js`** — replaces `express.static('/uploads')`; streams from `UPLOAD_DIR` (`src/uploads.cjs`) with manual path-traversal protection (resolves the joined path, 400s if it escapes `UPLOAD_DIR`). Not auth-gated (pre-existing trade-off, filenames are timestamp+random not sequential).
- **`src/session.js`** — `iron-session` config, `getSession()`, `requireSession()`. Session data (`userId`, `username`) lives in the signed/encrypted cookie only — no sessions table in MySQL.
- **`src/openrouter.cjs`** — Multimodal OCR. `scanReceipt(dataUrl)` posts a base64 image + prompt to OpenRouter (`config.model`, default `google/gemini-2.5-flash`; overridable via `OPENROUTER_MODEL` in `.env`). `buildPrompt()` injects `config.categories`. `extractJson()` strips ``` fences and slices first `{`→last `}`. `normalize()` is the single source of truth for field defaults, category validation (falls back to `其他`), and derived values (unit_price = amount/qty, subtotal = Σitems, total = subtotal+gst+pst).
- **`src/db.cjs`** — `mysql2/promise` connection pool (memoized on `globalThis.__vanspendPool` so `next dev` hot-reload doesn't leak pools), named-placeholder prepared statements, no ORM. Three tables: `users`, `receipts` (FK `user_id ON DELETE CASCADE`, nullable to support the upgrade-path migration), `items` (FK `receipt_id ON DELETE CASCADE`). Tries `CREATE TABLE IF NOT EXISTS` on startup, then adds `receipts.user_id` via `ALTER TABLE` if missing — both warn (don't crash) if the DB account lacks DDL privileges. `saveReceipt` wraps inserts in a transaction. Stats functions (`statsByCategory`, `statsBySubcategory`, `statsMonthly`, `overview`) build WHERE clauses via the shared `dateFilter(from, to, userId)` (always includes `r.user_id = :userId`); `priceTrend`/`distinctItemNames` filter by `userId` directly. User helpers: `createUser`, `findUserByUsername`, `countUsers`, `backfillOwnerlessReceipts`.
- **`app/page.js`** — client component; checks `GET /api/auth/me`, renders `AuthGate` or the tab shell. All three tabs stay mounted (CSS `.hide`, not unmount) so switching tabs preserves in-progress state.
- **`components/DashboardTab.js`** — 4 charts via `react-chartjs-2` (`Doughnut`/`Bar`/`Line`), same series colors/logic as before, just React-idiomatic instead of imperative `new Chart(...)`.
- **`lib/api.js`** — client `api()` fetch wrapper; 401 triggers a registered callback that bounces the UI back to the login gate.

## Data flow
Register/login → `POST /api/auth/register` or `/login` (session cookie set) → upload image → `POST /api/scan` (returns `{receipt, items, raw}`, **not persisted**) → user edits in editable table (`ScanTab`) → `POST /api/receipts` (persists with `user_id`, saves image to `uploads/`). The human review step before save is mandatory; never auto-persist scan output.

## Conventions & patterns
- Plain JS/JSX, no TypeScript, no bundler config beyond what Next.js needs, no ESLint, no state-management library.
- **Config-driven behavior**: `config/config.json` (`model`, `taxRates`, `categories`) drives both the prompt and the frontend dropdowns. Add a category there and it propagates automatically. `port` is NOT read from here anymore — Next.js reads `PORT` from the environment natively.
- **Money**: `DECIMAL` columns in MySQL, returned as plain JS numbers (`decimalNumbers: true`); `currency` defaults to `CAD`. Tax split is BC GST 5% / PST 7%.
- **`name_norm`** (normalized item name) is what enables cross-time price trends (`priceTrend` matches via `LIKE '%name%'`); inconsistent norms break trend charts.
- **API error shape**: always `{ error: string }` with appropriate HTTP status (400 bad input, 401 unauthenticated, 500 thrown errors).
- **Per-user data isolation**: every `dbApi` call touching receipts/items takes a `userId` and filters/sets by it — never add a query that reads across users.

## Commands
- `npm install` — `next` + `react` + `react-dom` + `react-chartjs-2` + `chart.js` + `iron-session` + `mysql2` + `bcryptjs`.
- `npm run dev` / `npm run build` / `npm start` — Next.js dev/build/prod. Port comes from `PORT` env var (default expected `5173` in `.env`), not `config.json`.
- `npm run selfcheck` — **offline** test of `normalize()` + per-user-scoped DB stats (no OpenRouter API call, but does write/delete a `__test_selfcheck__` user + rows in the real MySQL database). Runs via plain `node`, outside Next.
- `docker compose up -d` — multi-stage build (`next build` → `output: 'standalone'` runtime image) + a bundled MySQL for local trial.

## Scope boundaries (do not add)
No roles/permissions, no shared/family visibility across accounts, no password reset/email verification, no login rate-limiting, no cloud sync, no budget/income/export features, no batch import, no offline OCR fallback, no SSR/server-data-fetching optimizations (stays client-rendered), no migration framework beyond `sql/schema.sql` + the app's own DDL/backfill. Open self-registration, session-cookie auth, localhost-only by design.
