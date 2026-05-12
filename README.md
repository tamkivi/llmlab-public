# LLMLab.ee

> An AI-focused PC build configurator — curated profiles, Estonian market pricing, and a clean opinionated catalog.

---

## What it is

A Next.js catalog app for people who want to run AI workloads locally and don't want to waste time figuring out which parts actually matter for that.

Instead of a generic PC part picker, this is a curated set of **build profiles** grouped by use case:

- **Local LLM Inference** — 7B to 70B quantized models, maximum VRAM per euro
- **LLM Fine-Tune Starter** — enough system RAM and stable thermals for LoRA runs
- **Hybrid AI + Gaming** — balanced compute for daytime AI work, high-refresh gaming at night
- **AI Workstation** — Threadripper and Xeon platforms with ECC RAM for serious multi-session serving
- **Mac eGPU AI Compute** — Apple Silicon Macs paired with external GPUs for CUDA/tinygrad workloads

Each profile links to specific builds with estimated token throughput, system power draw, PSU recommendations, and a price computed from live Estonian market data.

---

## Why

Most PC configurators optimize for gaming. AI workloads have completely different bottlenecks — VRAM bandwidth matters more than clock speed, ECC matters for long training runs, and thermals under sustained inference loads are nothing like a gaming session. This tries to make those tradeoffs legible without burying the user in spec sheets.

The Estonian focus is practical: components are sourced and priced from local vendors, not Amazon DE.

---

## Stack

- **Next.js 16** (App Router, server + client components)
- **TypeScript**
- **Tailwind CSS v4** — `@theme inline`, `color-mix()` for theming, dark/light toggle
- **SQLite** (dev) via Node.js built-in `DatabaseSync` — no ORM, no external DB dependency locally
- **PostgreSQL** (production) via `pg` — set `DATABASE_URL` or `POSTGRES_URL` for persistent storage
- **Stripe** — checkout sessions, webhook signature verification
- **Nodemailer** — order confirmation emails
- **Vercel** — hosting + cron for daily Estonian pricing refresh

---

## Products and checkout

### Direct checkout (Stripe)
Standard PC components and profile builds are purchasable directly:
- GPUs, CPUs, RAM kits, motherboards, power supplies, cases, storage drives, CPU coolers
- Compact AI systems (e.g., NVIDIA DGX Spark)
- Full profile builds (assembled and configured)

Checkout prices include a 15% assembly and configuration markup over the market average. Catalog pages may show seed/base fallback estimates when market pricing is unavailable, but fallback estimates are not eligible for direct Stripe checkout.

Direct checkout is fail-closed. Stripe payment is only offered when the item is directly purchasable, in stock when inventory flags exist, checkout environment configuration is valid, and checkout-critical pricing is fresh, trusted, and non-fallback. The default checkout freshness limit is 24 hours and the code caps overrides at 48 hours. Stale, missing, fallback-only, quote-only, or unhealthy pricing switches the flow to quote-only copy instead of collecting payment.

### Quote-only
Mac systems, eGPU enclosures, and Mac eGPU builds require a custom quote:
- These products involve configuration complexity and variable GPU selection
- Users submit a persisted quote request with their requirements
- The checkout API explicitly rejects these item types

---

## Project structure

For a deeper developer-oriented walkthrough, see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

```
src/
  app/
    page.tsx                        # Homepage — build profile browser
    profiles/[key]/page.tsx         # Per-profile build listing
    builds/[id]/page.tsx            # Individual build detail + purchase
    catalog/[type]/[id]/page.tsx    # Component detail pages
    mac-egpu-builds/[id]/page.tsx   # Mac eGPU build detail (quote-only)
    faq/page.tsx                    # FAQ including "which profile is right for me"
    about/page.tsx
    orders/page.tsx                 # Order history (authenticated)
    admin/orders/page.tsx           # Admin order view
    api/
      health/                       # Public production health summary for uptime monitors
      auth/                         # Register, login, logout, session check
      payments/                     # Stripe checkout, session status, webhook
      admin/diagnostics/            # Admin operational diagnostics
      admin/orders/retry-paid-emails/ # Admin-safe paid-order email retry
      admin/quote-requests/         # Admin-safe quote status/note updates and contact reveal
      cron/estonian-pricing/        # Daily price refresh job
      db/audit/                     # Admin database health check endpoint
      db/backfill-price-history/    # Admin price history normalization
      db/pricing-freshness/         # Admin freshness/monitoring endpoint
  components/
    auth-panel.tsx
    back-button.tsx
    language-switch.tsx
    masthead.tsx
    price-graph.tsx                 # SVG price history chart with range selection
    profile-builds-browser.tsx
    purchase-build-button.tsx
    theme-toggle.tsx
  lib/
    db/
      adapter.ts                    # SQLite/PostgreSQL dual adapter
      index.ts                      # DB init, catalog queries, auth, orders
      migrations.ts                 # Schema migrations (currently v1-v29)
      seed.ts                       # Product catalog seed data
      types.ts                      # Shared type definitions
    pricing-constants.ts            # Shared markup constants (15%)
    auth-session.ts                 # Cookie session config
    stripe.ts
    request-utils.ts                # Rate limiting, IP extraction
    server/
      catalog-service.ts            # Read-only catalog queries + pricing logic
      estonian-pricing-service.ts   # Estonian retailer price scraping
      auth-helpers.ts               # requireAuth() helper
      lang.ts                       # ET/EN language detection
data/
  catalog.db                        # Auto-generated SQLite (dev), gitignored
```

