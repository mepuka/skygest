import {
  Cause,
  Duration,
  Effect,
  Layer,
  Schedule,
  Schema,
  ServiceMap
} from "effect";

import { AiSearchError } from "../Domain/Errors";
import {
  ENTITY_METADATA_FIELDS,
  type EntityMetadata,
  type ProjectionContract,
  type ProjectionRuntimeAdapter,
  ProjectionWriteError
} from "../Domain/Projection";

export const DEFAULT_ENTITY_SEARCH_INSTANCE = "entity-search";

export type AiSearchMetadataValue = string | number | boolean;
export type AiSearchMetadata = Readonly<Record<string, AiSearchMetadataValue>>;

export interface AiSearchItemInfo {
  readonly id: string;
  readonly key: string;
  readonly status?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AiSearchListItemsParams {
  readonly page?: number;
  readonly per_page?: number;
}

export interface AiSearchListItemsResponse {
  readonly result: ReadonlyArray<AiSearchItemInfo>;
  readonly result_info?: {
    readonly count: number;
    readonly page: number;
    readonly per_page: number;
    readonly total_count: number;
  };
}

export interface AiSearchItemsBinding {
  readonly list: (
    params?: AiSearchListItemsParams
  ) => Promise<AiSearchListItemsResponse>;
  readonly upload: (
    name: string,
    content: string,
    options?: { readonly metadata?: AiSearchMetadata }
  ) => Promise<AiSearchItemInfo>;
  readonly delete: (itemId: string) => Promise<void>;
}

export interface AiSearchSearchRequest {
  readonly messages: ReadonlyArray<{
    readonly role: "system" | "developer" | "user" | "assistant" | "tool";
    readonly content: string | null;
  }>;
  readonly ai_search_options?: {
    readonly retrieval?: {
      readonly retrieval_type?: "vector" | "keyword" | "hybrid";
      readonly match_threshold?: number;
      readonly max_num_results?: number;
      readonly filters?: Readonly<Record<string, unknown>>;
      readonly context_expansion?: number;
    };
    readonly query_rewrite?: {
      readonly enabled?: boolean;
    };
    readonly reranking?: {
      readonly enabled?: boolean;
      readonly model?: string;
      readonly match_threshold?: number;
    };
  };
}

export interface AiSearchSearchResponse {
  readonly search_query: string;
  readonly chunks: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly score: number;
    readonly text: string;
    readonly item: {
      readonly key: string;
      readonly timestamp?: number;
      readonly metadata?: Readonly<Record<string, unknown>>;
    };
  }>;
}

export interface AiSearchInstanceBinding {
  readonly search: (
    params: AiSearchSearchRequest
  ) => Promise<AiSearchSearchResponse>;
  readonly items: AiSearchItemsBinding;
}

export interface AiSearchNamespaceBinding {
  readonly get: (name: string) => AiSearchInstanceBinding;
}

export interface EntitySearchFilter {
  readonly entity_type?: ReadonlyArray<string>;
  readonly iri?: ReadonlyArray<string>;
  readonly topic?: ReadonlyArray<string>;
  readonly authority?: ReadonlyArray<string>;
  readonly time_bucket?: ReadonlyArray<string>;
}

export interface EntitySearchInput {
  readonly query: string;
  readonly filters?: EntitySearchFilter;
  readonly maxResults?: number;
  readonly scoreThreshold?: number;
  readonly retrievalType?: "vector" | "keyword" | "hybrid";
  readonly rewriteQuery?: boolean;
  readonly rerank?: boolean;
}

export interface EntitySearchResult {
  readonly entityType: string;
  readonly iri: string;
  readonly key: string;
  readonly score: number;
  readonly text: string;
  readonly metadata: EntityMetadata;
}

export class EntitySearchResultDecodeError extends Schema.TaggedErrorClass<EntitySearchResultDecodeError>()(
  "EntitySearchResultDecodeError",
  {
    key: Schema.String,
    message: Schema.String
  }
) {}

const AI_SEARCH_REQUEST_TIMEOUT = Duration.seconds(10);
const AI_SEARCH_RETRY_SCHEDULE = Schedule.exponential(
  Duration.millis(250)
).pipe(Schedule.jittered, Schedule.both(Schedule.recurs(3)));

const messageFromUnknown = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const readNumberProperty = (
  value: unknown,
  keys: ReadonlyArray<string>
): number | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number") return candidate;
  }
  return undefined;
};

