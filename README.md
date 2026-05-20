# LLMLab.ee

LLMLab.ee is a commerce-ready Next.js application for curated AI workstation builds. It helps buyers compare practical local-AI PC configurations, understand tradeoffs such as VRAM, thermals, power, and platform compatibility, and move from a recommended build to checkout or quote request.

The repository is structured as a public technical portfolio and collaboration surface. It keeps the app understandable without publishing private deployment details, production credentials, customer data, or operator-only runbooks.

## Project overview

Most PC configurators are optimized around gaming parts and generic compatibility. LLMLab.ee is focused on local AI workloads where GPU memory, sustained power draw, cooling, PCIe layout, RAM capacity, and software readiness matter more than headline gaming benchmarks.

The app combines:

- curated build profiles for local inference, fine-tuning starter systems, hybrid AI/gaming, AI workstations, and Mac plus external GPU experiments
- component catalog pages for GPUs, CPUs, RAM, motherboards, storage, cases, power supplies, coolers, compact AI systems, Macs, and eGPU enclosures
- market-aware pricing logic with fallback safeguards
- authenticated orders, quote requests, and admin review workflows
- bilingual Estonian and English UI copy

## What LLMLab.ee does

LLMLab.ee turns AI-compute requirements into concrete system recommendations. Users can browse by workload, compare build profiles, inspect component details, and choose between direct checkout and quote-only flows depending on product type and pricing confidence.

Direct checkout is intentionally conservative. The app only offers payment when a product is eligible, current pricing is trusted, required commerce configuration is present, and the item is not quote-only. Complex Mac eGPU combinations and custom requirements are routed through quote requests.

## Tech stack

- **Next.js 16** with the App Router
- **React 19**
- **TypeScript**
- **Tailwind CSS v4**
- **SQLite** for local development
- **PostgreSQL** for persistent hosted deployments
- **Stripe** for checkout sessions and webhook-backed payment confirmation
- **Nodemailer** for transactional order notifications
- **Vercel** for hosting and scheduled pricing refreshes
- **Node test runner + tsx** for high-value regression tests

## Public/demo scope

This public repo is intended to show product thinking, architecture, and implementation quality. It is suitable for recruiters, collaborators, and technical reviewers who want to understand how the app is built.

The repo does not include:

- production credentials or environment values
- private customer, order, or quote data
- production database snapshots
- private deployment links or operator playbooks
- legal/business identity details that should be reviewed outside source control

Some workflows are designed to degrade locally when optional services are not configured. Local development works with SQLite, while payments, email delivery, protected admin operations, and scheduled refresh authorization require environment variables.

## Architecture summary

```text
src/
  app/                  Next.js pages and API routes
  components/           Shared UI and client components
  lib/
    db/                 SQLite/PostgreSQL adapter, migrations, seed data, queries
    server/             Server-only checkout, pricing, diagnostics, and catalog services
    *.ts                Shared domain utilities
tests/                  Regression tests for commerce, pricing, auth, and rendering behavior
docs/                   Developer notes for local work and architecture
scripts/                Maintenance and pricing utilities
```

Key architectural choices:

- **No ORM**: SQL is explicit, migrations are versioned, and the adapter supports SQLite locally plus PostgreSQL in hosted environments.
- **Fail-closed commerce**: checkout availability is computed server-side and blocks direct payment when pricing or configuration is unsafe.
- **Quote-first for complex products**: custom and experimental configurations avoid premature payment capture.
- **Public health, protected diagnostics**: public health output is compact and non-sensitive; detailed diagnostics require admin access.
- **Durable pricing history**: market checks and daily history rows are stored separately so product pages can show pricing context without trusting every scrape.

## Local development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

The local SQLite database is created automatically at `data/catalog.db` on first database access. To force a clean local seed, stop the dev server and remove the local database files:

```bash
rm -f data/catalog.db data/catalog.db-*
```

Useful scripts:

```bash
npm test                 # High-value regression tests
npm run lint             # ESLint for src and tests
npm run build            # Production build
npm run start            # Start a production build locally
npm run pricing:refresh  # Run pricing refresh locally
```

Run `npm test`, `npm run lint`, and `npm run build` before release-oriented changes.

## Environment variables

Copy `.env.example` to `.env.local` for local development. Keep real `.env*` files untracked.

| Variable | Purpose |
|---|---|
| `ADMIN_EMAIL` | Admin account email used by setup and notifications |
| `ADMIN_SETUP_CODE` | One-time setup code for the first admin account |
| `ADMIN_API_TOKEN` | Optional bearer token for protected operational endpoints |
| `DATABASE_URL` / `POSTGRES_URL` | PostgreSQL connection string for hosted persistent storage |
| `ALLOW_EPHEMERAL_SQLITE` | Explicit hosted SQLite fallback escape hatch for non-production experiments |
| `LLMLAB_DATA_DIR` | Optional local/test SQLite data directory override |
| `STRIPE_SECRET_KEY` | Stripe server-side API key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key for checkout mode consistency checks |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_APP_URL` | Canonical app origin for checkout redirects and origin checks |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL` | Optional SMTP configuration for transactional emails |
| `CRON_SECRET` | Bearer token used to authorize scheduled pricing refreshes |
| `ESTONIAN_PRICE_MAX_ITEMS`, `ESTONIAN_PRICE_CONCURRENCY` | Optional pricing refresh limits |
| `DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS` / `CHECKOUT_PRICE_MAX_AGE_HOURS` | Optional direct checkout pricing freshness limit |
| `TRUSTED_PRICE_MAX_AGE_HOURS`, `TRUSTED_PRICE_MIN_SAMPLES` | Optional trusted market-pricing thresholds |
| `NEXT_PUBLIC_QUOTE_EMAIL` | Optional public fallback contact email |

`.env.example` intentionally contains empty placeholders only. Do not commit real keys, webhook secrets, SMTP credentials, admin tokens, database URLs, or private deployment-specific values.

## Security notes

- Checkout is gated by server-side eligibility checks and should remain unavailable when pricing or provider configuration is unsafe.
- Stripe webhook handling validates signatures and expected payment metadata before marking orders paid.
- Admin diagnostics and maintenance routes require authenticated admin access or a configured bearer token.
- Public health responses are designed to avoid customer data, secrets, and item-level operational detail.
- Runtime logs should avoid raw request bodies, cookies, authorization headers, customer contact details, payment secrets, and full third-party response payloads.
- Local SQLite files, `.env*` files, build output, Vercel project metadata, screenshots, and debug dumps should stay out of git.

## Deployment notes

The app is designed for Vercel with PostgreSQL-backed persistence.

Before enabling a hosted commerce environment:

- configure a persistent PostgreSQL connection
- configure the canonical app URL
- configure Stripe keys and webhook signing secret for the target environment
- configure admin setup and protected diagnostics access
- configure SMTP if paid-order notifications should be sent
- configure scheduled pricing refresh authorization
- verify checkout, webhook, email, pricing, and health behavior in a staging/preview environment first

Keep production credentials and operational procedures in the deployment platform or a private runbook, not in this repository.

## License

No open-source license has been published for this repository yet. All rights are reserved unless a license file is added later.
