# Developer Guide

This document is for engineers changing or operating the app. It describes the current architecture, data model, operational flows, and common failure modes.

## Architecture Overview

The app is a Next.js 16 App Router application for curated AI PC builds, component catalog pages, Estonian market pricing, checkout, auth, and admin audit tooling.

Core layers:

- `src/app` contains route segments, server-rendered pages, and API routes.
- `src/components` contains client and shared UI components.
- `src/lib/db` owns persistence, migrations, seed data, auth/order/catalog queries, and the SQLite/PostgreSQL adapter.
- `src/lib/server` contains server-only orchestration:
  - `catalog-service.ts` maps DB records into page-ready view models and resolves market vs fallback pricing.
  - `estonian-pricing-service.ts` scrapes Estonian retailer search pages and writes market pricing.
  - `checkout-availability.ts` centralizes direct checkout eligibility and Stripe env mode checks.
  - `ops-diagnostics.ts` builds public health and admin diagnostics summaries without PII.
  - `compatibility-checker.ts` validates profile and Mac eGPU build feasibility.
  - `auth-helpers.ts` wraps cookie session lookup.
- `tests/high-value.test.ts` covers DB pricing behavior, compatibility regressions, route failure cases, and render edge cases.

The app intentionally avoids an ORM. SQL is kept in `src/lib/db/index.ts` and migrations are explicit in `src/lib/db/migrations.ts`.

## Setup Instructions

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Open `http://localhost:3000`.

The local SQLite database is created automatically at `data/catalog.db`. Migrations and seeds run on first DB access. To force a clean local re-seed, stop the dev server and remove `data/catalog.db`.

Useful scripts:

```bash
npm test                 # Node test runner via tsx
npm run lint             # ESLint for src and tests
npm run build            # Production build
npm run pricing:refresh  # Run pricing refresh without starting Next dev server
```

Tests use `LLMLAB_DATA_DIR` to create an isolated temporary SQLite database, so they should not mutate `data/catalog.db`.

## Environment Variables

