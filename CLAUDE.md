# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VanSpend is a multi-user receipt-scanning and expense-tracking app for a household in BC, Canada (Vancouver) — each household member registers their own account, and the receipts/items they upload are scoped to that account. It uploads receipt photos (Costco, T&T, etc.), sends them to a multimodal LLM via OpenRouter to extract structured line-items, stores them in an external MySQL database, and charts spending/tax breakdowns (GST 5% / PST 7%) in a browser dashboard. Receipt images stay on-disk (`uploads/`); structured data lives in MySQL. Auth is session-cookie based with open self-registration — no roles, no shared/family visibility across accounts.

## Commands

```bash
npm install       # express + mysql2 + express-session + express-mysql-session + bcryptjs
cp .env.example .env   # then fill in OPENROUTER_API_KEY, MYSQL_* connection vars, and SESSION_SECRET
npm start          # node --no-warnings src/server.js, serves http://localhost:5173
npm run selfcheck  # node scripts/selfcheck.js — offline checks of normalize()/db logic, no API calls, no test framework

# or via Docker:
docker compose up -d   # app + a bundled MySQL for local trial (see docker-compose.yml comments
                        # for pointing at an external MySQL instead)
```

There is no build step, bundler, linter, or test framework — this is plain CommonJS Node with a static HTML/JS frontend. `scripts/selfcheck.js` is the only correctness check in the repo; run it after touching `src/openrouter.js` (parsing/normalization) or `src/db.js` (stats queries). It writes/cleans up a test user (`username='__test_selfcheck__'`, cascades to its receipts/items) in the real MySQL database pointed to by `.env`, so it is not fully side-effect-free.

Requires a reachable MySQL server (connection configured via `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE` in `.env`) and the `MYSQL_DATABASE` schema must exist beforehand (`sql/schema.sql`, or let the app auto-create tables on startup if the account has DDL privileges).

## Architecture

Backend code lives under `src/`, grouped by function; one static frontend page; no framework:

