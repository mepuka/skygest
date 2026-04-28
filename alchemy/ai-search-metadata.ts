import {
  type CloudflareApiOptions,
  createCloudflareApi,
  getAiSearchInstance,
  updateAiSearchInstance,
  type AiSearch
} from "alchemy/cloudflare";
import { Scope, type Phase } from "alchemy";

import {
  MAX_AI_SEARCH_CUSTOM_METADATA_FIELDS,
  type AiSearchCustomMetadataField
} from "../packages/ontology-store/src/Provisioning";

type ExistingAiSearchInstance = Awaited<
  ReturnType<typeof getAiSearchInstance>
>;
type CloudflareApi = Awaited<ReturnType<typeof createCloudflareApi>>;

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
    | undefined,
  right: ReadonlyArray<AiSearchCustomMetadataField>
): boolean => {
  if (left === undefined || left.length !== right.length) return false;
  return left.every(
    (field, index) =>
      field.field_name.toLowerCase() === right[index]?.field_name &&
      field.data_type === right[index]?.data_type
  );
};

const updatePayload = (
  instance: ExistingAiSearchInstance,
  customMetadata: ReadonlyArray<AiSearchCustomMetadataField>
): AiSearch.ApiPayload => ({
  id: instance.id,
  ...(instance.source === undefined ? {} : { source: instance.source }),
  ...(instance.type === undefined ? {} : { type: instance.type }),
  ...(instance.ai_gateway_id === undefined
    ? {}
    : { ai_gateway_id: instance.ai_gateway_id }),
  ...(instance.ai_search_model === undefined
    ? {}
    : { ai_search_model: instance.ai_search_model }),
  ...(instance.cache === undefined ? {} : { cache: instance.cache }),
  ...(instance.cache_threshold === undefined
    ? {}
    : { cache_threshold: instance.cache_threshold }),
  ...(instance.chunk === undefined ? {} : { chunk: instance.chunk }),
  ...(instance.chunk_overlap === undefined
    ? {}
    : { chunk_overlap: instance.chunk_overlap }),
  ...(instance.chunk_size === undefined
    ? {}
    : { chunk_size: instance.chunk_size }),
  ...(instance.embedding_model === undefined
    ? {}
    : { embedding_model: instance.embedding_model }),
  ...(instance.index_method === undefined
    ? {}
    : { index_method: instance.index_method }),
  ...(instance.fusion_method === undefined
    ? {}
    : { fusion_method: instance.fusion_method }),
  ...(instance.max_num_results === undefined
    ? {}
    : { max_num_results: instance.max_num_results }),
  ...(instance.metadata === undefined ? {} : { metadata: instance.metadata }),
  ...(instance.public_endpoint_params === undefined
    ? {}
    : { public_endpoint_params: instance.public_endpoint_params }),
  ...(instance.reranking === undefined ? {} : { reranking: instance.reranking }),
  ...(instance.reranking_model === undefined
    ? {}
    : { reranking_model: instance.reranking_model }),
  ...(instance.rewrite_model === undefined
    ? {}
    : { rewrite_model: instance.rewrite_model }),
  ...(instance.rewrite_query === undefined
    ? {}
    : { rewrite_query: instance.rewrite_query }),
  ...(instance.score_threshold === undefined
    ? {}
    : { score_threshold: instance.score_threshold }),
  ...(instance.source_params === undefined
    ? {}
    : { source_params: instance.source_params }),
  custom_metadata: customMetadata.map((field) => ({ ...field }))
});

// Alchemy 0.93.4 exposes `custom_metadata` in the low-level Cloudflare API
// payload, but not yet on user-facing `AiSearch` props. Keep this bridge until
// upstream exposes a `customMetadata` prop:
// https://github.com/alchemy-run/alchemy/issues?q=AiSearch+custom_metadata
export const ensureAiSearchCustomMetadataForPhase = async (input: {
  readonly phase: Phase;
  readonly apiOptions?: CloudflareApiOptions;
  readonly namespace: string;
  readonly instanceName: string;
  readonly customMetadata: ReadonlyArray<AiSearchCustomMetadataField>;
  readonly client?: AiSearchMetadataClient;
}): Promise<void> => {
  if (input.phase !== "up") return;

  const client = input.client ?? defaultClient;
  const customMetadata = normalizeFields(input.customMetadata);
  const api = await client.createApi(input.apiOptions);
  const instance = await client.getInstance(
    api,
    input.namespace,
    input.instanceName
  );

  if (fieldsEqual(instance.custom_metadata, customMetadata)) return;

  await client.updateInstance(
    api,
    input.namespace,
    instance.id,
    updatePayload(instance, customMetadata)
  );
};

export const ensureAiSearchCustomMetadata = async (input: {
  readonly apiOptions?: CloudflareApiOptions;
  readonly namespace: string;
  readonly instanceName: string;
  readonly customMetadata: ReadonlyArray<AiSearchCustomMetadataField>;
}): Promise<void> =>
  ensureAiSearchCustomMetadataForPhase({
    ...input,
    phase: Scope.current.phase
  });
