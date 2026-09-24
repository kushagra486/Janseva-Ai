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

## Verification log

2026-09-24 — spot-checked the highest-traffic claims against the live portals:

| Claim | Source checked | Result |
|---|---|---|
| lmc.up.nic.in is Lucknow Nagar Nigam's property/house tax portal | lmc.up.nic.in | confirmed |
| Nagar Nigam Lucknow helpline 1533 | live search | confirmed |
| crsorgi.gov.in is the Civil Registration System (births/deaths) | crsorgi.gov.in (redirects to dc.crsorgi.gov.in) | confirmed as the right portal; the 21-day fee detail is from the Registration of Births and Deaths Act, 1969, not re-verified against the page text |
| ldalucknow.in offers online building plan approval | ldalucknow.in | confirmed (routes to map.up.gov.in) |
| UPPCL consumer helpline 1912 | live search | confirmed |
| echallan.parivahan.gov.in is the official MoRTH e-challan portal | live search | confirmed |
| PM-KISAN pays ₹6,000/year in 3 instalments | pmkisan.gov.in | confirmed exact |
| PM-JAY 70+ gives ₹5 lakh/year regardless of income | live search (PIB/PMO release) | confirmed exact |
| PM Ujjwala Yojana has a ₹2.5 lakh income cap | pmuy.gov.in | **wrong — fixed.** PMUY has no formal income limit; eligibility is a self-certified "deprivation declaration". `data/schemes/central.json`'s `income_max` rule was removed and the check reworded. |

**Not reachable from this environment:** most `*.up.gov.in` and several `*.gov.in` sites
(sspy-up.gov.in, edistrict.up.gov.in, fcs.up.gov.in, beneficiary.nha.gov.in, echallan directly
by IP, and others) returned 403/503/no-route through this sandbox's network path — consistent
with geo- or bot-blocking on Indian government sites, not evidence the URLs are wrong. Those
guides' `last_checked` stays at the original `2026-09` (unverified this pass); re-check them
from a normal browser before relying on them.
