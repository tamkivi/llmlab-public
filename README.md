# LLMLab.ee

LLMLab.ee is an AI-focused PC build configurator for buyers who want local AI compute without sorting through generic gaming-first part lists. It combines curated workload profiles, compatibility checks, Estonian market price estimates, quote requests, and optional Stripe checkout.

This repository is a public-safe snapshot of the LLMLab application code. It does not include production credentials, production data, local databases, Vercel project state, or private operational history.

## What It Solves

Most PC configurators optimize for gaming. Local AI workloads have different constraints: VRAM capacity, memory bandwidth, sustained thermals, PSU headroom, and platform compatibility matter more than headline gaming benchmarks.

LLMLab turns those constraints into practical profiles:

- Local LLM inference builds for 7B to 70B quantized models
- Fine-tuning starter systems for LoRA-style workflows
- Hybrid AI and gaming builds
- AI workstation configurations with high RAM and sustained-load focus
- Mac eGPU quote flows for specialist AI-compute setups

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- SQLite for local development via Node's built-in `node:sqlite`
- PostgreSQL for persistent hosted deployments via `pg`
- Stripe checkout and webhook validation
- Nodemailer for transactional email
- Vercel deployment and scheduled pricing refresh

The app intentionally avoids an ORM. SQL, migrations, and seed data live under `src/lib/db`.

## Repository Layout

```text
src/app/                 Next.js routes, pages, and API handlers
src/components/          UI components
src/lib/db/              database adapter, migrations, seeds, and queries
src/lib/server/          server-side catalog, pricing, checkout, and auth logic
tests/                   high-value regression tests
docs/DEVELOPMENT.md      deeper architecture and development notes
scripts/                 local maintenance scripts
```

## Run Locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

For local browsing, the app can run without payment, email, cron, or production database credentials. SQLite auto-creates `data/catalog.db` on first database access. The local database and related SQLite journal files are ignored by git.

Useful commands:

```bash
npm run lint
npm test
npm run build
npm run pricing:refresh
```

## Environment Variables

`.env.example` documents supported variables with empty placeholders. Real values belong in `.env.local` or the deployment platform, never in git.

| Variable | Required | Purpose |
|---|---:|---|
| `ADMIN_EMAIL` | production | Admin account email. |
| `ADMIN_SETUP_CODE` | first admin setup | One-time code for initial admin registration. |
| `ADMIN_API_TOKEN` | optional ops | Bearer token for protected operational checks. |
| `DATABASE_URL` / `POSTGRES_URL` | production | PostgreSQL connection string for persistent hosted storage. |
| `ALLOW_EPHEMERAL_SQLITE` | preview only | Explicit hosted SQLite fallback escape hatch. Do not use for production commerce. |
| `LLMLAB_DATA_DIR` | local/tests | Optional SQLite data directory override. |
| `STRIPE_SECRET_KEY` | payments | Stripe secret key. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | payments | Stripe publishable key. |
| `STRIPE_WEBHOOK_SECRET` | payments | Stripe webhook signing secret. |
| `NEXT_PUBLIC_APP_URL` | payments | Canonical app origin used for checkout redirects and origin checks. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL` | email | SMTP configuration for order and quote notifications. |
| `CRON_SECRET` | cron | Secret used to authorize scheduled pricing refresh. |
| `ESTONIAN_PRICE_MAX_ITEMS`, `ESTONIAN_PRICE_CONCURRENCY` | optional | Pricing refresh limits. |
| `DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS` | optional | Direct checkout pricing freshness limit. |
| `TRUSTED_PRICE_MAX_AGE_HOURS`, `TRUSTED_PRICE_MIN_SAMPLES` | optional | Trusted market price thresholds. |
| `NEXT_PUBLIC_QUOTE_EMAIL` | optional | Legacy quote email display target. |

## Public Snapshot Boundaries

Included:

- Application source code
- Schema migrations and seed catalog data
- Tests and local development scripts
- Public-safe configuration examples
- Vercel cron configuration

Not included:

- Production or preview credentials
- Real `.env*` files
- `.vercel/` project metadata
- Local SQLite databases
- Customer/order data
- Runtime logs, dumps, screenshots, and local IDE or agent state
- Private deployment notes

## Database and Deployment

Local development uses SQLite. Hosted production should use PostgreSQL through `DATABASE_URL` or `POSTGRES_URL`; hosted deployments fail closed without a persistent database unless `ALLOW_EPHEMERAL_SQLITE=true` is set intentionally for a preview environment.

Vercel is the expected deployment target. `vercel.json` defines the scheduled pricing refresh. Stripe, SMTP, cron, and admin functionality remain disabled or degraded until their environment variables are configured.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for deeper architecture notes and operational behavior.

## Security

- Do not commit real secrets, local databases, logs, dumps, screenshots, or deployment metadata.
- Keep production credentials in Vercel or another secret manager.
- Use separate Stripe keys and webhook secrets for preview and production.
- Treat operational admin tokens and cron secrets as production secrets.
- Rotate any credential that was ever committed, pasted into an issue, or shared outside the deployment secret store.

## License

No open-source license is included yet. Until a `LICENSE` file is added, this code is published for review/reference only and is not licensed for reuse.
