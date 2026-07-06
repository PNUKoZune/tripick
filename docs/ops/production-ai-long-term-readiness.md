# Production AI Long-Term Readiness

## Instagram Real Review

Current status:

- Treat Instagram Graph API as non-MVP production work.
- Keep direct image upload and registered test-account/manual fixtures as the demo-safe path.

Ready when:

- Meta app is configured with production callback URLs.
- Required Instagram permissions are approved through app review.
- Test account flow is documented with screenshots and reviewer credentials where required by Meta.
- Access/refresh token storage, rotation, revocation, and deletion are covered.
- User consent copy explains image/media use and retention.
- Failure fallback keeps the user in the direct-upload path.

## Triton Operations

Current status:

- AI planner is integrated through the SWCSS OpenAI-compatible LLM gateway and local deterministic fallbacks.
- Triton remains the future serving layer for vision, embedding, and reranking models.

Ready when:

- GPU host, container runtime, and image registry are available.
- Triton model repository is defined with versioned model folders.
- At least one embedding/reranking endpoint has HTTP/gRPC smoke tests.
- Dynamic batching and max queue delay are tuned against fixture latency targets.
- Health/readiness endpoints are wired into deployment checks.
- API config can switch between local/mock endpoints and Triton endpoints without code changes.
- Model latency, error rate, GPU memory, and request volume are collected.

## Production Deployment Hardening

Ready when:

- Production secrets exist for DB, Redis, Kakao, FCM, SWCSS external LLM token, object storage, and JWT signing.
- DB migration/index checklist includes pgvector extension and `place_embeddings` indexes for existing volumes.
- API, web, worker, and mobile WebView base URLs are environment-specific and smoke-tested.
- External LLM gateway checks cover `/models` and `chat/completions`.
- Replan queue worker and WebSocket/FCM notification path have production smoke tests.
- Docker/runtime restart runbook is documented for DB/Redis failures.
- Rollback procedure covers app version, API image, migrations, and LLM configuration.
- Logs redact access tokens, refresh tokens, LLM tokens, and user location payloads.
