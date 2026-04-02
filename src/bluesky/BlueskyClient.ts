import {
  Cache,
  Clock,
  ServiceMap,
  Duration,
  Effect,
  Layer,
  Schedule,
  Schema,
  Semaphore,
  SynchronizedRef
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { BlueskyApiError } from "../domain/errors";
import { AppConfig } from "../platform/Config";
import { stringifyUnknown } from "../platform/Json";
import type { BlueskyProfile, ResolvedDidOrHandle } from "../domain/bi";
import { parseAvatarUrl } from "./BskyCdn";
import {
  type ListRecordsResult as ListRecordsResultShape,
  type ServiceListRecordsInput,
  ListRecordsResult,
} from "../domain/polling";
import { AtUri, Did } from "../domain/types";
import { GetPostThreadResponse, GetPostsResponse, type ThreadPostView } from "./ThreadTypes";

const FollowsResponse = Schema.Struct({
  cursor: Schema.optionalKey(Schema.String),
  follows: Schema.Array(Schema.Struct({
    did: Schema.String,
    handle: Schema.optionalKey(Schema.String)
  }))
});

const ResolveHandleResponse = Schema.Struct({
  did: Did
});

const ResolveIdentityResponse = Schema.Struct({
  did: Did,
  handle: Schema.optionalKey(Schema.String),
  didDoc: Schema.optionalKey(Schema.Unknown)
});

export const ProfileResponse = Schema.Struct({
  did: Did,
  handle: Schema.optionalKey(Schema.String),
  displayName: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  avatar: Schema.optionalKey(Schema.String)
});

const RepoServiceEntry = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  serviceEndpoint: Schema.optionalKey(Schema.String)
});

const DidDocument = Schema.Struct({
  service: Schema.optionalKey(Schema.Array(RepoServiceEntry))
});

const getErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }

  if (
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    typeof error.response.status === "number"
  ) {
    return error.response.status;
  }

  return undefined;
};

const toBlueskyApiError = (error: unknown) => {
  const status = getErrorStatus(error);
  return new BlueskyApiError({
    message: stringifyUnknown(error),
    ...(status !== undefined ? { status } : {})
  });
};

export const isRetryableBlueskyError = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("_tag" in error && error._tag === "RequestError" && "reason" in error) {
    return error.reason === "Transport";
  }

  const status = getErrorStatus(error);
  if (typeof status === "number") {
    return status === 429 || (status >= 500 && status < 600);
  }

  return false;
};

export const normalizeServiceUrl = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`expected https service URL, received: ${value}`);
  }
  return url.origin.replace(/\/+$/u, "");
};

export const extractPdsServiceUrl = (didDoc: unknown): string => {
  const decoded = Schema.decodeUnknownSync(DidDocument)(didDoc);
  const service = decoded.service?.find((entry) =>
    typeof entry.serviceEndpoint === "string" &&
    (entry.type === "AtprotoPersonalDataServer" || entry.id === "#atproto_pds")
  );

  if (!service?.serviceEndpoint) {
    throw new Error("ATProto PDS service endpoint not found in didDoc");
  }

  return normalizeServiceUrl(service.serviceEndpoint);
};

type HostGate = {
  readonly semaphore: Semaphore.Semaphore;
  readonly lastCompletedAt: SynchronizedRef.SynchronizedRef<number>;
};

