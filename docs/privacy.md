# Privacy and safety

This section is written for the Digital Personal Data Protection Act, 2023. It is an
engineering summary, not legal advice. Have the notice reviewed before a public pilot.

## What is collected

Only what the user chooses to give: notices they scan and save, deadlines, reports (text,
optional photo, location, voice transcript), and an email address if they sign in. Nothing is
stored for a decode that isn't saved. In demo mode, decoded notices and deadlines stay in the
browser's local storage.

## Safeguards in the code

| Safeguard | Where |
|---|---|
| Aadhaar, Aadhaar VID, phone, PAN and email masked (including Devanagari digits) before any model call, and stored masked | `apps/ai-service/app/privacy/pii_mask.py`, applied in the decode, ask and triage paths |
| Hosted vision OCR, which would send the raw photo, is opt-in and off by default | `ALLOW_VISION_FALLBACK` |
| Private storage buckets; paths are owner-prefixed and policed | `supabase/migrations/…_rls.sql` |
| Row-level security on every table: citizens see their own rows, officers their ward, admins everything | same, tested by `supabase/tests/rls_test.sql` in CI |
| Roles can only be changed by an admin or the service role | `guard_profile_update` trigger |
| Append-only audit trail of every report status change | `report_events` plus the `forbid_change` trigger |
| A human approves every dispatch | `agents/coordinator.py`; there is no auto-approve path |
| Eligibility decided by published rules, not the model | `pipelines/schemes.py` |
| Rate limiting and a photo requirement for high-severity reports | `routers/reports.py`, `agents/investigator.py` |
| Consent screen with a link to the notice, and consent time recorded | `components/consent-banner.tsx`, `profiles.consent_at` |
| "Guidance, not legal advice" on every explanation, with the original always one tap away | decoder UI |

## Known gaps before a real pilot

- The rate limiter is in memory, per process. Move it to the database or an edge limiter
  when running more than one instance.
- Data export and deletion are possible through Supabase, but there is no self-service
  button yet.
- A grievance officer's contact details must be added to the privacy page.
- Report photos could contain faces or number plates. Blurring them is not implemented.
