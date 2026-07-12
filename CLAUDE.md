# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VanSpend is a local, single-user receipt-scanning and expense-tracking app for a household in BC, Canada (Vancouver). It uploads receipt photos (Costco, T&T, etc.), sends them to a multimodal LLM via OpenRouter to extract structured line-items, stores them in local SQLite, and charts spending/tax breakdowns (GST 5% / PST 7%) in a browser dashboard. Everything stays on-disk (`data/vanspend.sqlite`, `uploads/`) — no cloud sync, no auth, no multi-user support.

## Commands

```bash
npm install       # only dependency is express
cp .env.example .env   # then fill in OPENROUTER_API_KEY
npm start          # node --no-warnings server.js, serves http://localhost:5173
npm run selfcheck  # node selfcheck.js — offline checks of normalize()/db logic, no API calls, no test framework
```

There is no build step, bundler, linter, or test framework — this is plain CommonJS Node with a static HTML/JS frontend. `selfcheck.js` is the only correctness check in the repo; run it after touching `openrouter.js` (parsing/normalization) or `db.js` (stats queries). It writes/cleans up test rows (`store='__TEST_COSTCO'`) in the real `data/vanspend.sqlite`, so it is not fully side-effect-free.

Requires Node >= 22.5 (uses the built-in, still-experimental `node:sqlite` — no native module compilation).

## Architecture

Four backend files, one static frontend page, no framework:

- **`server.js`** — Express app, all routes. Loads `.env` itself (no dotenv dependency, hand-rolled parser). Serves `public/` statically and `uploads/` for receipt images. Every async route is wrapped in `wrap()` for uniform error → `{error}` JSON responses. Scanning (`POST /api/scan`) and persisting (`POST /api/receipts`) are separate steps — the API never auto-saves an AI read.
- **`openrouter.js`** — builds the vision prompt (in Chinese, matching the product's audience) sent to the configured OpenRouter model, calls `chat/completions` with the image as a data URL, extracts/repairs JSON from the model response (`extractJson`), then `normalize()`s it: clamps categories to the configured whitelist, backfills missing `unit_price`/`subtotal`/`total` by cross-deriving from other fields, coerces `taxable` to 0/1. `normalize()` is exported and unit-tested directly by `selfcheck.js` without hitting the network.
- **`db.js`** — owns the `node:sqlite` `DatabaseSync` connection and schema (`receipts` 1—N `items`, cascade delete). WAL mode is attempted and silently falls back if the file lives on a network/cloud-sync drive (README explicitly warns against multi-device concurrent writes to such a file). All queries are plain prepared statements — no ORM. Stats functions (`overview`, `statsByCategory`, `statsBySubcategory`, `statsMonthly`, `priceTrend`, `distinctItemNames`) share a `dateFilter(from, to)` helper that builds a parameterized `WHERE` clause; `priceTrend` matches by `name_norm`/`name_raw` `LIKE` since item names are AI-generated free text, not a fixed catalog.
- **`config.json`** — single source of truth for the model slug, port, tax rates, and the category whitelist. Changing `categories` here changes both the AI prompt (`openrouter.js`) and the frontend `<select>` options simultaneously — the two are not independently configurable. To swap the vision model, only change `model` here.
- **`public/index.html`** — the entire frontend: vanilla JS, no build tooling, Chart.js pulled from a CDN `<script>` tag. Three tabs (scan/upload → confirm-and-save table → dashboard with charts → receipt list), all in one file. State lives in page-scoped JS variables, not a framework store.

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
- Requires Node >= 22.5 for built-in `node:sqlite` (still experimental upstream).
- Single-machine, single-user, no auth — intended to bind to localhost only, not for public exposure.
- The SQLite file should not live on a cloud-sync drive (iCloud/Dropbox) accessed from multiple devices simultaneously — WAL mode auto-falls-back there and concurrent writers can corrupt the file.

**Explicitly not included**
- No user accounts, multi-user collaboration, or cloud backup/sync.
- No budgets/alerts, no income tracking, no PDF/Excel export.
- No batch receipt import or bank/credit-card statement reconciliation.
- No offline OCR fallback — recognition requires network + a valid API key (querying already-saved data does not).