---

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The SQLite database auto-creates and seeds on first run. Delete `data/catalog.db` to force a re-seed (e.g., after adding new builds or components to seed data). The local DB and its WAL/journal files are ignored by git.

### Available scripts

```bash
npm run dev        # Development server
npm run build      # Production build
npm test           # High-value regression tests
npm run lint       # ESLint
npm run start      # Start production build
npm run pricing:refresh  # Run Estonian pricing refresh locally (no dev server needed)
```

Use `npm test`, `npm run lint`, and `npm run build` before shipping changes.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_EMAIL` | **prod** | Email address for the admin account. Must be set in production. |
| `ADMIN_SETUP_CODE` | first run | One-time code to register the admin account |
| `ADMIN_API_TOKEN` | ops optional | Bearer token for operational admin endpoints such as `/api/db/audit`, `/api/admin/diagnostics`, and paid-email repair; keep separate from `CRON_SECRET` |
| `DATABASE_URL` / `POSTGRES_URL` | **prod** | PostgreSQL connection string. Hosted deployments fail closed without this unless `ALLOW_EPHEMERAL_SQLITE=true` is explicitly set. |
| `ALLOW_EPHEMERAL_SQLITE` | preview escape hatch | Allows hosted SQLite fallback only when explicitly set to `true`; do not use for production commerce. |
| `FART_PICKER_DATA_DIR` | local/tests | Optional local SQLite data directory override. Tests use temporary directories. |
| `STRIPE_SECRET_KEY` | payments | Stripe API secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_PUBLISHABLE_KEY` | payments | Stripe publishable key used for live/test mode consistency checks |
| `STRIPE_WEBHOOK_SECRET` | payments | Stripe webhook signing secret |
| `NEXT_PUBLIC_APP_URL` | payments | Base URL (e.g., `https://your-domain.com`) — needed for Stripe return URLs |
| `SMTP_HOST` | emails | SMTP server hostname |
| `SMTP_PORT` | emails | SMTP server port |
| `SMTP_SECURE` | emails | `"true"` for TLS |
| `SMTP_USER` | emails | SMTP username |
| `SMTP_PASS` | emails | SMTP password |
| `SMTP_FROM_EMAIL` | emails | Sender address for order confirmations |
| `CRON_SECRET` | cron | Bearer token for manual cron invocation and Vercel cron authorization |
| `ESTONIAN_PRICE_MAX_ITEMS` | optional | Max components per pricing run (default: 36 on Vercel, 120 local) |
| `ESTONIAN_PRICE_CONCURRENCY` | optional | Concurrent fetches during pricing (default: 4 on Vercel, 6 local) |
| `DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS` / `CHECKOUT_PRICE_MAX_AGE_HOURS` | optional | Direct checkout freshness limit. Default `24`; capped at `48`. Longer display freshness does not make checkout eligible. |
| `TRUSTED_PRICE_MAX_AGE_HOURS` | optional | Display/diagnostic trusted pricing age. Default `168`; not the direct checkout limit. |
| `TRUSTED_PRICE_MIN_SAMPLES` | optional | Minimum sample count for trusted market rows. Default `1`. |
| `NEXT_PUBLIC_QUOTE_EMAIL` | optional | Legacy email target for quote requests; persisted quote requests use `ADMIN_EMAIL` for admin notification |

You can run the app locally without most of these. Local SQLite will work, while admin setup, payments, cron authorization, and SMTP-dependent flows stay disabled or degraded until their env vars are configured.

Copy `.env.example` to `.env.local` for local development. Never commit real `.env*` files; only `.env.example` belongs in git.

### Public repository safety

