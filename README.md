# Fast Guard Sales Intelligence — Phase 1 MVP

South Florida only. Discover companies/projects, enrich + AI score 0–100, duplicate check, dashboard.

## Run locally

```powershell
docker compose up -d
npx prisma generate
npx prisma db push
npm run dev
```

Open http://127.0.0.1:8081 for the demo UI. API docs: http://127.0.0.1:8081/docs

Local DB: `fastguard_leads` on **localhost:5434**. Set `DIRECT_URL` to the same value as `DATABASE_URL`.

Set `OPENROUTER_API_KEY` in `.env` for classification. Default model is `nvidia/nemotron-3.5-lightning:free`. If OpenRouter returns a privacy 404, enable free-endpoint training/publication at https://openrouter.ai/settings/privacy and restart the API. Without a key, enrich uses a placeholder score.

## Deploy on Vercel (PostgreSQL)

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Framework Preset: **Other**. Vercel will use `api/index.ts`.
4. Create Postgres:
   - **Storage → Create Database → Postgres** (Neon), then **Connect** it to this project.
   - That injects `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING`. The app maps those to `DATABASE_URL` and `DIRECT_URL`.
5. In **Settings → Environment Variables**, also add:
   - `OPENROUTER_API_KEY` — your OpenRouter key (needed for contact enrichment)
   - `OPENROUTER_MODEL` — `nvidia/nemotron-3.5-lightning:free` (optional)
6. Deploy. The build runs `prisma generate` and `prisma db push` so tables are created.
7. Open `https://<your-app>.vercel.app` (demo UI) and `/docs` (Swagger).

CLI:

```powershell
npx vercel login
npx vercel --prod
```

Discover and Enrich can exceed the **Hobby 10s** limit. The function `maxDuration` is 60s, which needs **Vercel Pro**.

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
