import {
  Cache,
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Schedule,
  Schema,
  SynchronizedRef
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "@effect/platform";
import { BlueskyApiError } from "../domain/errors";
import { AppConfig } from "../platform/Config";
import { stringifyUnknown } from "../platform/Json";
import type { BlueskyProfile, ResolvedDidOrHandle } from "../domain/bi";
import {
  type ListRecordsResult as ListRecordsResultShape,
  type ServiceListRecordsInput,
  ListRecordsResult,
} from "../domain/polling";
import { AtUri, Did } from "../domain/types";

const FollowsResponse = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  follows: Schema.Array(Schema.Struct({
    did: Schema.String,
    handle: Schema.optional(Schema.String)
  }))
});

const ResolveHandleResponse = Schema.Struct({
  did: Did
});

const ResolveIdentityResponse = Schema.Struct({
  did: Did,
  handle: Schema.optional(Schema.String),
  didDoc: Schema.optional(Schema.Unknown)
});

export const ProfileResponse = Schema.Struct({
  did: Did,
  handle: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String)
});

const RepoServiceEntry = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  serviceEndpoint: Schema.optional(Schema.String)
});

const DidDocument = Schema.Struct({
  service: Schema.optional(Schema.Array(RepoServiceEntry))
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

const toBlueskyApiError = (error: unknown) =>
  BlueskyApiError.make({
    message: stringifyUnknown(error),
    status: getErrorStatus(error)
  });

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
  readonly semaphore: Effect.Semaphore;
  readonly lastCompletedAt: SynchronizedRef.SynchronizedRef<number>;
};

export class BlueskyClient extends Context.Tag("@skygest/BlueskyClient")<
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
  }
>() {}

export const makeBlueskyClient = (base: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const minInterval = Duration.toMillis(Duration.millis(250));
    const retrySchedule = Schedule.exponential(Duration.millis(250)).pipe(
      Schedule.jittered,
      Schedule.intersect(Schedule.recurWhile(isRetryableBlueskyError)),
      Schedule.intersect(Schedule.recurs(5))
    );

    const hostGates = yield* Cache.make({
      capacity: 64,
      timeToLive: Duration.infinity,
      lookup: () =>
        Effect.all([
          Effect.makeSemaphore(1),
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
        const gate = yield* hostGates.get(new URL(url).host);

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

    const requestJson = <A, I>(
      url: string,
      schema: Schema.Schema<A, I, never>,
      urlParams?: Record<string, string | undefined>
    ) =>
      withRateLimit(
        url,
        http.get(url, { urlParams }).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema))
        )
      ).pipe(
        Effect.retry(retrySchedule),
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
          description: body.description ?? null
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
        Effect.retry(retrySchedule),
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

    return BlueskyClient.of({
      resolveDidOrHandle,
      getProfile,
      getFollows,
      resolveRepoService,
      listRecordsAtService
    });
  });

export const layer = Layer.effect(
  BlueskyClient,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    return yield* makeBlueskyClient(cfg.publicApi);
  })
).pipe(Layer.provide(FetchHttpClient.layer));
