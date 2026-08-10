# AI/RAG planner hardening verification

Date: 2026-06-30
Branch: `feat/rag-crag-planner`

## Scope

- Added runtime DTO validation for replanning, alternative replan reports, main planner trip creation, member add, and swap payloads.
- Changed planner persistence policy from best-effort warning to hard constraint enforcement.
- Added deterministic CRAG fallback regeneration when an AI draft violates constraints.
- Preserved stored itinerary rows when both AI and fallback drafts violate constraints.
- Added DB-independent unit fixtures for the core report risks.

## Hard constraints covered

- Wake/sleep bounds
- Opening hours
- Same-day adjacent route ETA buffer
- Replan payload trigger and numeric bounds
- Invalid AI draft recovery
- Invalid AI plus fallback draft storage prevention

## Verification

```bash
corepack pnpm --filter @tripick/api typecheck
corepack pnpm --filter @tripick/api test -- --runInBand
```

Result:

- API typecheck passed.
- Jest passed: 6 suites, 16 tests.

Notes:

- The DB-backed E2E remains dependent on a local Docker/Postgres runtime.
- This verification intentionally adds pure unit fixtures so the hard constraint and DTO behavior can be checked even when Docker is unavailable.
