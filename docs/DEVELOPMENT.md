# Developer Guide

This guide covers local development and architecture at a level suitable for public technical review. Production credentials, private deployment values, incident procedures, and operator runbooks should live outside the repository.

## Architecture Overview

LLMLab.ee is a Next.js 16 App Router application for curated AI PC builds, catalog pages, market-aware pricing, checkout, quote requests, auth, and protected review workflows.

Core layers:

- `src/app` contains route segments, server-rendered pages, and API routes.
- `src/components` contains client and shared UI components.
- `src/lib/db` owns persistence, migrations, seed data, auth/order/catalog queries, and the SQLite/PostgreSQL adapter.
- `src/lib/server` contains server-only orchestration for catalog views, checkout availability, pricing refresh, diagnostics, and compatibility checks.
- `tests/high-value.test.ts` covers commerce safety, pricing behavior, auth, diagnostics, and render regressions.

The app intentionally avoids an ORM. SQL is explicit, migrations are versioned, and the adapter supports SQLite locally plus PostgreSQL in hosted environments.

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

The local SQLite database is created automatically at `data/catalog.db`. Migrations and seeds run on first DB access. To force a clean local re-seed, stop the dev server and remove the local database file.

Useful scripts:

```bash
npm test                 # Node test runner via tsx
npm run lint             # ESLint for src and tests
npm run build            # Production build
npm run pricing:refresh  # Run pricing refresh without starting Next dev server
```

Tests use `LLMLAB_DATA_DIR` to create an isolated temporary SQLite database, so they should not mutate `data/catalog.db`.

## Environment Variables

Use `.env.local` for local secrets and keep it untracked. `.env.example` is the only env file intended for git.

| Variable | Required for | Purpose |
|---|---|---|
| `ADMIN_EMAIL` | admin setup, notifications | Admin account email |
| `ADMIN_SETUP_CODE` | first admin signup | One-time admin registration code |
| `ADMIN_API_TOKEN` | protected operations | Bearer token for private operational tooling |
| `DATABASE_URL` / `POSTGRES_URL` | hosted persistence | PostgreSQL connection string |
| `ALLOW_EPHEMERAL_SQLITE` | explicit non-production fallback | Hosted SQLite escape hatch |
| `LLMLAB_DATA_DIR` | tests/local override | Directory for SQLite `catalog.db` |
| `STRIPE_SECRET_KEY` | payments | Stripe server-side key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_PUBLISHABLE_KEY` | payments | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | payments | Stripe webhook signature verification secret |
| `NEXT_PUBLIC_APP_URL` | payments | Canonical app origin for redirects and origin checks |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL` | email | Transactional email settings |
| `CRON_SECRET` | scheduled pricing refresh | Bearer token for scheduled refresh requests |
| `ESTONIAN_PRICE_MAX_ITEMS`, `ESTONIAN_PRICE_CONCURRENCY` | pricing refresh | Optional refresh limits |
| `DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS` / `CHECKOUT_PRICE_MAX_AGE_HOURS` | checkout | Optional pricing freshness limit |
| `TRUSTED_PRICE_MAX_AGE_HOURS`, `TRUSTED_PRICE_MIN_SAMPLES` | pricing | Optional market-pricing trust thresholds |
| `NEXT_PUBLIC_QUOTE_EMAIL` | public fallback contact | Optional quote contact email |

Do not commit real values for these variables.

## Data Model Summary

The app stores catalog items, build profiles, pricing history, order records, quote requests, users, sessions, and metadata for migrations/seeds. Catalog rows include compatibility metadata such as GPU size, power requirements, CPU socket, RAM type, motherboard slots, case clearance, storage fit, and enclosure constraints.

## Important Data Flows

### App Startup

1. A route or service initializes the database.
2. Hosted environments use persistent PostgreSQL when configured.
3. Local development falls back to SQLite.
4. Migrations and seed upserts run when needed.

### Catalog Rendering

1. Pages call shared catalog service functions.
2. Catalog rows are mapped into page-ready view models.
3. Available market pricing is overlaid when trusted.
4. Reference pricing remains labeled conservatively when market data is missing or stale.

### Pricing Refresh

1. A scheduled service refreshes stale or missing catalog item pricing.
2. Candidate prices are filtered before becoming trusted pricing data.
3. Latest checks and daily history are persisted for charts and checkout safety.
4. Refresh status is recorded for protected diagnostics.

### Checkout

Direct checkout is deliberately conservative. The server validates user state, item eligibility, pricing confidence, provider configuration, and order safety before opening a payment session. Quote-only and custom configurations stay out of direct payment.

### Quote Requests

Quote-only products persist quote requests and can notify the admin contact when email is configured. Admin-facing views should avoid exposing contact details or free-form customer messages beyond what is necessary for the operator workflow.

### Compatibility

Build compatibility checks cover physical fit, power/cooling plausibility, memory/storage constraints, platform-specific caveats, and local LLM fit rules. Buyer-facing copy should remain conservative when model fit depends on quantization, context length, backend support, or offload.

## Deployment Notes

The app is designed for hosted deployment with persistent database storage. Before enabling a commerce environment, verify persistent storage, canonical app origin, payment provider configuration, webhook handling, protected admin access, email settings, scheduled pricing refresh, and health behavior in a non-production environment.

Keep environment-specific values, private deployment links, production incident steps, and operational credentials in the deployment platform or a private runbook.

## Common Local Debugging

### Local DB Looks Stale

Remove the local SQLite database and restart the dev server.

### Build/Profile Is Missing Components

Check seed data names and run the test suite. The seeded compatibility regression tests should catch broken profile and Mac eGPU combinations.

### Product Page Has No Price History

Local price history can be empty until a refresh or test setup creates it. Verify that pricing data is available and trusted before expecting chart coverage.

### Direct Checkout Is Unavailable

Direct checkout intentionally disables itself when pricing, stock, quote-review status, or provider configuration is not safe for payment.

## Repository Hygiene

Tracked source should stay limited to app code, migrations, seed data, tests, documentation, and deployment-critical config such as `vercel.json` and `.env.example`.

Keep these local-only:

- Real `.env*` files, including `.env.local`
- Editor and assistant workspace settings
- Build output, coverage, test reports, screenshots, debug dumps, temporary exports, and TypeScript build info
- Local SQLite database files and sidecars

Before committing, run:

```bash
git status --short
git diff --check
```
