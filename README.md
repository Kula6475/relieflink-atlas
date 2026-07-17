# ReliefLink

ReliefLink is a shared food-bank operations network with site-scoped inventory and
human-governed agents.

The production application lives in [`atlas_web`](atlas_web). It provides:

- food-bank and administrator registration;
- a Neon Postgres ledger shared across authorized devices;
- a map of registered food banks;
- CSV inventory intake and an editable, audit-logged spreadsheet;
- one monitoring agent per food bank for expiration, low-stock, and location alerts;
- explicit human authority over operational commitments.

The former synthetic scenario dashboard and hosted vision intake have been removed.
There is no coupling to the separately developed vision-agent directory.

## Run the hosted application locally

```bash
cd atlas_web
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

See [`atlas_web/README.md`](atlas_web/README.md) for configuration and CSV fields.

## Legacy prototype

The root FastAPI/SQLite modules remain as reference implementations for weather,
optimization, and the original ledger. They are not the production web application and
are not connected to the new inventory intake flow.
