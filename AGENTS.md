# AGENTS.md — VanSpend

Local single-user receipt scanner & itemized bookkeeping for Vancouver BC (GST/PST split). All data stays on the user's machine (`data/vanspend.sqlite` + `uploads/`).

## Architecture
- **`server.js`** — Express app. Serves `public/` statically and exposes a JSON API. Loads `.env` manually (no dotenv dep) via a regex parser at the top. Wraps handlers in `wrap()` to catch async errors → `500 {error}`.
- **`openrouter.js`** — Multimodal OCR. `scanReceipt(dataUrl)` posts a base64 image + prompt to OpenRouter (`config.model`, default `google/gemini-2.5-flash`). `buildPrompt()` injects `config.categories` so the model's output matches the DB/frontend. `extractJson()` strips ``` fences and slices first `{`→last `}`. `normalize()` is the single source of truth for field defaults, category validation (falls back to `其他`), and derived values (unit_price = amount/qty, subtotal = Σitems, total = subtotal+gst+pst).
- **`db.js`** — Uses Node's built-in `node:sqlite` (`DatabaseSync`, requires Node ≥ 22.5). Two tables: `receipts` (one per receipt) and `items` (one per line item, FK `receipt_id ON DELETE CASCADE`). WAL mode is set in a `try/catch` that silently falls back on network drives. `saveReceipt` wraps inserts in `BEGIN/COMMIT/ROLLBACK`. Stats functions (`statsByCategory`, `statsBySubcategory`, `statsMonthly`, `priceTrend`, `overview`) all take `from`/`to` date strings and build WHERE clauses via the shared `dateFilter()`.
- **`public/index.html`** — Single-file vanilla-JS SPA (no build step, Chart.js via CDN). Talks to the API with a tiny `api()` fetch wrapper. Three tabs: scan / dashboard / list.

## Data flow
Upload image → `POST /api/scan` (returns `{receipt, items, raw}`, **not persisted**) → user edits in editable table → `POST /api/receipts` (persists + saves image to `uploads/`). The human review step before save is mandatory; never auto-persist scan output.

## Conventions & patterns
- **CommonJS** (`"type": "commonjs"`), `'use strict'` at top of every file. No TypeScript, no bundler.
- **Config-driven behavior**: `config.json` (`model`, `port`, `taxRates`, `categories`) drives both the prompt and the frontend dropdowns. Add a category there and it propagates automatically — don't hardcode category lists elsewhere.
- **Money**: numbers only, no currency symbols in the DB; `currency` defaults to `CAD`. Tax split is BC GST 5% / PST 7%.
- **`name_norm`** (normalized item name) is what enables cross-time price trends (`priceTrend` matches via `LIKE '%name%'`); inconsistent norms break trend charts.
- **API error shape**: always `{ error: string }` with appropriate HTTP status (400 for bad input, 500 for thrown errors).

## Commands
- `npm install` — only `express` is a dependency; installs fast.
- `npm start` — runs `node --no-warnings server.js` on `config.port` (default 5173). Needs `OPENROUTER_API_KEY` in `.env` (copy from `.env.example`) for scanning; queries work without it.
- `npm run selfcheck` — **offline** test of `normalize()` + DB stats (no API call). Writes then deletes `__TEST_COSTCO` rows in `data/vanspend.sqlite`. Run this to validate parsing/stats changes.

## Scope boundaries (do not add)
No auth, no multi-user, no cloud sync, no budget/income/export features, no batch import, no offline OCR fallback. Single-user, localhost-only by design.

