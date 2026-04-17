# persona-engine

Python FastAPI service wrapping [`persona_agent`](/../../41r-advisor/persona_agent/).
Express API (`apps/api`) calls this service over HTTP; Solana / USDC / DB
layers stay in Express — engine is stateless analysis only.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Version + workspace info |
| GET | `/personas` | List workspace ∪ bundled personas |
| POST | `/personas` | Create persona from TesterProfile |
| POST | `/analyses` | Submit single-persona session → returns `job_id` |
| POST | `/cohort-analyses` | Submit N-persona cohort → returns `job_id` |
| GET | `/analyses/{id}` | Status + progress |
| GET | `/analyses/{id}/result` | Final result (outcome, report_id, obs count) |

## Local dev

```bash
cd apps/persona-engine
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m playwright install chromium   # for browser mode

export ANTHROPIC_API_KEY=sk-...
export PERSONA_ENGINE_WORKSPACE=./workspace
uvicorn main:app --reload --port 4200
```

Smoke test:
```bash
curl http://localhost:4200/health
curl http://localhost:4200/personas
```

## Integration flow (41rpm → engine)

```
[Express apps/api]
   POST /api/autotest/start
      1. Verify USDC payment (x402)
      2. Load persona from DB → build TesterProfile
      3. POST http://persona-engine:4200/personas  (if persona not yet registered)
      4. POST http://persona-engine:4200/analyses
         { persona_id, url, task, mode: "browser" }
      5. Poll /analyses/{id} until status=completed
      6. GET /analyses/{id}/result → store in test_reports table
      7. Upload screenshots via adapters/r2_upload
      8. Settle USDC reward
```

## Environment

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 4200 | HTTP port |
| `PERSONA_ENGINE_WORKSPACE` | `/var/persona_jobs` | Root for jobs, sessions, personas |
| `ANTHROPIC_API_KEY` | (required) | LLM provider |
| `R2_ACCOUNT_ID` | — | Screenshot upload (adapters/r2_upload) |
| `R2_ACCESS_KEY_ID` | — | " |
| `R2_SECRET_ACCESS_KEY` | — | " |
| `R2_BUCKET` | `41rpm-screenshots` | " |
| `R2_PUBLIC_URL` | — | CDN prefix |
| `LOG_LEVEL` | INFO | |

## Deployment (Railway)

1. In `pyproject.toml`, swap the `persona_agent` dep from local `file://`
   to git form:
   ```toml
   "persona_agent[browser,analysis,benchmark] @ git+ssh://git@github.com/kimtaeyoon83/41r-advisor.git#subdirectory=persona_agent"
   ```
2. Add Railway service with `dockerfilePath = "apps/persona-engine/Dockerfile"`.
3. Set `ANTHROPIC_API_KEY`, R2 vars.
4. Set `PERSONA_ENGINE_WORKSPACE=/var/persona_jobs` + add volume mount if you
   want evolution to persist across deploys (otherwise observations reset).

## Tests

```bash
pytest tests/ -q
```