const extractStatus = (cause: unknown): number | undefined => {
  const direct = readNumberProperty(cause, ["status", "statusCode"]);
  if (direct !== undefined) return direct;
  if (typeof cause === "object" && cause !== null) {
    const response = (cause as Record<string, unknown>).response;
    const nested = readNumberProperty(response, ["status", "statusCode"]);
    if (nested !== undefined) return nested;
  }
  const match = messageFromUnknown(cause).match(/\b(429|500|502|503|504)\b/);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

const parseRetryAfter = (value: unknown): number | undefined => {
  if (typeof value === "number") return Math.max(0, value);
  if (typeof value !== "string") return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : undefined;
};

const extractRetryAfterMs = (cause: unknown): number | undefined => {
  const direct = readNumberProperty(cause, ["retryAfterMs"]);
  if (direct !== undefined) return direct;
  if (typeof cause !== "object" || cause === null) return undefined;
  const record = cause as Record<string, unknown>;
  const retryAfter = parseRetryAfter(record.retryAfter);
  if (retryAfter !== undefined) return retryAfter;
  const response = record.response;
  if (typeof response !== "object" || response === null) return undefined;
  const headers = (response as Record<string, unknown>).headers;
  if (typeof headers !== "object" || headers === null) return undefined;
  const get = (headers as { readonly get?: (name: string) => unknown }).get;
  return typeof get === "function"
    ? parseRetryAfter(get.call(headers, "Retry-After"))
    : undefined;
};

const aiSearchError = (
  operation: "upload" | "search" | "get" | "delete",
  instance: string,
  cause: unknown,
  key?: string
): AiSearchError => {
  const status = extractStatus(cause);
  const retryAfterMs = extractRetryAfterMs(cause);
  return new AiSearchError({
    operation,
    instance,
    message: messageFromUnknown(cause),
    ...(status === undefined ? {} : { status }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(key === undefined ? {} : { key })
  });
};

const isRetryableAiSearchError = (error: AiSearchError): boolean =>
  error.status === 429 ||
  error.status === 500 ||
  error.status === 502 ||
  error.status === 503 ||
  error.status === 504 ||
  /timeout|temporar|unavailable|rate limit/i.test(error.message);

const retryAfterDelay = (error: AiSearchError): Effect.Effect<void> =>
  error.retryAfterMs === undefined || error.retryAfterMs <= 0
    ? Effect.void
    : Effect.sleep(Duration.millis(error.retryAfterMs));

const withReliability = <A>(
  operation: "upload" | "search" | "get" | "delete",
  instanceName: string,
  key: string | undefined,
  effect: Effect.Effect<A, AiSearchError>
): Effect.Effect<A, AiSearchError> =>
  effect.pipe(
    Effect.timeout(AI_SEARCH_REQUEST_TIMEOUT),
    Effect.mapError((error) =>
      Cause.isTimeoutError(error)
        ? aiSearchError(
            operation,
            instanceName,
            new Error("AI Search request timed out"),
            key
          )
        : error
    ),
    Effect.tapError((error) =>
      isRetryableAiSearchError(error) ? retryAfterDelay(error) : Effect.void
    ),
    Effect.retry({
      schedule: AI_SEARCH_RETRY_SCHEDULE,
      while: isRetryableAiSearchError
    })
  );

const tryAiSearchPromise = <A>(
  operation: "upload" | "search" | "get" | "delete",
  instanceName: string,
  key: string | undefined,
  evaluate: () => Promise<A>
): Effect.Effect<A, AiSearchError> =>
  withReliability(
    operation,
    instanceName,
    key,
    Effect.tryPromise({
      try: evaluate,
      catch: (cause) => aiSearchError(operation, instanceName, cause, key)
    })
  );

const uploadItem = (
  instanceName: string,
  instance: AiSearchInstanceBinding,
  key: string,
  body: string,
  metadata: AiSearchMetadata
) =>
  tryAiSearchPromise("upload", instanceName, key, () =>
    instance.items.upload(key, body, { metadata })
  ).pipe(Effect.asVoid);

const listAllItems = (
  instanceName: string,
  instance: AiSearchInstanceBinding
): Effect.Effect<ReadonlyArray<AiSearchItemInfo>, AiSearchError> =>
  Effect.gen(function* () {
    const perPage = 100;
    let page = 1;
    const items: Array<AiSearchItemInfo> = [];
    while (true) {
      const response = yield* tryAiSearchPromise(
        "get",
        instanceName,
        undefined,
        () => instance.items.list({ page, per_page: perPage })
      );
      items.push(...response.result);
      const info = response.result_info;
      if (info === undefined) {
        if (response.result.length < perPage) break;
        page += 1;
        continue;
      }
      const totalPages = Math.ceil(info.total_count / info.per_page);
      if (info.page >= totalPages || response.result.length === 0) break;
      page = info.page + 1;
    }
    return items;
  });

const deleteItemsMatching = (
  instanceName: string,
  instance: AiSearchInstanceBinding,
  matches: (item: AiSearchItemInfo) => boolean
) =>
  Effect.gen(function* () {
    const items = yield* listAllItems(instanceName, instance);
    const matched = items.filter(matches);
    yield* Effect.forEach(
      matched,
      (item) =>
        Effect.tryPromise({
          try: () => instance.items.delete(item.id),
          catch: (cause) => aiSearchError("delete", instanceName, cause, item.key)
        }).pipe(
          (effect) => withReliability("delete", instanceName, item.key, effect)
        ),
      { discard: true }
    );
  });

const filterValue = (
  values: ReadonlyArray<string> | undefined
): unknown | undefined => {
  if (values === undefined || values.length === 0) return undefined;
  return values.length === 1 ? { $eq: values[0] } : { $in: [...values] };
};

const buildFilters = (
  filter: EntitySearchFilter | undefined
): Readonly<Record<string, unknown>> | undefined => {
  if (filter === undefined) return undefined;
  const filters: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(filter)) {
    const built = filterValue(values);
    if (built !== undefined) filters[key] = built;
  }
  return Object.keys(filters).length === 0 ? undefined : filters;
};

const toSearchRequest = (input: EntitySearchInput): AiSearchSearchRequest => {
  const filters = buildFilters(input.filters);
  const retrieval: NonNullable<
    NonNullable<AiSearchSearchRequest["ai_search_options"]>["retrieval"]
  > = {
    retrieval_type: input.retrievalType ?? "hybrid",
    match_threshold: input.scoreThreshold ?? 0.3,
    max_num_results: input.maxResults ?? 10,
    ...(filters === undefined ? {} : { filters })
  };
  return {
    messages: [{ role: "user", content: input.query }],
    ai_search_options: {
      retrieval,
      query_rewrite: {
        enabled: input.rewriteQuery ?? true
      },
      reranking: {
        enabled: input.rerank ?? true
      }
    }
  };
};

const decodeMetadata = (
  key: string,
  metadata: Readonly<Record<string, unknown>> | undefined
): Effect.Effect<EntityMetadata, EntitySearchResultDecodeError> =>
  Effect.gen(function* () {
    if (metadata === undefined) {
      return yield* new EntitySearchResultDecodeError({
        key,
        message: "AI Search chunk is missing entity metadata"
      });
    }
    const entityType = metadata.entity_type;
    const iri = metadata.iri;
    if (typeof entityType !== "string" || typeof iri !== "string") {
      return yield* new EntitySearchResultDecodeError({
        key,
        message: "AI Search chunk metadata must include string entity_type and iri"
      });
    }
    const decoded: Record<string, string> = {};
    for (const field of ENTITY_METADATA_FIELDS) {
      const value = metadata[field.field_name];
      if (typeof value !== "string") {
        return yield* new EntitySearchResultDecodeError({
          key,
          message: `AI Search chunk metadata field ${field.field_name} must be a string`
        });
      }
      decoded[field.field_name] = value;
    }
    return decoded as EntityMetadata;
  });

export class AiSearchClient extends ServiceMap.Service<
  AiSearchClient,
  {
    readonly upload: (
      instanceName: string,
      key: string,
      body: string,
      metadata: AiSearchMetadata
    ) => Effect.Effect<void, AiSearchError>;
    readonly deleteByIri: (
      instanceName: string,
      iri: string
    ) => Effect.Effect<void, AiSearchError>;
    readonly deleteByKey: (
      instanceName: string,
      key: string
    ) => Effect.Effect<void, AiSearchError>;
    readonly search: (
      instanceName: string,
      request: AiSearchSearchRequest
    ) => Effect.Effect<AiSearchSearchResponse, AiSearchError>;
  }
>()("@skygest/ontology-store/AiSearchClient") {
  static layer(
    namespace: AiSearchNamespaceBinding
  ): Layer.Layer<AiSearchClient> {
    return Layer.succeed(AiSearchClient, makeAiSearchClient(namespace));
  }
}

export const makeAiSearchClient = (
  namespace: AiSearchNamespaceBinding
): (typeof AiSearchClient)["Service"] =>
  AiSearchClient.of({
    upload: (instanceName, key, body, metadata) =>
      uploadItem(instanceName, namespace.get(instanceName), key, body, metadata),
    deleteByIri: (instanceName, iri) =>
      deleteItemsMatching(instanceName, namespace.get(instanceName), (item) =>
        item.metadata?.iri === iri
      ),
    deleteByKey: (instanceName, key) =>
      deleteItemsMatching(
        instanceName,
        namespace.get(instanceName),
        (item) => item.key === key
      ),
    search: (instanceName, request) =>
      tryAiSearchPromise("search", instanceName, undefined, () =>
        namespace.get(instanceName).search(request)
      )
  });

type AnyProjectionContract = {
  readonly entityType: string;
  readonly toKey: (entity: any) => string;
  readonly toBody: (entity: any) => string;
  readonly toMetadata: (
    entity: any
  ) => Readonly<Record<string, string | number | boolean>>;
  readonly previousKeys?: (entity: any) => ReadonlyArray<string>;
};
type ProjectionContractEntity<C> =
  C extends { readonly toKey: (entity: infer Entity) => string }
    ? Entity
    : never;
type ProjectionContractMetadata<C> =
  C extends { readonly toMetadata: (entity: any) => infer Meta }
    ? Meta
    : never;

export const makeAiSearchAdapter = <Contract extends AnyProjectionContract>(
  contract: Contract,
  options?: { readonly instanceName?: string }
): Effect.Effect<
  ProjectionRuntimeAdapter<
    ProjectionContractEntity<Contract>,
    ProjectionContractMetadata<Contract>
  >,
  never,
  AiSearchClient
> =>
  Effect.gen(function* () {
    const client = yield* AiSearchClient;
    const instanceName = options?.instanceName ?? DEFAULT_ENTITY_SEARCH_INSTANCE;
    const upsert = (entity: ProjectionContractEntity<Contract>) =>
      client
        .upload(
          instanceName,
          contract.toKey(entity),
          contract.toBody(entity),
          contract.toMetadata(entity)
        )
        .pipe(
          Effect.mapError(
            (cause) => new ProjectionWriteError({ op: "upsert", cause })
          )
        );
    return {
      upsert,
      delete: (iri) =>
        client.deleteByIri(instanceName, iri).pipe(
          Effect.mapError(
            (cause) => new ProjectionWriteError({ op: "delete", cause })
          )
        ),
      rename: (entity) =>
        Effect.gen(function* () {
          for (const key of contract.previousKeys?.(entity) ?? []) {
            yield* client.deleteByKey(instanceName, key);
          }
          yield* client.upload(
            instanceName,
            contract.toKey(entity),
            contract.toBody(entity),
            contract.toMetadata(entity)
          );
        }).pipe(
          Effect.mapError(
            (cause) => new ProjectionWriteError({ op: "rename", cause })
          )
        )
    };
  });

export class EntitySearchService extends ServiceMap.Service<
  EntitySearchService,
  {
    readonly search: (
      input: EntitySearchInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchResult>,
      AiSearchError | EntitySearchResultDecodeError
    >;
  }
>()("@skygest/ontology-store/EntitySearchService") {
  static readonly layer = Layer.effect(
    EntitySearchService,
    Effect.gen(function* () {
      const client = yield* AiSearchClient;
      const search = (input: EntitySearchInput) =>
        Effect.gen(function* () {
          const response = yield* client.search(
            DEFAULT_ENTITY_SEARCH_INSTANCE,
            toSearchRequest(input)
          );
          return yield* Effect.forEach(response.chunks, (chunk) =>
            Effect.gen(function* () {
              const metadata = yield* decodeMetadata(
                chunk.item.key,
                chunk.item.metadata
              );
              return {
                entityType: metadata.entity_type,
                iri: metadata.iri,
                key: chunk.item.key,
                score: chunk.score,
                text: chunk.text,
                metadata
              };
            })
          );
        });
      return EntitySearchService.of({ search });
    })
  );
}
