# AI service API

Base URL: `AI_SERVICE_URL`. Interactive docs are at `/docs` (FastAPI/OpenAPI). The types are
mirrored in `packages/shared/src/index.ts`.

Auth: `Authorization: Bearer <Supabase access token>`, or in demo mode `X-Demo-Role`
(`citizen` | `officer` | `admin`) plus `X-Demo-User`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health` | any | Provider status, store kind, corpus size |
| POST | `/v1/decode` | any | `{text}` or `{file_path}` (Storage bucket `notices`) plus `language` → fields, explanation, confidence, citations |
| POST | `/v1/decode/upload` | any | Multipart `file` (image, PDF or text) plus `language` |
| POST | `/v1/ask` | any | `{question, language?, stream?}`. With `stream: true` returns SSE: `event: citations`, then `data:` text pieces, then `event: done` |
| GET | `/v1/schemes` | any | Scheme catalogue |
| POST | `/v1/schemes/match` | any | The six answers (plus optional `widowed`, `disability`) → eligible schemes with reasons, checks and documents |
| POST | `/v1/stt` | any | Multipart `file` voice note → `{text, language}` (Whisper on Groq) |
| POST | `/v1/reports/triage` | any | Runs intake, investigator, clustering and planner. Rate-limited to 10 reports per user per hour |
| GET | `/v1/reports/mine` | any | The caller's reports |
| GET | `/v1/reports/{id}` | any | Timeline and cluster. The report text is included for its owner and for staff only |
| POST | `/v1/reports/{id}/verify` | owner | Multipart `after` (and `before` if no photo is on file) → `fixed` / `not_fixed` / `uncertain` |
| POST | `/v1/reports/{id}/feedback` | owner | `{confirmed, rating?, comment?}`. A dispute reopens the issue |
| GET | `/v1/clusters` | officer, admin | Issues, ordered by priority (officers see only their ward) |
| GET | `/v1/clusters/{id}` | officer, admin | The issue and its member reports |
| POST | `/v1/clusters/{id}/decision` | officer, admin | `{decision: approve \| edit \| reject, steps?, department_id?, sla_hours?, note?}` |
| POST | `/v1/clusters/{id}/status` | officer, admin | `{status: in_progress \| resolved, note?}` |
| GET | `/v1/departments` | any | Routing table |
| GET | `/v1/analytics` | officer, admin | Counts, average resolution time, reopen rate, satisfaction, SLA breaches |
| POST | `/v1/admin/ingest` | admin | `{title, content, url?}` → chunks (persisted to `sources` and `doc_chunks` when Supabase is set) |
| POST | `/v1/admin/ingest/file` | admin | Multipart PDF or text file plus `title` and `url` |
| GET | `/v1/admin/sources` | admin | Indexed sources |
| GET | `/v1/admin/sources/{id}/chunks` | admin | Review chunks |
| DELETE | `/v1/admin/sources/{id}` | admin | Remove from the index |
| POST | `/v1/admin/reindex` | admin | Re-embed everything |

Errors use FastAPI's `{"detail": "..."}` with human-readable messages. `422` on unreadable
input includes retake guidance.

## Web app server actions (`apps/web/app/actions.ts`)

`createReport`, `decidePlan`, `updateClusterStatus`, `saveDeadline`, `setDeadlineStatus`,
`acceptConsent`, and `setDemoRole` (demo mode only).

## Edge Function

`supabase/functions/send-reminders` is called hourly by pg_cron (`supabase/cron.sql`). It
sends push and email for active deadlines whose `due_date − today` (India time) is in
`reminder_days` (default 7, 2, 0), at most once per day per deadline.