This repository is intended to be safe to publish with placeholder-only environment documentation. Production, preview, and local credentials belong in Vercel or untracked local env files, not in git. Keep `.env*`, `.vercel/`, local SQLite databases, logs, screenshots, exports, and IDE/agent state out of commits.

---

## Estonian pricing

A Vercel cron job runs daily at 03:00 UTC (`/api/cron/estonian-pricing`). The schedule is defined in `vercel.json` as `0 3 * * *` and runs on Production deployments.

It:

1. Fetches search results from Estonian/local retailers including Hinnavaatlus, 1a.ee, Kaup24, Arvutitark, Galador, Frog.ee, Euronics, Hansapost, and Photopoint
2. Extracts euro prices via regex from the HTML
3. Filters outliers and requires product-token match diagnostics (`match=x/y`)
4. Computes a pre-markup market average
5. Stores `estonian_price_checks.market_avg_eur` and `price_history.price_eur` as pre-markup market averages
6. Stores customer/order-facing prices separately as `final_price_eur`, including the 15% assembly and configuration markup
7. Upserts one `price_history` row per `(category, item_id, UTC date)` and backfills missing yesterday/today rows from the latest trusted real market snapshot

Set `CRON_SECRET` in Vercel. Vercel sends it automatically as the cron request's bearer authorization header, and the route rejects unauthenticated calls.

Runtime logs on Vercel are short-lived. Treat `pricing_runs` and `pricing_run_failures` as the source of truth for cron health, partial failures, stale data, and deployment metadata.

### Pricing limitations

- Scraped prices are **estimates** based on regex extraction from HTML — they can capture unrelated prices on a page
- Low sample counts (<2) are flagged in the admin audit endpoint
- Checkout-critical prices should be reviewed via the admin audit dashboard
- Prices older than 48 hours are flagged as stale

---

## Database

- **Development**: SQLite via `node:sqlite` `DatabaseSync`. Auto-creates in `data/catalog.db`
- **Production**: PostgreSQL via `pg`. Set `DATABASE_URL` or `POSTGRES_URL`
- The adapter translates `?` placeholders to `$1, $2, ...` for Postgres
- Hosted deployments without `DATABASE_URL` or `POSTGRES_URL` fail closed unless `ALLOW_EPHEMERAL_SQLITE=true` is set intentionally
- Schema migrations run automatically on startup (currently v1–v29)
- Migration v10 adds auto-increment sequences for Postgres compatibility
- Live market pricing is only trusted when rows have retailer match diagnostics, fresh timestamps, sane market/base ratios, positive prices, and final-price markup consistency
- Invalid or stale market pricing is ignored by catalog display fallbacks and blocks direct checkout until fresh trusted pricing returns
- Public health endpoint at `/api/health` returns a compact no-PII summary for uptime monitors; it returns `503` when checkout-critical pricing, checkout config, webhook processing, paid email retries, or stuck payment states are degraded
- Admin audit endpoint at `/api/db/audit` checks pricing coverage, stale data, rejected market rows, orphaned records, build pricing drift, and recent pricing run status
- Admin diagnostics endpoint at `/api/admin/diagnostics` adds recent failed webhooks, paid orders missing notification timestamps, ambiguous payment orders, and quote requests needing attention
- Admin operations dashboard at `/admin/orders` shows recent orders, paid-email repair state, masked quote requests, quote statuses, operator notes, and explicit admin-session-only contact reveal
- Admin freshness endpoint at `/api/db/pricing-freshness` returns `200` only when today's UTC graph rows and latest run status are healthy; unhealthy responses return `503` for external monitoring

---

## Repository hygiene

Keep local runtime and editor artifacts out of git:

- `.env`, `.env.local`, and all other real `.env*` files
- `.claude/*.local.json`, `.cursor/`, `.codex/`, `.opencode/`, `.vscode/`
- `.next/`, `.vercel/`, `node_modules/`, TypeScript build info, coverage, test reports, screenshots, debug dumps, and temporary exports
- `data/catalog.db` and related SQLite `-wal`, `-shm`, and journal files

Useful project files that should remain tracked include `.env.example`, `vercel.json`, `src/lib/db/migrations.ts`, `src/lib/db/seed.ts`, tests, fixtures intentionally imported by the app, and deployment docs.

Safe local cleanup:

```bash
rm -rf .next coverage test-results playwright-report blob-report tmp temp reports screenshots debug
rm -f data/catalog.db data/catalog.db-*
```

Do not clean `.vercel/` unless you are intentionally unlinking the local Vercel project.

---

## Post-deploy setup

After a fresh deployment, price history is empty and all product pages will show "Historical price tracking has not started yet." until the first pricing refresh completes.

