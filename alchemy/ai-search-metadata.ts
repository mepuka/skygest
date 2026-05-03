import {
  type CloudflareApiOptions,
  createCloudflareApi,
  getAiSearchInstance,
  updateAiSearchInstance,
  type AiSearch
} from "alchemy/cloudflare";
import { Scope, type Phase, type State, type StateStore } from "alchemy";

import {
  MAX_AI_SEARCH_CUSTOM_METADATA_FIELDS,
  type AiSearchCustomMetadataField
} from "../packages/ontology-store/src/Provisioning";

type ExistingAiSearchInstance = Awaited<
  ReturnType<typeof getAiSearchInstance>
>;
type CloudflareApi = Awaited<ReturnType<typeof createCloudflareApi>>;

export class AiSearchCustomMetadataDriftError extends Error {
  readonly _tag = "AiSearchCustomMetadataDriftError" as const;
  constructor(
    readonly instanceName: string,
    readonly expected: ReadonlyArray<AiSearchCustomMetadataField>,
    readonly actual: ReadonlyArray<{
      readonly field_name: string;
      readonly data_type: AiSearchCustomMetadataField["data_type"];
    }> | null | undefined
  ) {
    super(
      `AI Search instance "${instanceName}" custom_metadata drift: ` +
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}. ` +
        `Re-deploy to reconcile.`
    );
  }
}

export interface AiSearchMetadataClient {
  readonly createApi: (
    apiOptions?: CloudflareApiOptions
  ) => Promise<CloudflareApi>;
  readonly getInstance: (
    api: CloudflareApi,
    namespace: string,
    instanceName: string
  ) => Promise<ExistingAiSearchInstance>;
  readonly updateInstance: (
    api: CloudflareApi,
    namespace: string,
    instanceId: string,
    payload: AiSearch.ApiPayload
  ) => Promise<ExistingAiSearchInstance>;
}

const defaultClient: AiSearchMetadataClient = {
  createApi: (apiOptions) => createCloudflareApi(apiOptions ?? {}),
  getInstance: getAiSearchInstance,
  updateInstance: updateAiSearchInstance
};

const normalizeFields = (
  fields: ReadonlyArray<AiSearchCustomMetadataField>
): ReadonlyArray<AiSearchCustomMetadataField> => {
  if (fields.length > MAX_AI_SEARCH_CUSTOM_METADATA_FIELDS) {
    throw new Error(
      `AI Search supports at most ${String(
        MAX_AI_SEARCH_CUSTOM_METADATA_FIELDS
      )} custom metadata fields; got ${String(fields.length)}`
    );
  }

  return fields.map((field) => ({
    field_name:
      field.field_name.toLowerCase() as AiSearchCustomMetadataField["field_name"],
    data_type: field.data_type
  }));
};

const fieldsEqual = (
  left:
    | ReadonlyArray<{
        readonly field_name: string;
        readonly data_type: AiSearchCustomMetadataField["data_type"];
      }>
    | null
    | undefined,
  right: ReadonlyArray<AiSearchCustomMetadataField>
): boolean => {
  if (left == null || left.length !== right.length) return false;
  return left.every((field, index) => {
    const r = right[index];
    if (r === undefined) return false;
    const leftName = (field as { field_name?: unknown } | undefined)?.field_name;
    if (typeof leftName !== "string") return false;
    return (
      leftName.toLowerCase() === r.field_name && field.data_type === r.data_type
    );
  });
};

const whenPresent = <A>(key: string, value: A | null | undefined) =>
  value == null ? {} : { [key]: value };

const updatePayload = (
  instance: ExistingAiSearchInstance,
  customMetadata: ReadonlyArray<AiSearchCustomMetadataField>
): AiSearch.ApiPayload => ({
  id: instance.id,
  ...whenPresent("source", instance.source),
  ...whenPresent("type", instance.type),
  ...whenPresent("ai_gateway_id", instance.ai_gateway_id),
  ...whenPresent("ai_search_model", instance.ai_search_model),
  ...whenPresent("cache", instance.cache),
  ...whenPresent("cache_threshold", instance.cache_threshold),
  ...whenPresent("chunk", instance.chunk),
  ...whenPresent("chunk_overlap", instance.chunk_overlap),
  ...whenPresent("chunk_size", instance.chunk_size),
  ...whenPresent("embedding_model", instance.embedding_model),
  ...whenPresent("index_method", instance.index_method),
  ...whenPresent("fusion_method", instance.fusion_method),
  ...whenPresent("max_num_results", instance.max_num_results),
  ...whenPresent("metadata", instance.metadata),
  ...whenPresent("public_endpoint_params", instance.public_endpoint_params),
  ...whenPresent("reranking", instance.reranking),
  ...whenPresent("reranking_model", instance.reranking_model),
  ...whenPresent("rewrite_model", instance.rewrite_model),
  ...whenPresent("rewrite_query", instance.rewrite_query),
  ...whenPresent("score_threshold", instance.score_threshold),
  ...whenPresent("source_params", instance.source_params),
  custom_metadata: customMetadata.map((field) => ({ ...field }))
});

const reconcileLocalState = async (input: {
  readonly resourceId: string;
  readonly customMetadata: ReadonlyArray<AiSearchCustomMetadataField>;
  readonly stateStore: StateStore;
}): Promise<void> => {
  const existing = await input.stateStore.get(input.resourceId);
  if (existing === undefined) return;
  const existingOutput = existing.output as unknown as
    | (Record<string, unknown> & {
        customMetadata?: ReadonlyArray<AiSearchCustomMetadataField> | null;
      })
    | undefined;
  if (existingOutput === undefined) return;

  const camelMetadata = input.customMetadata.map((field) => ({ ...field }));
  if (fieldsEqual(existingOutput.customMetadata ?? null, camelMetadata)) {
    return;
  }

  const updated: State = {
    ...existing,
    output: {
      ...existingOutput,
      customMetadata: camelMetadata
    } as unknown as State["output"]
  };
  await input.stateStore.set(input.resourceId, updated);
};

// Alchemy 0.93.4 exposes `custom_metadata` in the low-level Cloudflare API
// payload, but not yet on user-facing `AiSearch` props. Keep this bridge until
// upstream exposes a `customMetadata` prop:
// https://github.com/alchemy-run/alchemy/issues?q=AiSearch+custom_metadata
//
// On `up` the wrapper applies missing/divergent metadata via the live API and
// reconciles the local Alchemy state so the resource state file matches reality.
// On `read` it verifies the live instance matches spec; matching live with a
// stale local state file (e.g., `customMetadata: null` left over from creation)
// auto-heals the file. Mismatched live throws so drift is loud.
export const ensureAiSearchCustomMetadataForPhase = async (input: {
  readonly phase: Phase;
  readonly apiOptions?: CloudflareApiOptions;
  readonly resourceId?: string;
  readonly namespace: string;
  readonly instanceName: string;
  readonly customMetadata: ReadonlyArray<AiSearchCustomMetadataField>;
  readonly client?: AiSearchMetadataClient;
  readonly stateStore?: StateStore;
}): Promise<void> => {
  if (input.phase !== "up" && input.phase !== "read") return;

  const client = input.client ?? defaultClient;
  const customMetadata = normalizeFields(input.customMetadata);
  const api = await client.createApi(input.apiOptions);
  const instance = await client.getInstance(
    api,
    input.namespace,
    input.instanceName
  );

  if (!fieldsEqual(instance.custom_metadata, customMetadata)) {
    if (input.phase === "up") {
      await client.updateInstance(
        api,
        input.namespace,
        instance.id,
        updatePayload(instance, customMetadata)
      );
    } else {
      throw new AiSearchCustomMetadataDriftError(
        input.instanceName,
        customMetadata,
        instance.custom_metadata
      );
    }
  }

  if (input.resourceId !== undefined && input.stateStore !== undefined) {
    await reconcileLocalState({
      resourceId: input.resourceId,
      customMetadata,
      stateStore: input.stateStore
    });
  }
};

export const ensureAiSearchCustomMetadata = async (input: {
  readonly apiOptions?: CloudflareApiOptions;
  readonly resourceId?: string;
  readonly namespace: string;
  readonly instanceName: string;
  readonly customMetadata: ReadonlyArray<AiSearchCustomMetadataField>;
}): Promise<void> =>
  ensureAiSearchCustomMetadataForPhase({
    ...input,
    phase: Scope.current.phase,
    stateStore: Scope.current.state
  });
