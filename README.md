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
pnpm install
pnpm dev   # http://localhost:3000
```

Demo mode starts with a role switcher in the header (Citizen / Officer / Admin) and, without
Supabase configured, an in-memory-equivalent flow with no persistence. With no `GROQ_API_KEY`
it runs on deterministic rules; add the key (`apps/web/.env.local`) and the model paths switch
on automatically. See `apps/web/.env.example`.

## Production setup

Everything — web app and AI logic alike — is one Next.js app (`apps/web`), deployed as a single
Cloudflare Worker via `@opennextjs/cloudflare`. There is no separate AI backend to deploy.

1. **Supabase:** create a project, then `supabase link` and `supabase db push`
   (migrations), and run `supabase/seed.sql`. Deploy the reminder function with
   `supabase functions deploy send-reminders` and run `supabase/cron.sql`. Promote staff with
   `select janseva.set_role('officer@…', 'officer', 'hazratganj');`.
2. **Web app + AI:** `cd apps/web && npx opennextjs-cloudflare build && npx wrangler deploy`.
   Set `GROQ_API_KEY`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` as Worker secrets/vars (`wrangler secret put ...`).

## Tests and CI

- `packages/shared`: contract tests that fail if the Zod enums drift between the two apps
- `apps/web`: `tsc`, ESLint, Vitest (including unit tests for the ported PII masking, field
  extraction and scheme-rules logic in `lib/ai/`), `next build`, and Playwright end-to-end
  tests of the demo script (`pnpm --filter @janseva/web e2e`)
- `supabase/tests`: migrations applied to Postgres + PostGIS + pgvector, plus RLS assertions
  (citizens can't see each other's rows, officers stay in their ward, no self-promotion,
  append-only audit log)

`.github/workflows/ci.yml` runs all of these on every push. The golden evaluation sets in
`evals/*.jsonl` (notice extraction, Q&A, duplicate detection) predate this port and no longer
have a runner — `evals/run_evals.py` imported the deleted Python `ai-service` directly. They're
kept as fixtures for a future TS evals harness rather than deleted outright.

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
apps/web          Next.js 16 PWA + AI logic (lib/ai/): gateway, extraction, RAG, schemes, agents
                  — deployed as one Cloudflare Worker, no separate backend
packages/shared   Zod API contracts
supabase          migrations (schema + RLS), seed, send-reminders function, cron, SQL tests
data              service guides, scheme rules, sample notices, departments, wards (source;
                  apps/web/lib/ai/data/ holds the bundled copy generated from this)
evals             golden sets (fixtures only — see "Tests and CI")
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
- **The standalone FastAPI AI service was retired and its logic ported into `apps/web/lib/ai/`
  as native Next.js API routes**, so the whole app deploys as one Cloudflare Worker with no
  separate backend to host. The civic-report pipeline (intake → investigator → cluster →
  planner) was already a single synchronous call chain, not real async agent orchestration, so
  it ported faithfully; OCR (tesseract) was replaced with sending the photo to Groq's vision
  model directly (Workers can't run native OCR binaries); the before/after photo verifier and
  the hash-based retrieval embedding were dropped (pure keyword retrieval remains) since neither
  has a straightforward Workers equivalent — see `docs/architecture.md`.
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
