import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { Effect, Result, Schema } from "effect";
import { DataRefResolverRunParams, type DataRefResolverRunParams as DataRefResolverRunParamsValue } from "../domain/resolution";
import { EnrichmentSchemaDecodeError } from "../domain/errors";
import { type ResolverWorkerEnvBindings } from "../platform/Env";
import { formatSchemaParseError } from "../platform/Json";

const decodeResolverRunParams = (input: unknown) =>
  (() => {
    const decoded = Schema.decodeUnknownResult(DataRefResolverRunParams)(input);
    return Result.isSuccess(decoded)
      ? Effect.succeed(decoded.success)
      : Effect.fail(
          new EnrichmentSchemaDecodeError({
            message: formatSchemaParseError(decoded.failure),
            operation: "DataRefResolverWorkflow.run"
          })
        );
  })();

export class DataRefResolverWorkflow extends WorkflowEntrypoint<
  ResolverWorkerEnvBindings,
  DataRefResolverRunParamsValue
> {
  override async run(
    event: WorkflowEvent<DataRefResolverRunParamsValue>,
    step: WorkflowStep
  ) {
    const params = await Effect.runPromise(
      decodeResolverRunParams(event.payload)
    );

    return await step.do("complete resolver stub", async () => ({
      postUri: params.postUri,
      residualCount: params.residuals.length,
      status: "not-implemented" as const
    }));
  }
}
