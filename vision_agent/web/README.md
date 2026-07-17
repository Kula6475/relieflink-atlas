# ReliefLink hosted application

This is the production Next.js application. Neon Postgres is the shared source of
truth across authorized devices and food-bank accounts.

## Capabilities

- Food-bank administrator registration creates a site, account, map listing, and agent.
- Inventory Adjustment combines phone-camera/photo analysis and CSV import in one tab.
- Tiled YOLO/Roboflow inference counts visible packages; the multimodal model identifies
  food properties. An operator edits and approves the result before it enters inventory.
- All inventory appears in one editable spreadsheet with optimistic concurrency and an
  audit trail, including `vision` and `csv` intake provenance.
- Registered food banks appear on the network map while item-level ledgers stay scoped.
- Each food-bank agent monitors expiration, low stock, and missing locations. It cannot
  place orders or make commitments without a human.
- Natural-language warehouse search uses OpenAI Structured Outputs to translate requests
  into allowlisted, parameterized, site-scoped database filters.
- The operational ATLAS team runs five persisted stages: Inventory, live NWS/OpenFEMA
  disruption plus least-squares demand forecasting, site negotiation, transport
  feasibility, and orchestration. Proposed commitments stop at a human approval boundary.

## Configuration

```bash
cd vision_agent/web
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Required for the persistent application:

- `DATABASE_URL`: pooled Neon Postgres connection string
- `AUTH_SECRET`: at least 32 characters
- `ROBOFLOW_API_KEY` and `YOLO_MODEL_ID`: package counting
- `OPENAI_API_KEY`: multimodal product/category interpretation
- `OPENAI_TEXT_MODEL`: structured warehouse-query interpretation (defaults to `gpt-5-mini`)

ATLAS does not use an LLM to invent quantities or approve transfers. Quantities come from
the ledger, demand comes from approved dispatch history plus live disruption multipliers,
and route estimates use registered site coordinates. Model-generated search filters are
constrained by JSON Schema and compiled into parameterized SQL.

The database migrations are additive and safe to rerun.

## Vercel

Use `vision_agent/web` as the Root Directory. Configure the environment variables above,
run `npm run db:migrate` once against production Neon, and deploy the `main` branch.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
