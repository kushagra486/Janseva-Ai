# Knowledge corpus

Curated content the service navigator and notice decoder retrieve from.

**Before a public launch, re-check every fee, timeline and link against the official source.**
Government fees and portals change. These guides follow the procedures published on the
official portals and carry a `last_checked` date. Where a number is uncertain the guide says
"check the current rate" instead of guessing.

- `services/*.md` — service guides with frontmatter (`title`, `title_hi`, `department`,
  `source_url`, `tags`, `last_checked`), chunked by `##` heading
- `schemes/*.json` — scheme eligibility rules (format in
  `apps/ai-service/app/pipelines/schemes.py`)
- `sample-notices/*.txt` — illustrative notices for the demo and evals. Names, numbers and
  amounts are placeholders, not real notices.
- `departments.json`, `wards.json` — routing tables for the reporting agents
