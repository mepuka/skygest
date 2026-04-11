# SKY-238 Resolver Rollout Notes

## Deploy order

1. Deploy `skygest-resolver` with `wrangler.resolver.toml`.
2. Deploy `skygest-bi-ingest` so the enrichment workflow can call the resolver binding.
3. Deploy `skygest-bi-agent` so operator surfaces and future internal callers share the same binding layout.

## Initial rollout posture

- Leave `ENABLE_DATA_REF_RESOLUTION` unset or `false` in production.
- Enable the flag in staging first.
- In staging, the source-attribution workflow will persist `data-ref-resolution` after source-attribution completes.
- Stage 3 dispatch is only exercised from staging admin-triggered runs.

## What to verify in staging

- `GET /v1/resolve/health` on `skygest-resolver` returns healthy.
- A source-attribution run completes and `get_post_enrichments` shows a `data-ref-resolution` payload.
- The stored payload includes:
  - `stage1.matches`
  - `stage1.residuals`
  - `resolverVersion`
  - `processedAt`
- If residuals exist on an admin-triggered staging run, the resolver response can include a queued Stage 3 stub job.

## Rollback

- Turn `ENABLE_DATA_REF_RESOLUTION` back to `false` to stop new resolver calls from the enrichment workflow.
- If needed, roll back the ingest or agent worker without touching stored `data-ref-resolution` rows; the read path tolerates their presence.
- The resolver worker can be rolled back independently because the call path is behind the feature flag.
