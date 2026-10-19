# Battery coverage matrix

Total items: **562** across **5** families; ATT&CK techniques touched: **29**.

| Family | Name | Status | Items | logic | functionality | validation | ATT&CK |
|---|---|---|---:|---:|---:|---:|---:|
| SS | SecScan service | covered | 120 | 58 | 28 | 34 | 6 |
| SL | Seclayer service | covered | 80 | 25 | 27 | 28 | 5 |
| WA | Web application | covered | 144 | 46 | 9 | 89 | 9 |
| WS | Windows host / AD | covered | 108 | 24 | 19 | 65 | 21 |
| LX | Linux host | covered | 110 | 29 | 20 | 61 | 22 |
| CL | Cloud (AWS/Azure/GCP) | gap | 0 | 0 | 0 | 0 | 0 |
| API | API / auth protocols | gap | 0 | 0 | 0 | 0 | 0 |
| AI | AI / LLM red team | gap | 0 | 0 | 0 | 0 | 0 |
| SC | CI-CD / supply chain | gap | 0 | 0 | 0 | 0 | 0 |
| NET | Network services / databases | gap | 0 | 0 | 0 | 0 | 0 |
| MOB | Mobile (iOS/Android) | out-of-scope | 0 | 0 | 0 | 0 | 0 |
| ICS | OT / ICS / SCADA | out-of-scope | 0 | 0 | 0 | 0 | 0 |

**Gaps (no items yet):** CL (Cloud (AWS/Azure/GCP)), API (API / auth protocols), AI (AI / LLM red team), SC (CI-CD / supply chain), NET (Network services / databases)

**Out of scope:** MOB (Mobile (iOS/Android)), ICS (OT / ICS / SCADA)

## How to close a gap

Add a target source under `src/targets/<family>-part-N.ts` with the same item shape, register it in
`src/targets.ts`, and re-run this script. Every item needs an `id` (`<FAMILY>-NNN`), a `category`
(`logic` | `functionality` | `validation`), and an `attackId` - the matrix derives from those fields.