- **`src/server.js`** — Express app, all routes. Loads `.env` itself (no dotenv dependency, hand-rolled parser). Serves `public/` statically and `uploads/` for receipt images. Every async route is wrapped in `wrap()` for uniform error → `{error}` JSON responses. Scanning (`POST /api/scan`) and persisting (`POST /api/receipts`) are separate steps — the API never auto-saves an AI read. Session middleware (`express-session` + `express-mysql-session`, store backed by the same MySQL DB via `dbApi.pool`) sits in front of everything; `POST /api/auth/register|login|logout` and `GET /api/auth/me` are public, everything else under `/api/scan`, `/api/receipts`, `/api/stats`, `/api/items` is gated by the `requireAuth` middleware (401 if no `req.session.userId`) and scoped to `req.session.userId`.
- **`src/openrouter.js`** — builds the vision prompt (in Chinese, matching the product's audience) sent to the configured OpenRouter model, calls `chat/completions` with the image as a data URL, extracts/repairs JSON from the model response (`extractJson`), then `normalize()`s it: clamps categories to the configured whitelist, backfills missing `unit_price`/`subtotal`/`total` by cross-deriving from other fields, coerces `taxable` to 0/1. `normalize()` is exported and unit-tested directly by `scripts/selfcheck.js` without hitting the network.
- **`src/db.js`** — owns a `mysql2/promise` connection pool to the external MySQL database and schema (`users` 1—N `receipts` 1—N `items`, cascade delete via `ON DELETE CASCADE` at both levels). On startup it tries to `CREATE TABLE IF NOT EXISTS` the schema, then checks `information_schema.COLUMNS` for `receipts.user_id` and `ALTER TABLE`s it in if missing (upgrade path for DBs provisioned before multi-user support) — both steps silently warn (don't crash) if the DB account lacks DDL privileges, in which case `sql/schema.sql` must be run manually first. All queries use named-placeholder prepared statements (`namedPlaceholders: true`) — no ORM. Money/qty columns are `DECIMAL` (returned as JS numbers via `decimalNumbers: true`); `purchased_at`/timestamps are returned as strings via `dateStrings: true` to keep parity with the frontend's string-based date handling. Every exported function is `async` — callers must `await`. Stats functions (`overview`, `statsByCategory`, `statsBySubcategory`, `statsMonthly`) share a `dateFilter(from, to, userId)` helper that builds a parameterized `WHERE` clause always including `r.user_id = :userId`; `priceTrend`/`distinctItemNames` filter by `user_id` directly. `priceTrend` matches by `name_norm`/`name_raw` `LIKE` since item names are AI-generated free text, not a fixed catalog. User-account helpers: `createUser`, `findUserByUsername`, `countUsers`, `backfillOwnerlessReceipts` (one-time migration: assigns pre-existing ownerless receipts to whichever account registers first).
- **`sql/schema.sql`** — standalone MySQL DDL (`CREATE DATABASE` + `users`/`receipts`/`items` tables), kept in sync by hand with the DDL embedded in `src/db.js`. Use it to provision the database manually when the app's DB account shouldn't have `CREATE TABLE` privileges (also mounted into the bundled `mysql` service's init directory in `docker-compose.yml`).
- **`config/config.json`** — single source of truth for the model slug, port, tax rates, and the category whitelist. Changing `categories` here changes both the AI prompt (`src/openrouter.js`) and the frontend `<select>` options simultaneously — the two are not independently configurable. `model` can be overridden per-deployment via `OPENROUTER_MODEL` in `.env` (checked in `src/openrouter.js`, takes priority over `config.json` if set) — useful for swapping models without touching the config file.
- **`public/index.html`** — the entire frontend: vanilla JS, no build tooling, Chart.js pulled from a CDN `<script>` tag. On load, calls `GET /api/auth/me`; shows a login/register card if unauthenticated, otherwise the app. Three tabs (scan/upload → confirm-and-save table → dashboard with charts → receipt list), all in one file. State lives in page-scoped JS variables, not a framework store.
- **`scripts/selfcheck.js`** — the offline correctness check described above.
- **`Dockerfile` / `docker-compose.yml` / `.dockerignore`** — single-stage Alpine image (no native deps to compile, `npm ci --omit=dev`), runs as a non-root user, `EXPOSE 5173`. Compose adds an optional bundled MySQL service for local trial/demo; for a real external MySQL, drop that service and point `MYSQL_HOST`/`MYSQL_PORT` in `.env` at it instead.

### Data flow for a receipt

1. Frontend posts the image as a base64 data URL to `POST /api/scan` → `openrouter.scanReceipt()` → normalized `{receipt, items, raw}`, **not yet persisted**.
2. User reviews/edits the extracted line items in an editable table on the page (AI misreads are expected and must be caught here — there is no offline OCR fallback).
3. Frontend posts the (possibly edited) `{receipt, items, image}` to `POST /api/receipts` → image is base64-decoded to a file in `uploads/`, then `db.saveReceipt()` inserts receipt + items in one transaction.
4. Dashboard tab reads aggregates from the `/api/stats/*` endpoints, all of which accept optional `from`/`to` date-range query params.

### Domain-specific rules to preserve

- GST/PST splitting follows BC-specific tax rules (5%/7%); when a receipt only prints a combined tax line, the app estimates the 5/7 split rather than guessing — this logic lives in the AI prompt (`openrouter.js:buildPrompt`), not in code, so changes to tax handling usually mean changing the prompt text.
- `name_norm` (AI-normalized item name) is what powers cross-time price trend matching (`priceTrend`) — it's inherently fuzzy since it's model-generated, not a canonical SKU.

## Scope Boundaries

**Known trade-offs and risks**
- AI extraction is not 100% accurate (blurry receipts, handwritten price tags, unusual item names); the manual review/edit step before save is a required control, not optional UX polish.
- Tax split (GST/PST) is estimated by ratio when a receipt only prints one combined tax total.
- Cross-time price comparison relies on fuzzy `name_norm` matching and can silently miss matches if the model normalizes the same product differently across receipts.
- Every scan costs an OpenRouter API call (billed, though cheap with the default Gemini 2.5 Flash model).

**Strict constraints**
- Requires a reachable external MySQL server; `MYSQL_*` credentials live in `.env` (never commit real credentials).
- Multi-user by account, but still household-scale and localhost-only by design — the app itself is still intended to bind to localhost only, not for public exposure; the MySQL server should also not be exposed beyond what's needed for this app to reach it. Session cookie is `secure: false` accordingly; don't flip that on without also adding TLS.
- Receipt images (`uploads/`) remain local disk files, not stored in MySQL — only their filename is stored in `receipts.image_file`. `/uploads` is served without per-user access control (filenames are timestamp+random, not sequential, but not cryptographically secret either) — acceptable under the localhost/trusted-household trust model.
- Registration is open/self-service — no admin approval, no invite codes, no roles/permissions. Every account is equal and only sees its own data; there is no shared/family visibility mode.

**Explicitly not included**
- No password reset, email verification, or brute-force lockout on login.
- No cloud backup/sync of `uploads/`.
- No budgets/alerts, no income tracking, no PDF/Excel export.
- No batch receipt import or bank/credit-card statement reconciliation.
- No offline OCR fallback — recognition requires network + a valid API key (querying already-saved data does not).
- No connection-pool tuning, retry/backoff, or migration framework beyond `schema.sql` + the app's own `CREATE TABLE IF NOT EXISTS` / `user_id` backfill.