**Step 1 — Run the first pricing refresh:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/estonian-pricing
```

The response includes `historyInserted`, `historyUpdated`, `updated`, `skipped`, and `failed` counts.

**Step 2 — Verify:**

Use an authenticated admin browser session or configure `ADMIN_API_TOKEN` for CLI checks:

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/db/audit
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/db/pricing-freshness
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/admin/diagnostics
```

Check that:
- `priceHistory.initialized` is `true`
- `priceHistory.totalRows` > 0
- `warnings` does not contain "Historical pricing has not been initialized yet"
- `/api/db/pricing-freshness` returns `healthy: true`, `graphCoveragePct: 100`, empty `missingToday` and `staleChecks24h` lists, and a recent `lastSuccessfulRun`

**Step 3 — If `estonian_price_checks` already has data but `price_history` is empty** (e.g., after a migration), backfill from existing checks:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" https://your-domain.com/api/db/backfill-price-history
```

The backfill endpoint is safe to rerun. It normalizes legacy categories such as `mac_systems`, then idempotently fills missing yesterday/today daily history rows from the latest trusted real market snapshot. It does not invent historical variation.

If the graph is stale:

1. Check `/api/db/pricing-freshness` and inspect `errors`, `missingToday`, `stale24h`, `staleChecks24h`, `latestRun`, and `latestFailures`.
2. Run the cron manually with `CRON_SECRET`.
3. If trusted `estonian_price_checks` rows exist but history rows are missing, run the backfill endpoint.
4. Inspect `pricing_runs` and `pricing_run_failures`; Vercel runtime logs may already be gone.

### External production monitors

Use `/api/health` as the primary production monitor. It is intentionally compact and unauthenticated so services such as UptimeRobot, Better Stack, or Vercel Monitoring can alert without receiving item-level diagnostics, secrets, or customer data.

Monitor setup:

- Method: `GET`
- URL: `https://llmlab.ee/api/health`
- Header: none
- Expected HTTP status: `200`
- Expected JSON field: `"status": "healthy"`
- Alert on: non-`200`, timeout, invalid JSON, or a response missing `"status": "healthy"`

Healthy summary example:

```json
{
  "status": "healthy",
  "pricingFresh": true,
  "pricingCoveragePct": 100,
  "lastPricingSuccessAt": "2026-05-08T03:04:12.000Z",
  "checkoutAvailable": true,
  "recentWebhookFailures": 0,
  "staleWebhookProcessing": 0,
  "pendingPaidEmailRetries": 0,
  "ambiguousPaymentOrders": 0
}
```

When `/api/health` alerts, first check the admin diagnostics endpoint:

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://llmlab.ee/api/admin/diagnostics
```

Check `pricing.errors`, `pricing.staleChecks24h`, `payments.recentFailedWebhookEvents`, `payments.paidEmailRetries`, and `payments.ambiguousPaymentOrders`.

If the alert is pricing-only, the older compact freshness response is still useful for a dedicated pricing monitor:

```bash
curl -i -H "Authorization: Bearer $ADMIN_API_TOKEN" "https://llmlab.ee/api/db/pricing-freshness?summary=1"
```

Pricing-only monitor setup:

- URL: `https://llmlab.ee/api/db/pricing-freshness?summary=1`
- Header: `Authorization: Bearer $ADMIN_API_TOKEN`
- Expected HTTP status: `200`
- Expected JSON field: `"freshness_ok": true`
- Alert on: `401`, `500`, `503`, timeout, or a response missing `"freshness_ok": true`

Healthy summary example:

```json
{
  "status": "healthy",
  "last_success_at": "2026-05-08T03:04:12.000Z",
  "freshness_ok": true,
  "coverage_pct": 100,
  "missing_count": 0
}
```

### Paid email repair

If `/api/health` or `/api/admin/diagnostics` reports paid orders missing customer/admin notification timestamps, retry only the missing sides with the admin repair endpoint:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit":20}' \
  https://llmlab.ee/api/admin/orders/retry-paid-emails
```

To retry one specific order:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orderId":123}' \
  https://llmlab.ee/api/admin/orders/retry-paid-emails
```

The repair endpoint is safe to call repeatedly: it skips non-paid, nonexistent, missing-session, and already-complete orders, and fulfillment only sends email sides whose sent timestamp is still missing. In Production, monitor `https://llmlab.ee`; in Preview, use the preview deployment URL with separate Preview database, Stripe test keys, test webhook secret, and SMTP configuration.

### Incident response runbooks

