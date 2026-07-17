# ReliefLink hosted application

This is the primary Next.js application. Neon Postgres is the shared source of truth
across devices and food-bank accounts.

## Current workflow

- A food-bank administrator registers a site, location, account, and site agent.
- Every account is scoped to its own organization and site.
- Registered sites appear on the shared network map; item-level inventory stays scoped.
- Administrators import CSV inventory and edit any cell in the live spreadsheet.
- All cell edits use optimistic concurrency and are written to an audit log.
- The food-bank agent monitors expirations, low stock, and missing warehouse locations.
- Agent findings are recommendations only. Orders, transfers, reservations, and disposal
  remain human decisions.

There is intentionally no camera or vision integration in this application. A separate
vision-agent project can later call the inventory API after its contract is agreed.

## Local setup

```bash
cd atlas_web
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Set `DATABASE_URL` to a Neon pooled connection string and generate `AUTH_SECRET` with
`openssl rand -base64 32`. Migrations are additive and safe to rerun.

## CSV format

Required headers are `product_name`, `category`, `quantity`, and `unit`. Optional fields
are `brand`, `subcategory`, `lot_number`, `expiration_date`, `warehouse_zone`,
`bin_location`, `condition`, `source_name`, `barcode`, and `notes`.

## Vercel

Set the project Root Directory to `atlas_web`, add `DATABASE_URL` and `AUTH_SECRET`, run
the migrations once against the production database, and deploy.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
