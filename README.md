# JANSEVA AI

**सरकार की बात, आपकी भाषा में।** The government's word, in your language.

JANSEVA is a two-way civic platform for Indian cities, starting with Lucknow. Citizens decode
government notices, find the services and schemes they qualify for, and report local problems.
AI agents route those reports to the right office, and a human officer approves every action.

| Module | What it does |
|---|---|
| **Sahayak** (understand) | Notice decoder (photo, PDF or text → plain English, deadline, next steps), service navigator with cited answers (ask in English, Hindi or Hinglish), scheme finder (rules decide, AI explains), deadline reminders |
| **Shikayat** (report) | Report by text, voice or photo with GPS. Agents classify, rate severity, merge duplicates, draft a plan, verify the fix |
| **Prashasan** (act) | Officer dashboard: issue map, approval queue, SLA timers, ward analytics. Knowledge console for admins |

## Run it locally (demo mode, no accounts or keys needed)

```bash
pnpm install && pip install -r apps/ai-service/requirements.txt
(cd apps/ai-service && uvicorn app.main:app --port 8000) &
pnpm dev   # http://localhost:3000
```

Demo mode starts with an in-memory store seeded with a few Lucknow issues and a role switcher
in the header (Citizen / Officer / Admin). With no model configured it runs on deterministic
rules. Add `GROQ_API_KEY` (hosted), or run Ollama (`docker compose up`, fully offline), and
the model paths switch on automatically. See `apps/ai-service/.env.example` and
`apps/web/.env.example`.

## Production setup

1. **Supabase:** create a project, then `supabase link` and `supabase db push`
   (migrations), and run `supabase/seed.sql`. Deploy the reminder function with
   `supabase functions deploy send-reminders` and run `supabase/cron.sql`. Promote staff with
   `select public.set_role('officer@…', 'officer', 'hazratganj');`.
2. **AI service:** build `apps/ai-service/Dockerfile` from the repo root and deploy it (a
   Hugging Face Space in Docker mode works, port 7860). Set `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`, `GROQ_API_KEY` and `CORS_ORIGINS`. Load the
   corpus with `python scripts/sync_corpus.py`.
3. **Web app:** deploy `apps/web` to Vercel with `AI_SERVICE_URL`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

## Measured

`python evals/run_evals.py` in rules-only mode (no model), which is the floor the demo can
never drop below:

| Metric | Set | Result | Target |
|---|---|---|---|
| Notice field accuracy (type, authority, amount, deadline) | 12 notices | 100% | ≥ 90% |
| Retrieval: correct guide ranked first | 38 questions (Hindi, English, Hinglish) | 100% | — |
| Answers with a citation | 38 questions | 100% | 100% |
| Answer contains the key fact | 38 questions | 58% (extractive fallback) | ≥ 85% with a model |
| Duplicate detection precision / recall | 12 report pairs | 100% / 71% | ≥ 80% precision |
| Decode latency, rules path | 12 notices | < 10 ms | < 8 s hosted |

**Read these numbers with care.** The sample notices and question sets were written alongside
the extractor, so they show that the pipeline works, not how accurate it is on real notices. The
blueprint's golden set is 30 real, labelled notices and 50 graded Q&A pairs. Collecting those
is the most valuable next step. Model-mode numbers need a `GROQ_API_KEY`, and CI runs them
automatically when the secret is set. Duplicate recall with the offline hash embeddings is
limited for reports worded differently in Hindi and English more than 50 m apart. BGE-M3
embeddings (`EMBED_PROVIDER=ollama`) are meant to close that gap.

## Tests and CI

- `apps/ai-service`: `pytest` (26 tests: PII masking, extraction, schemes, and the full report
  lifecycle through the API) and `ruff`
- `packages/shared`: contract tests that fail if the Zod enums drift from the Python schemas
- `apps/web`: `tsc`, ESLint, Vitest, `next build`, and
  Playwright end-to-end tests of the demo script (`pnpm --filter @janseva/web e2e`)
- `supabase/tests`: migrations applied to Postgres + PostGIS + pgvector, plus RLS assertions
  (citizens can't see each other's rows, officers stay in their ward, no self-promotion,
  append-only audit log)

`.github/workflows/ci.yml` runs all of these on every push. `evals.yml` runs the evals and
fails below the targets.

## Five-minute demo

1. **Hook:** hold up a printed Nagar Nigam notice and ask the judges what it says.
2. **Scan** (`/decode`): the explanation appears in plain English. Tap **Remind me**.
3. **Ask** (`/services`): "Online kaise pay karein?" gives a cited answer with the official
   link.
4. **Schemes:** tap "Fill as Sunita (62, widow)" to see matching schemes with reasons and a
   document checklist.
5. **Report:** a drain photo with a voice note joins the existing Hazratganj drain issue.
6. **Officer:** switch the role to Officer and open Dashboard. Select the cluster, review the
   AI plan, **Approve**, and the citizen's timeline updates.
7. **Proof:** the numbers above, `docs/architecture.md`, `docs/privacy.md`.

## Project structure

```
apps/web          Next.js 16 PWA (English UI, Tailwind, Leaflet/OSM, Recharts)
apps/ai-service   FastAPI: gateway, OCR, extraction, RAG, schemes, agents
packages/shared   Zod API contracts
supabase          migrations (schema + RLS), seed, send-reminders function, cron, SQL tests
data              service guides, scheme rules, sample notices, departments, wards
evals             golden sets and run_evals.py
docs              architecture, API, privacy
```

## Where this differs from the blueprint, and why

- **Agents are plain async nodes, not LangGraph.** They map one-to-one onto LangGraph nodes
  (see `docs/architecture.md`). The approval interrupt is a database state, so there was no
  need for the checkpointing dependency.
- **Service worker is hand-written (`public/sw.js`), not Serwist.** This follows Next.js 16's
  own PWA guide. Serwist needs the webpack build.
- **No shadcn CLI.** The small component set lives in `components/ui.tsx` in the same style.
  Framer Motion and React Hook Form were left out to keep the bundle small on low-end phones.
- **Officer actions go through the AI service,** so the same role checks and audit trail apply
  in demo mode and with Supabase.
- **18 service guides and 15 schemes, not ~30.** Fees and links follow the official portals,
  but must be re-verified before launch (see `data/README.md`, which now also has a
  verification log — a spot check against live portals caught and fixed one real bug: the
  PM Ujjwala Yojana scheme had an income cap that doesn't actually exist).
- **UI is English-only, not bilingual.** The blueprint's Hindi interface (`hi.json`, the
  language switcher, `next-intl`'s `hi` locale) was removed at the user's request. The
  service navigator still understands Hindi and Hinglish questions typed in, and the AI
  service can still produce a Hindi explanation of a notice via its `language` parameter —
  only the app's own chrome and the decoder's output are fixed to English now.

## Not built yet (stretch)

Reply drafter (objection, extension, RTI), notice-to-report bridge with the notice attached,
local faster-whisper, WhatsApp channel, Awadhi/Bhojpuri, API Setu integrations.

*AI explanations are guidance, not legal advice. Always check the original notice and the
official source.*
