import { ServiceMap, Effect, Layer, Schema } from "effect";
import type { AtUri } from "../domain/types";
import type { EnrichmentKind } from "../domain/enrichment";
import { defaultSchemaVersionForEnrichmentKind } from "../domain/enrichment";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class EnrichmentTriggerError extends Schema.TaggedErrorClass<EnrichmentTriggerError>()(
  "EnrichmentTriggerError",
  {
    message: Schema.String,
    status: Schema.Number,
    postUri: Schema.String
  }
) {}

// ---------------------------------------------------------------------------
// Result schema
// ---------------------------------------------------------------------------

const StartEnrichmentResult = Schema.Struct({
  runId: Schema.String,
  workflowInstanceId: Schema.String,
  status: Schema.Literal("queued")
});
export type StartEnrichmentResult = Schema.Schema.Type<typeof StartEnrichmentResult>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EnrichmentTriggerClient extends ServiceMap.Service<
  EnrichmentTriggerClient,
  {
    readonly start: (
      input: {
        readonly postUri: string;
        readonly enrichmentType: string;
        readonly schemaVersion?: string;
      }
    ) => Effect.Effect<StartEnrichmentResult, EnrichmentTriggerError>;
  }
>()("@skygest/EnrichmentTriggerClient") {
  static readonly layerFromFetcher = (fetcher: Fetcher, operatorSecret: string) =>
    Layer.succeed(
      EnrichmentTriggerClient,
      EnrichmentTriggerClient.of({
        start: (input) =>
          Effect.tryPromise({
            try: async () => {
              const schemaVersion =
                input.schemaVersion ??
                defaultSchemaVersionForEnrichmentKind(
                  input.enrichmentType as EnrichmentKind
                );

              const response = await fetcher.fetch(
                new Request("https://ingest.internal/admin/enrichment/start", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "authorization": `Bearer ${operatorSecret}`
                  },
                  body: JSON.stringify({
                    postUri: input.postUri,
                    enrichmentType: input.enrichmentType,
                    schemaVersion
                  })
                })
              );

              const body = (await response.json()) as Record<string, unknown>;

              if (!response.ok) {
                throw {
                  message:
                    (body.message as string) ??
                    `enrichment start failed with ${response.status}`,
                  status: response.status
                };
              }

              return body;
            },
            catch: (cause) => {
              const err = cause as Record<string, unknown>;
              return new EnrichmentTriggerError({
                message:
                  typeof err.message === "string"
                    ? err.message
                    : String(cause),
                status:
                  typeof err.status === "number" ? err.status : 500,
                postUri: input.postUri
              });
            }
          }).pipe(
            Effect.flatMap((body) =>
              Schema.decodeUnknownEffect(StartEnrichmentResult)(body).pipe(
                Effect.mapError(
                  (parseError) =>
                    new EnrichmentTriggerError({
                      message: `Invalid enrichment response: ${String(parseError)}`,
                      status: 502,
                      postUri: input.postUri
                    })
                )
              )
            )
          )
      })
    );
}