export class BlueskyClient extends ServiceMap.Service<
  BlueskyClient,
  {
    readonly resolveDidOrHandle: (
      didOrHandle: string
    ) => Effect.Effect<ResolvedDidOrHandle, BlueskyApiError>;
    readonly getProfile: (
      didOrHandle: string
    ) => Effect.Effect<BlueskyProfile, BlueskyApiError>;
    readonly getFollows: (
      did: string,
      cursor: string | null,
      limit: number
    ) => Effect.Effect<{
      readonly dids: ReadonlyArray<string>;
      readonly cursor: string | null;
    }, BlueskyApiError>;
    readonly resolveRepoService: (
      did: string
    ) => Effect.Effect<string, BlueskyApiError>;
    readonly listRecordsAtService: (
      input: ServiceListRecordsInput
    ) => Effect.Effect<ListRecordsResultShape, BlueskyApiError>;
    readonly getPostThread: (
      uri: string,
      opts?: { depth?: number; parentHeight?: number }
    ) => Effect.Effect<GetPostThreadResponse, BlueskyApiError>;
    readonly getPosts: (
      uris: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<ThreadPostView>, BlueskyApiError>;
  }
>()("@skygest/BlueskyClient") {}

export const makeBlueskyClient = (base: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const minInterval = Duration.toMillis(Duration.millis(250));
    const retrySchedule = Schedule.exponential(Duration.millis(250)).pipe(
      Schedule.jittered,
      Schedule.both(Schedule.recurs(5))
    );

    const hostGates = yield* Cache.make({
      capacity: 64,
      timeToLive: Duration.infinity,
      lookup: () =>
        Effect.all([
          Semaphore.make(1),
          SynchronizedRef.make(-minInterval)
        ]).pipe(
          Effect.map(([semaphore, lastCompletedAt]) => ({
            semaphore,
            lastCompletedAt
          }) satisfies HostGate)
        )
    });

    const withRateLimit = <A, E, R>(url: string, effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const gate = yield* Cache.get(hostGates, new URL(url).host);

        return yield* gate.semaphore.withPermits(1)(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const lastCompletedAt = yield* SynchronizedRef.get(gate.lastCompletedAt);
            const waitMs = Math.max(0, minInterval - (now - lastCompletedAt));
            if (waitMs > 0) {
              yield* Effect.sleep(Duration.millis(waitMs));
            }

            return yield* effect;
          }).pipe(
            Effect.ensuring(
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((now) => SynchronizedRef.set(gate.lastCompletedAt, now))
              )
            )
          )
        );
      });

    const requestJson = <S extends Schema.Top>(
      url: string,
      schema: S,
      params?: Record<string, string | ReadonlyArray<string> | undefined>
    ) =>
      withRateLimit(
        url,
        http.get(url, { urlParams: params }).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema))
        )
      ).pipe(
        Effect.retry({ schedule: retrySchedule, while: isRetryableBlueskyError }),
        Effect.mapError(toBlueskyApiError)
      );

    const getProfile = (didOrHandle: string) =>
      requestJson(
        `${base}/xrpc/app.bsky.actor.getProfile`,
        ProfileResponse,
        {
          actor: didOrHandle
        }
      ).pipe(
        Effect.map((body) => ({
          did: body.did,
          handle: body.handle ?? null,
          displayName: body.displayName ?? null,
          description: body.description ?? null,
          avatar: body.avatar ? parseAvatarUrl(body.avatar) : null
        }))
      );

    const resolveDidOrHandle = (didOrHandle: string) =>
      didOrHandle.startsWith("did:")
        ? getProfile(didOrHandle).pipe(
          Effect.map(({ did, handle }) => ({ did, handle }))
        )
        : requestJson(
          `${base}/xrpc/com.atproto.identity.resolveHandle`,
          ResolveHandleResponse,
          {
            handle: didOrHandle
          }
        ).pipe(
          Effect.map((body) => ({
            did: body.did,
            handle: null
          }))
        );

    const getFollows = (did: string, cursor: string | null, limit: number) =>
      requestJson(
        `${base}/xrpc/app.bsky.graph.getFollows`,
        FollowsResponse,
        {
          actor: did,
          cursor: cursor ?? undefined,
          limit: String(limit)
        }
      ).pipe(
        Effect.map((body) => ({
          dids: body.follows.map((follow) => follow.did),
          cursor: body.cursor ?? null
        }))
      );

    const resolveRepoService = (did: string) =>
      withRateLimit(
        "https://plc.directory",
        http.get(`https://plc.directory/${encodeURIComponent(did)}`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(DidDocument))
        )
      ).pipe(
        Effect.retry({ schedule: retrySchedule, while: isRetryableBlueskyError }),
        Effect.mapError(toBlueskyApiError),
        Effect.flatMap((doc) =>
          Effect.try({
            try: () => extractPdsServiceUrl(doc),
            catch: toBlueskyApiError
          })
        )
      );

    const listRecordsAtService = (input: ServiceListRecordsInput) =>
      requestJson(
        `${input.serviceUrl}/xrpc/com.atproto.repo.listRecords`,
        ListRecordsResult,
        {
          repo: input.repo,
          collection: input.collection,
          cursor: input.cursor,
          limit: String(input.limit),
          reverse: input.reverse === true ? "true" : undefined
        }
      );

    const getPostThread = (uri: string, opts?: { depth?: number; parentHeight?: number }) =>
      requestJson(
        `${base}/xrpc/app.bsky.feed.getPostThread`,
        GetPostThreadResponse,
        {
          uri,
          depth: String(opts?.depth ?? 6),
          parentHeight: String(opts?.parentHeight ?? 80)
        }
      );

    const getPosts = (uris: ReadonlyArray<string>) =>
      uris.length === 0
        ? Effect.succeed([])
        : requestJson(
            `${base}/xrpc/app.bsky.feed.getPosts`,
            GetPostsResponse,
            {
              uris: Array.from(uris)
            }
          ).pipe(
            Effect.map((body) => body.posts)
          );

    return {
      resolveDidOrHandle,
      getProfile,
      getFollows,
      resolveRepoService,
      listRecordsAtService,
      getPostThread,
      getPosts
    };
  });

export const layer = Layer.effect(
  BlueskyClient,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    return yield* makeBlueskyClient(cfg.publicApi);
  })
).pipe(Layer.provide(FetchHttpClient.layer));
