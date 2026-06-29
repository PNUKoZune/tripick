# AI/RAG Mobile Final QA - 2026-06-30

## Scope

This note records the final local QA pass for the AI planner, CRAG retrieval, DB index backfill, mobile WebView shell, and long-term report items from `travel_ai_planner_report.pdf`.

## Browser E2E

- Flow: real browser `start -> temporary session -> trip creation -> planner -> waiting replan`.
- Created trip: `f678357a-bdb2-4ca0-b275-cd2d858e0d2a`.
- Destination/date: Busan, 2026-07-03.
- Planner generated four itinerary selections from CRAG/LLM:
  - 광안리 브런치 카페
  - 송정 해변 산책
  - 기장 해산물 식당
  - 흰여울문화마을
- Waiting replan was triggered through `POST /api/v1/alternative/waiting`.
- Realtime/cache refresh updated the planner screen with waiting-response itinerary labels.
- API logs confirmed pgvector-backed CRAG retrieval and AI planner generation for both initial plan and replan.

## Existing DB Volume Index Backfill

The current local Postgres volume was patched with the same indexes that `infra/postgres/init.sql` provides for fresh volumes:

```sql
CREATE INDEX IF NOT EXISTS idx_place_embeddings_region_name
  ON place_embeddings (destination_region, name);

CREATE INDEX IF NOT EXISTS idx_place_embeddings_kakao_place_id
  ON place_embeddings (kakao_place_id);
```

Verified indexes:

- `idx_place_embeddings_hnsw`
- `idx_place_embeddings_kakao_place_id`
- `idx_place_embeddings_region`
- `idx_place_embeddings_region_name`
- `place_embeddings_pkey`

## Mobile/WebView QA

Native build fixes applied during QA:

- Android now declares location and notification permissions used by the WebView bridge.
- Android skips the Google Services Gradle plugin when `google-services.json` is not present, so local debug builds do not fail on missing Firebase credentials.
- React Native Android autolinking is pinned to the local CLI command and package name.
- iOS Podfile supports pnpm monorepo autolinking and Firebase `GoogleUtilities` modular headers.
- iOS location permission text is populated.
- Debug builds skip FCM setup when Firebase credentials are absent, instead of crashing before the WebView loads.

Verified:

- `@tripick/mobile` typecheck passed.
- Android debug build passed for `arm64-v8a`.
- iOS `pod install` passed.
- iOS Simulator build/install/launch passed through XcodeBuildMCP.
- iOS WebView loaded the mobile web login screen at `localhost:3000` without the previous Firebase red screen.
- Browser mobile viewport `390x844` showed login/start screens without text overlap.

Known local-environment note:

- A full Android multi-ABI debug build previously reached symbol stripping and then failed because the host had very low free disk space. The `arm64-v8a` debug build passed after freeing build artifacts.
- After the QA pass, Docker Desktop stopped responding to CLI/API traffic. This blocks rerunning DB-backed API commands until Docker Desktop is restarted successfully. The browser E2E and DB index checks above were completed before that runtime failure.

## PDF Long-Term Items

The report describes these as long-term or infra-dependent work, not local-only tasks:

- Instagram real review: requires Meta app review, real/test Instagram accounts, approved permissions, callback domains, token storage policy, and privacy review. Current MVP should keep direct upload/test-account flow as the reliable path.
- Triton production configuration: requires GPU server access, model repository, model artifacts, versioning policy, HTTP/gRPC routing, batching targets, and monitoring.
- Production deployment hardening: requires production secrets, external LLM token policy, Kakao/FCM credentials, DB migration/index runbook, Docker/runtime stability, observability, backup/rollback, and a smoke-test gate.

See [production-ai-long-term-readiness.md](../ops/production-ai-long-term-readiness.md) for the concrete readiness checklist.
