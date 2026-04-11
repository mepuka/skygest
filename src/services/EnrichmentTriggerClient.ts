import { ServiceMap, Effect, Layer, Schema } from "effect";
import { PostUri } from "../domain/types";
import type { GapEnrichmentType } from "../domain/enrichment";
import { defaultSchemaVersionForEnrichmentKind } from "../domain/enrichment";
import type { RpcResult } from "../platform/Rpc";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class EnrichmentTriggerError extends Schema.TaggedErrorClass<EnrichmentTriggerError>()(
  "EnrichmentTriggerError",
  {
    message: Schema.String,
    status: Schema.Number,
    postUri: PostUri
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

export type StartEnrichmentRpcInput = {
  readonly postUri: Schema.Schema.Type<typeof PostUri>;
  readonly enrichmentType: GapEnrichmentType;
  readonly schemaVersion: string;
  readonly requestedBy?: string;
};

type EnrichmentTriggerRpcError = {
  readonly message: string;
  readonly status: number;
  readonly postUri?: Schema.Schema.Type<typeof PostUri>;
};

export type EnrichmentTriggerBinding = {
  readonly startEnrichment: (
    input: StartEnrichmentRpcInput
  ) => Promise<RpcResult<unknown, EnrichmentTriggerRpcError>>;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EnrichmentTriggerClient extends ServiceMap.Service<
  EnrichmentTriggerClient,
  {
    readonly start: (
      input: {
        readonly postUri: Schema.Schema.Type<typeof PostUri>;
        readonly enrichmentType: GapEnrichmentType;
        readonly schemaVersion?: string;
        readonly requestedBy?: string;
      }
    ) => Effect.Effect<StartEnrichmentResult, EnrichmentTriggerError>;
  }
>()("@skygest/EnrichmentTriggerClient") {
  static readonly layerFromBinding = (binding: EnrichmentTriggerBinding) =>
    Layer.succeed(
      EnrichmentTriggerClient,
      EnrichmentTriggerClient.of({
        start: (input) =>
          Effect.tryPromise({
            try: () =>
              binding.startEnrichment({
                postUri: input.postUri,
                enrichmentType: input.enrichmentType,
                schemaVersion:
                  input.schemaVersion ??
                  defaultSchemaVersionForEnrichmentKind(input.enrichmentType),
                ...(input.requestedBy === undefined
                  ? {}
                  : { requestedBy: input.requestedBy })
              }),
            catch: (cause) =>
              new EnrichmentTriggerError({
                message:
                  cause instanceof Error ? cause.message : String(cause),
                status: 500,
                postUri: input.postUri
              })
          }).pipe(
            Effect.flatMap((result) =>
              result.ok
                ? Effect.succeed(result.value)
                : Effect.fail(
                    new EnrichmentTriggerError({
                      message: result.error.message,
                      status: result.error.status,
                      postUri: result.error.postUri ?? input.postUri
                    })
                  )
            ),
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
