# Fast Guard Sales Intelligence — Phase 1 MVP

South Florida only. Discover companies/projects, enrich + AI score 0–100, duplicate check, dashboard.

## Run

```powershell
docker compose up -d
npx prisma generate
npx prisma db push
npm run dev
```

Open http://127.0.0.1:8081 for the demo UI (company names, contacts, projects, triggers, scores). API docs: http://127.0.0.1:8081/docs

## Deploy on Render

The start command cannot be `src/index.ts` (that is what caused `Permission denied`). Use compiled Node:

| Render setting | Value |
| --- | --- |
| **Runtime** | Node |
| **Build Command** | `npm install && npx prisma generate && npx prisma db push && npm run build` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/health` |

Environment variables:

| Name | Value |
| --- | --- |
| `NODE_VERSION` | `20` |
| `DATABASE_URL` | Internal URL from the Render Postgres instance (link the database to this service) |
| `OPENROUTER_API_KEY` | Your OpenRouter key (optional, needed for real enrichment) |

Then **Manual Deploy → Deploy latest commit**. After it is live, open `https://<your-service>.onrender.com`.

DB: `fastguard_leads` on **localhost:5434**, user `fastguard` / `fastguard`.

Set `OPENROUTER_API_KEY` in `.env` for classification. Default model is `nvidia/nemotron-3.5-lightning:free`. If OpenRouter returns a privacy 404, enable free-endpoint training/publication at https://openrouter.ai/settings/privacy and restart the API. Without a key, enrich uses a placeholder score.

## APIs

| Method | Path | What |
| --- | --- | --- |
| GET | `/` | Demo UI — company names and all stored data |
| GET | `/health` | API + database |
| GET | `/api/companies` | All companies with contacts, projects, triggers, leads |
| GET | `/api/dashboard` | Company names, all leads, qualified leads |
| GET | `/api/leads` | All leads with company names |
| POST | `/api/discover` | Find companies, projects, triggers — body `{ "location": "South Florida" }`. Returns **names**. |
| POST | `/api/leads/enrich-all` | Enrich contacts, classify, score 0–100 |
| POST | `/api/dedupe` | Merge duplicate companies |
| GET | `/api/company?name=` | Lookup + enrich contacts and details by company name |

Not in Phase 1: national crawl, CRM, RFP engine, feedback learning.
