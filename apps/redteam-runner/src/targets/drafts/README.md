# Battery family drafts: cloud (CL), API (AP), AI (AI)

These three families are **content-complete but not registered**. They are parked
here so the build stays green: registering them changes `TargetId`, `ALL_TARGETS`,
`BATTERY_ITEM_COUNTS` and `TARGET_PREFIXES`, and several existing tests assert the
five-family world (target registry, total counts, and the coverage-mechanics
tests that assume four/five targets).

## To wire one family (repeat per family)

1. Move the file up: `src/targets/<family>.ts` and change the import back to
   `./types.js`.
2. `src/targets/types.ts`:
   - add the id to `TargetId`
   - add it to `ALL_TARGETS` (NOT `FULL_BATTERY_TARGETS`)
   - add the 2-letter prefix to `TARGET_PREFIXES`
   - add the count to `BATTERY_ITEM_COUNTS`
   - extend `TargetKind`
3. `src/targets/index.ts`: import the profile and add it to `TARGET_PROFILES`
   plus `PLAN_PHASE_NAMES`.
4. Update the tests that pin the old world:
   - `test/targets.test.ts`: the `ALL_TARGETS` deep-equal, the profile key list,
     the floors record, and the total-count assertion.
   - `test/item-ledger.test.ts`: it asserts every item's `attackId` exists in
     `src/attack.ts` — **check each draft attackId against that catalog first**
     (T1530, T1550.001, T1592, T1565, T1059.007 may need adding there or the
     items need a technique the catalog already carries).
   - the coverage-mechanics tests (`12 cells (all four targets)`,
     `6/6 web cells`, `missing seclayer cells`) assume the four/five-target set:
     they need to derive their target list from `ALL_TARGETS` instead of a
     literal list.
5. Regenerate the coverage matrix: `pnpm run coverage`.

## Why these families

- **CL** — cloud control-plane/data-plane: public storage, IMDS via SSRF, IAM
  least privilege, long-lived keys, audit-log coverage, public snapshots,
  serverless secrets, IMDSv1.
- **AP** — the API contract itself: GraphQL introspection/field authz, JWT
  alg/kid/jku, mass assignment, OAuth redirect_uri, BOLA/IDOR, auth rate limits.
- **AI** — the assistant as surface: direct/indirect prompt injection,
  tool-call hijacking, system-prompt leakage, retrieval poisoning,
  output-rendering injection, encoding/persona bypass, cross-agent confused
  deputy.

Each item carries the same `TargetBatteryItem` shape as the shipped families
(`id`, `category`, `name`, `brief`, `owasp`, `attackId`, `what`), and the profile
carries `authModel` and `scopeNotes` so the agents know the trust boundary and
the non-destructive limits.
