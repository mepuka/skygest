import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { Effect, Schema } from "effect";
import {
  DataRefResolverRunParams,
  DataRefResolverWorkflowResult,
  type DataRefResolverRunParams as DataRefResolverRunParamsValue
} from "../domain/resolution";
import { EnrichmentSchemaDecodeError } from "../domain/errors";
import { type ResolverWorkerEnvBindings } from "../platform/Env";
import { formatSchemaParseError } from "../platform/Json";

const decodeResolverRunParams = (input: unknown) =>
  Schema.decodeUnknownEffect(DataRefResolverRunParams)(input).pipe(
    Effect.mapError(
      (decodeError) =>
        new EnrichmentSchemaDecodeError({
          message: formatSchemaParseError(decodeError),
          operation: "DataRefResolverWorkflow.run"
        })
    )
  );

export class DataRefResolverWorkflow extends WorkflowEntrypoint<
  ResolverWorkerEnvBindings,
  DataRefResolverRunParamsValue
> {
  override async run(
    event: WorkflowEvent<DataRefResolverRunParamsValue>,
    step: WorkflowStep
  ) {
    const params = await step.do("decode resolver params", async () =>
      await Effect.runPromise(
        decodeResolverRunParams(event.payload)
      ) as DataRefResolverRunParamsValue
    );

    return await step.do("complete resolver stub", async () =>
      await Effect.runPromise(
        Schema.decodeUnknownEffect(DataRefResolverWorkflowResult)({
          postUri: params.postUri,
          residualCount: params.stage3Inputs.length,
          status: "not-implemented" as const
        })
      ) as Schema.Schema.Type<typeof DataRefResolverWorkflowResult>
    );
  }
}