| Variable | Required | Purpose |
|---|---:|---|
| `ADMIN_EMAIL` | prod | Email allowed to become/administer the first admin account. Required in production. |
| `ADMIN_SETUP_CODE` | first admin signup | One-time admin registration code. |
| `ADMIN_API_TOKEN` | ops optional | Bearer token for operational admin endpoints such as `/api/db/audit`; keep separate from `CRON_SECRET`. |
| `DATABASE_URL` / `POSTGRES_URL` | prod | PostgreSQL connection string. Hosted deployments fail closed without this unless `ALLOW_EPHEMERAL_SQLITE=true` is explicitly set. |
| `ALLOW_EPHEMERAL_SQLITE` | preview escape hatch | Allows hosted SQLite fallback only when explicitly set to `true`; do not use for production commerce. |
| `LLMLAB_DATA_DIR` | tests/local override | Directory for SQLite `catalog.db`. Used by tests. |
| `STRIPE_SECRET_KEY` | payments | Stripe API key for checkout session creation. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_PUBLISHABLE_KEY` | payments | Stripe publishable key used for live/test mode consistency checks. |
| `STRIPE_WEBHOOK_SECRET` | payments | Stripe webhook signature verification secret. |
| `NEXT_PUBLIC_APP_URL` | payments | Canonical app origin for checkout success/cancel URLs and origin checks. |
| `SMTP_HOST` | email | SMTP host for paid order emails. |
| `SMTP_PORT` | email | SMTP port. `465` implies secure mode. |
| `SMTP_SECURE` | email | Set `"true"` to force secure SMTP. |
| `SMTP_USER` | email | SMTP username. |
| `SMTP_PASS` | email | SMTP password. |
| `SMTP_FROM_EMAIL` | email | Sender address for order confirmation emails. |
| `CRON_SECRET` | cron | Bearer token for `/api/cron/estonian-pricing`. Vercel sends it automatically when configured. |
| `ESTONIAN_PRICE_MAX_ITEMS` | optional | Max products per pricing run. Defaults: `36` on Vercel, `120` local. |
| `ESTONIAN_PRICE_CONCURRENCY` | optional | Concurrent retailer fetches. Defaults: `4` on Vercel, `6` local. |
| `DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS` / `CHECKOUT_PRICE_MAX_AGE_HOURS` | optional | Direct checkout pricing freshness limit. Default `24`; capped at `48`. |
| `TRUSTED_PRICE_MAX_AGE_HOURS` | optional | Max age for trusted market rows. Default `168`. |
| `TRUSTED_PRICE_MIN_SAMPLES` | optional | Minimum sample count for trusted market rows. Default `1`. |
| `NEXT_PUBLIC_QUOTE_EMAIL` | optional | Legacy mailto target; persisted quote requests notify `ADMIN_EMAIL` when SMTP is configured. |

Use `.env.local` for local secrets and keep it untracked. `.env.example` is the only env file intended for git.

## Database Schema Overview

Migrations live in `src/lib/db/migrations.ts`. Seeds live in `src/lib/db/seed.ts`. `SEED_VERSION` in `src/lib/db/index.ts` controls when seed upserts re-run.

Major table groups:

- Catalog tables:
  - `gpus`
  - `cpus`
  - `ram_kits`
  - `power_supplies`
  - `pc_cases`
  - `motherboards`
  - `compact_ai_systems`
  - `storage_drives`
  - `cpu_coolers`
  - `mac_systems`
  - `external_gpu_enclosures`
- Build tables:
  - `profile_builds` stores curated purchasable PC builds and component foreign keys.
  - `mac_egpu_builds` stores quote-only Mac/eGPU combinations.
- Pricing tables:
  - `estonian_price_checks` stores latest trusted/diagnostic market checks per category item.
  - `price_history` stores pre-markup daily market-average rows and dedupes by category, item, and UTC recorded date.
  - `pricing_runs` and `pricing_run_failures` store durable cron run observability, including expected/checked item counts, inserted/updated history rows, stale counts, latest errors, and Vercel deployment metadata.
- Commerce tables:
  - `orders`
  - `order_price_snapshots`
  - `quote_requests`
  - Stripe webhook tracking tables.
- Auth tables:
  - `users`
  - `sessions`
- Metadata:
  - `schema_migrations`
  - `seed_runs`

Catalog rows include immutable metadata used by compatibility checks and detail pages. Examples: GPU dimensions, slot width, power connector, recommended PSU, CPU socket, RAM module count, motherboard memory slots, case GPU clearance, and eGPU enclosure size/PSU constraints.

## Important Data Flows

### App Startup

1. A route or service calls `initDb()`.
2. `getAdapter()` chooses PostgreSQL when `DATABASE_URL` or `POSTGRES_URL` exists. Local development falls back to SQLite; hosted deployments fail closed without Postgres unless `ALLOW_EPHEMERAL_SQLITE=true` is set intentionally.
3. `runMigrations()` applies missing schema versions.
4. `seedCatalog()` and profile build seeds run when `seed_runs.seed_version` is behind `SEED_VERSION`.

### Catalog Rendering

1. Pages call `getHomeCatalogView()`, `getProfileView()`, `getBuildDetailView()`, or `getCatalogItemDetailView()`.
2. `catalog-service.ts` loads DB rows.
3. It overlays trusted market pricing from `estonian_price_checks`.
4. If no trusted market row exists, it falls back to seed/base price plus the shared assembly markup.
5. Component detail pages load `price_history` for charts.

### Pricing Refresh

1. Vercel invokes `GET /api/cron/estonian-pricing` daily from `vercel.json` on `0 3 * * *` (03:00 UTC, Production deployments only).
2. The route requires `Authorization: Bearer $CRON_SECRET`.
3. `refreshEstonianMarketPricing()` selects stale/missing items across catalog categories.
4. Retailer pages are fetched with timeouts and product-token matching.
5. Extracted prices are filtered by product match, market/base ratio, and sample count.
6. Valid checks are written to `estonian_price_checks`.
7. A daily pre-markup market-average row is upserted into `price_history`.
8. Missing yesterday/today daily rows are backfilled from the latest trusted real market snapshot.
9. Run status is written to `pricing_runs` and failures to `pricing_run_failures`.

### Checkout

1. Client calls `POST /api/payments/checkout`.
2. Route requires an authenticated user.
3. Quote-only item types are rejected.
4. Checkout availability must pass server-side checks: valid Stripe env mode, direct-purchase item type, inventory where present, fresh non-fallback trusted pricing, and final customer price including markup.
5. Origin must match `NEXT_PUBLIC_APP_URL` or `VERCEL_URL`.
6. Existing open Stripe sessions are reused when possible.
7. Otherwise an order is created, Stripe checkout session is created, and session ID is stored on the order.
8. Stripe webhook validates raw-body signature, mode, amount, currency, metadata, and payment status before marking paid.
9. Paid-order customer/admin notifications can be retried safely when either sent timestamp is missing.

### Quote Requests

Quote-only products persist quote requests and notify `ADMIN_EMAIL` when SMTP is configured. Admin operations expose a small lifecycle, not a CRM:

- Statuses: `NEW`, `CONTACTED`, `WAITING_CUSTOMER`, `QUOTED`, `CLOSED`, `SPAM`
- Operator notes are internal-only, length-limited, and not emailed to customers
- Admin lists show masked contact by default
- Full name/email reveal requires an authenticated admin browser session and same-origin request
- Diagnostics count quote statuses but do not expose contact details or quote messages

### Compatibility

Profile builds and Mac eGPU builds are validated by `src/lib/server/compatibility-checker.ts`.

Profile checks include:

- CPU socket vs motherboard socket.
- CPU/motherboard memory support vs RAM type.
- RAM module count vs motherboard slots.
- RAM capacity vs motherboard max.
- GPU length vs case clearance.
- GPU recommended PSU and power connector support.
- Cooler socket and case clearance/radiator support.
- Motherboard form factor vs case.
- NVMe storage vs M.2 availability.

Mac eGPU checks include:

- GPU length vs enclosure max length.
- GPU slot width vs enclosure slot support.
- Enclosure PSU vs GPU recommended PSU.

The admin audit route also reports compatibility issues.

## Deployment Notes

Recommended production target is Vercel with PostgreSQL.

Critical production requirements:

- Set `DATABASE_URL` or `POSTGRES_URL`; otherwise hosted deployments fail closed unless `ALLOW_EPHEMERAL_SQLITE=true` is intentionally set.
- Set `ADMIN_EMAIL` before first production startup.
- Set `ADMIN_API_TOKEN` for CLI and external monitoring access to `/api/db/audit`, `/api/db/pricing-freshness`, and `/api/db/backfill-price-history`.
- Set `NEXT_PUBLIC_APP_URL` to the canonical deployed origin.
- Set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` before enabling payments. Production must use live keys; Preview must use test keys and a separate webhook secret.
- Set `CRON_SECRET` for scheduled pricing refresh.
- Configure Stripe webhook to hit `/api/payments/webhook`.
- Configure SMTP if paid order emails should be sent.