Runtime logs use compact JSON events through `console.info`, `console.warn`, and `console.error`. Search Vercel runtime logs by `event`, `area`, `requestId`, `orderId`, or `stripeEventId`. Logs intentionally omit customer emails, names, addresses, phone numbers, cookies, auth headers, Stripe secrets, webhook signatures, raw webhook bodies, full Stripe session objects, and full email bodies.

Useful log events:

- Checkout: `checkout_blocked`, `checkout_session_created`, `checkout_session_reused`, `checkout_initialization_failed`
- Stripe webhook: `webhook_rejected`, `webhook_ignored`, `webhook_duplicate_event`, `webhook_order_fulfilled`, `webhook_handling_failed`
- Session status: `session_status_paid_reconciled`, `session_status_expired_reconciled`, `session_status_unpaid_complete_reconciled`
- Pricing: `pricing_cron_started`, `pricing_cron_finished`, `pricing_cron_failed`, `pricing_freshness_unhealthy`
- Health/admin: `health_degraded`, `health_failed`, `admin_diagnostics_degraded`
- Email repair: `paid_order_email_retry_attempted`, `paid_order_email_retry_succeeded`, `paid_order_email_retry_failed`, `admin_paid_email_repair_result`

If `/api/health` returns `503`:

1. Open Vercel Runtime Logs and filter for `event=health_degraded` or the monitor request ID.
2. Call admin diagnostics:

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://llmlab.ee/api/admin/diagnostics
```

3. Check `health.pricingFresh`, `health.checkoutAvailable`, `payments.recentFailedWebhookEvents`, `payments.paidEmailRetries`, and `payments.ambiguousPaymentOrders`.
4. Verify production env vars: `DATABASE_URL` or `POSTGRES_URL`, `NEXT_PUBLIC_APP_URL=https://llmlab.ee`, `STRIPE_SECRET_KEY=sk_live_*`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_*`, `STRIPE_WEBHOOK_SECRET=whsec_*` for the live endpoint, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `ADMIN_EMAIL`, `ADMIN_API_TOKEN`, and `CRON_SECRET`.
5. Do not bypass checkout gating. If pricing or Stripe config is degraded, direct checkout should remain unavailable and customers should use quote-only flows.

If pricing freshness fails:

1. Check logs for `pricing_cron_started`, `pricing_cron_finished`, `pricing_cron_failed`, and `pricing_freshness_unhealthy`.
2. Call:

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://llmlab.ee/api/db/pricing-freshness
```

3. Inspect `errors`, `latestRun`, `latestFailures`, `missingToday`, and `staleChecks24h`.
4. Verify `CRON_SECRET` and run the cron manually if the scheduled run did not happen:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://llmlab.ee/api/cron/estonian-pricing
```

5. If trusted checks exist but history is missing, run:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" https://llmlab.ee/api/db/backfill-price-history
```

If Stripe webhooks fail:

1. Check Vercel logs for `webhook_rejected`, `webhook_handling_failed`, and `webhook_order_fulfilled`.
2. Check Stripe Dashboard webhook deliveries for the same `stripeEventId`.
3. Verify Production uses live keys only: `STRIPE_SECRET_KEY=sk_live_*`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_*`, and the live endpoint's `STRIPE_WEBHOOK_SECRET=whsec_*`.
4. Verify Preview uses test keys only: `STRIPE_SECRET_KEY=sk_test_*`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_*`, and a separate test webhook secret.
5. Do not replay events until the env mismatch or validation failure is understood. Duplicate events are idempotent, but repeated bad configuration will keep failing.

If paid emails are missing:

1. Check `/api/admin/diagnostics` for `payments.paidEmailRetries`.
2. Check Vercel logs for `paid_order_email_retry_failed` and `admin_paid_email_repair_result`.
3. Verify SMTP env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SMTP_SECURE` if needed, and `ADMIN_EMAIL`.
4. Retry missing sides only:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit":20}' \
  https://llmlab.ee/api/admin/orders/retry-paid-emails
```

5. Re-run `/api/health`; it should return `200` once pending paid email retries clear.

---

## Auth

- Dual-DB: SQLite `users` and `sessions` tables (dev), Postgres in production
- Password hashing via Node.js built-in `scrypt`
- HTTP-only, `Secure` (prod), `SameSite=Lax` cookie sessions
- 7-day session expiry
- Roles: `USER`, `DEV`, `ADMIN`
- Rate limiting: in-memory per-IP (10 req/min login, 5 req/min register). Dev-only — does not persist across serverless instances. For production rate limiting, add Redis/Vercel KV.

---

## i18n

The app is bilingual — Estonian (`et`) and English (`en`). Language is detected server-side per request and passed down via `getRequestLanguage()`. All UI strings use a simple `lang === "et" ? ... : ...` ternary pattern; no external i18n library.
