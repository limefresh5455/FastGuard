# Fast Guard Sales Intelligence — Phase 1 MVP

South Florida only. Five jobs: Excel import, discover companies/projects, enrich + AI score 0–100, duplicate check, dashboard.

## Run

```powershell
docker compose up -d
npx prisma generate
npx prisma db push
npm run dev
```

Open http://127.0.0.1:8081/docs

DB: `fastguard_leads` on **localhost:5434**, user `fastguard` / `fastguard`.

Set `OPENROUTER_API_KEY` in `.env` for classification. Default model is `nvidia/nemotron-3.5-lightning:free`. If OpenRouter returns a privacy 404, enable free-endpoint training/publication at https://openrouter.ai/settings/privacy and restart the API. Without a key, enrich uses a placeholder score.

## APIs

| Method | Path | What |
| --- | --- | --- |
| GET | `/health` | API + database |
| POST | `/api/import/excel` | Multipart field `file` (`.xlsx`) |
| POST | `/api/discover` | Find companies, projects, triggers — body `{ "location": "South Florida" }` |
| POST | `/api/leads/enrich-all` | Enrich contacts, classify, score 0–100 |
| POST | `/api/dedupe` | Merge duplicate companies |
| GET | `/api/dashboard` | Qualified leads (score ≥ 60) |
| GET | `/api/company?name=` | Contacts and details by company name |

```powershell
curl -F "file=@security_service_leads_by_source.xlsx" http://127.0.0.1:8081/api/import/excel
```

Not in Phase 1: national crawl, CRM, RFP engine, feedback learning.