After deploy:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/estonian-pricing
```

Then verify database health from an authenticated admin session, or use `Authorization: Bearer $ADMIN_API_TOKEN`:

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/db/audit
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/db/pricing-freshness
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/admin/diagnostics
```

Expected healthy freshness response shape:

```json
{
  "healthy": true,
  "todayUtc": "2026-05-08",
  "expectedItems": 123,
  "todayHistoryRows": 123,
  "missingToday": [],
  "stale24h": [],
  "staleChecks24h": [],
  "graphCoveragePct": 100,
  "errors": [],
  "lastSuccessfulRun": { "status": "SUCCESS" }
}
```

`/api/db/pricing-freshness` returns `503` when unhealthy, so it can be monitored externally.

For PostgreSQL schema smoke testing outside Vercel:

```bash
npx tsx scripts/pg-smoke-test.ts "$DATABASE_URL"
```

## Common Debugging Steps

### Local DB looks stale

Remove the SQLite DB and restart:

```bash
rm data/catalog.db
npm run dev
```

If only seed data changed, also verify `SEED_VERSION` was bumped.

### Build/profile is missing components

Check the seeded names in `src/lib/db/index.ts` against product names in `src/lib/db/seed.ts`. Profile seeds resolve component IDs by exact product name.

Run:

```bash
npm test
```

The seeded compatibility regression test should catch broken profile and Mac eGPU combinations.

### Product page has no price history

Check:

- `estonian_price_checks` has a trusted row for the item.
- `price_history` has rows with `source LIKE '%match=%'`.
- The row is not stale according to `TRUSTED_PRICE_MAX_AGE_HOURS`.

If checks exist but history is empty, run the admin backfill endpoint:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/db/backfill-price-history
```

Backfill is idempotent and safe to rerun. It normalizes legacy category rows such as `mac_systems`, then fills missing yesterday/today daily graph rows from the latest trusted real market snapshot. It does not generate artificial price variation.

### Cron returns 401

Verify `CRON_SECRET` is set and the request sends:

```bash
Authorization: Bearer <CRON_SECRET>
```

### Checkout returns missing app URL

Set `NEXT_PUBLIC_APP_URL` or ensure `VERCEL_URL` is available.

### Direct checkout is unavailable

Check `/api/health` and `/api/admin/diagnostics`. Direct checkout intentionally disables itself when pricing is stale, missing, fallback-only, unhealthy, quote-only, out of stock, or Stripe env mode is invalid. The default checkout pricing freshness limit is 24 hours and overrides are capped at 48 hours.

### Checkout origin is rejected

The request `Origin` must match the configured base URL exactly by origin.

### Stripe webhook returns 500

Set `STRIPE_WEBHOOK_SECRET` and confirm Stripe sends the raw webhook body to `/api/payments/webhook`.

### Pricing looks wrong

Inspect `/api/db/audit` as admin or with `Authorization: Bearer $ADMIN_API_TOKEN`. It reports stale checks, rejected matched rows, suspicious pricing, price history coverage, build pricing drift, and pricing run failures.

### Price history graph is stale

1. Check freshness:

```bash
curl -i -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/db/pricing-freshness
```

2. If `latestRun.status` is not `SUCCESS` or `latestFailures` has rows, inspect `pricing_runs` and `pricing_run_failures`; Vercel runtime logs are short-lived and may not retain the failure.
3. Run cron manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/estonian-pricing
```

4. If current trusted checks exist but graph rows are missing, run backfill:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/db/backfill-price-history
```

## Known Risks / TODOs

- Retailer scraping is regex-based and may break when retailer markup changes.
- Price extraction can still capture unrelated prices; trust gates reduce but do not eliminate this risk.
- In-memory rate limiting is not durable across serverless instances. Use Redis/Vercel KV for production-grade abuse controls.
- SQLite is acceptable locally, but production must use PostgreSQL for persistence.
- `node:sqlite` currently emits experimental warnings during tests/builds.
- Some MPN/SKU metadata is normalized from catalog names rather than vendor-specific part numbers.
- Estonian pricing refresh is bounded by serverless runtime limits; large catalogs may need chunked/background jobs.
- Mac eGPU support on Apple Silicon is experimental and quote-only by design.
- Email delivery is best-effort; checkout should not assume SMTP is configured.
- Admin audit coverage is broad but not a substitute for checkout-critical human review on high-value orders.

## Repository Hygiene

Tracked source should stay limited to app code, migrations, seed data, tests, documentation, and deployment-critical config such as `vercel.json` and `.env.example`.

Keep these local-only:

- Real `.env*` files, including `.env.local`
- `.claude/*.local.json`, `.cursor/`, `.codex/`, `.opencode/`, `.vscode/`
- `.next/`, `.vercel/`, `node_modules/`, `coverage/`, test reports, screenshots, debug dumps, temporary exports, and TypeScript build info
- `data/catalog.db` and SQLite sidecar files such as `data/catalog.db-wal` and `data/catalog.db-shm`

Before committing, run:

```bash
git status --short
git diff --check
```

Do not add local database files, logs, screenshots, Vercel local project metadata, editor workspace state, or assistant-local settings.
