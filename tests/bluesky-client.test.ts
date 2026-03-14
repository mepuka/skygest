import {
  Clock,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
  TestClock
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import { HttpClient, HttpClientResponse } from "@effect/platform";
import { makeBlueskyClient } from "../src/bluesky/BlueskyClient";
import { Did } from "../src/domain/types";

const decodeDid = Schema.decodeUnknownSync(Did);
const repo = decodeDid("did:plc:expert-a");

const jsonResponse = (request: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    })
  );

const makeHttpLayer = (
  handler: Parameters<typeof HttpClient.make>[0]
) => Layer.succeed(HttpClient.HttpClient, HttpClient.make(handler));

describe("BlueskyClient", () => {
  it.effect("serializes same-host requests and enforces the minimum gap", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make<Array<number>>([]);
      const started = yield* Deferred.make<void>();
      const layer = makeHttpLayer((request, url) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const isFirst = yield* Ref.modify(
            starts,
            (times) => [times.length === 0, times.concat(now)] as const
          );
          if (isFirst) {
            yield* Deferred.complete(started, Effect.void);
          }

          return jsonResponse(request, {
            did: url.searchParams.get("actor") ?? "did:plc:missing",
            handle: "seed.example.com",
            displayName: "Seed Expert",
            description: "Seed profile"
          });
        })
      );

      const program = Effect.gen(function* () {
        const client = yield* makeBlueskyClient("https://public.api.bsky.app");

        return yield* Effect.all([
          client.getProfile("did:plc:expert-a"),
          client.getProfile("did:plc:expert-b")
        ], {
          concurrency: "unbounded"
        });
      }).pipe(Effect.provide(layer));

      const fiber = yield* Effect.fork(program);

      yield* Deferred.await(started);

      expect((yield* Ref.get(starts))).toHaveLength(1);

      yield* TestClock.adjust("250 millis");
      yield* Fiber.join(fiber);

      const observed = yield* Ref.get(starts);
      expect(observed).toHaveLength(2);
      expect(observed[1]! - observed[0]!).toBe(250);
    })
  );

  it.effect("does not pace requests across different hosts", () =>
    Effect.gen(function* () {
      const starts = yield* Ref.make<Array<{ readonly host: string; readonly at: number }>>([]);
      const started = yield* Deferred.make<void>();
      const layer = makeHttpLayer((request, url) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const count = yield* Ref.modify(
            starts,
            (times) => {
              const updated = times.concat({
                host: url.host,
                at: now
              });
              return [updated.length, updated] as const;
            }
          );
          if (count === 2) {
            yield* Deferred.complete(started, Effect.void);
          }

          return jsonResponse(request, {
            records: [],
            cursor: null
          });
        })
      );

      const fiber = yield* Effect.fork(
        Effect.gen(function* () {
          const client = yield* makeBlueskyClient("https://public.api.bsky.app");

          return yield* Effect.all([
            client.listRecordsAtService({
              serviceUrl: "https://pds-a.example.com",
              repo,
              collection: "app.bsky.feed.post",
              limit: 1,
              reverse: true
            }),
            client.listRecordsAtService({
              serviceUrl: "https://pds-b.example.com",
              repo,
              collection: "app.bsky.feed.post",
              limit: 1,
              reverse: true
            })
          ], {
            concurrency: "unbounded"
          });
        }).pipe(Effect.provide(layer))
      );

      yield* Deferred.await(started);
      yield* Fiber.join(fiber);

      const observed = yield* Ref.get(starts);
      expect(observed).toHaveLength(2);
      expect(new Set(observed.map((entry) => entry.host))).toEqual(
        new Set(["pds-a.example.com", "pds-b.example.com"])
      );
      expect(new Set(observed.map((entry) => entry.at))).toHaveLength(1);
    })
  );

  it.effect("retries on transient HTTP failures under TestClock", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const started = yield* Deferred.make<void>();
      const layer = makeHttpLayer((request) =>
        Ref.modify(
          attempts,
          (count) => {
            const next = count + 1;
            return [next, next] as const;
          }
        ).pipe(
          Effect.tap((attempt) =>
            attempt === 1
              ? Deferred.complete(started, Effect.void).pipe(Effect.asVoid)
              : Effect.void
          ),
          Effect.flatMap((attempt) =>
            attempt < 3
              ? Effect.succeed(
                  HttpClientResponse.fromWeb(
                    request,
                    new Response("service unavailable", { status: 503 })
                  )
                )
              : Effect.succeed(jsonResponse(request, {
                  did: "did:plc:expert-a",
                  handle: "seed.example.com",
                  displayName: "Seed Expert",
                  description: "Seed profile"
                }))
          )
        )
      );

      const program = Effect.gen(function* () {
        const client = yield* makeBlueskyClient("https://public.api.bsky.app");
        return yield* client.getProfile("did:plc:expert-a");
      }).pipe(
        Effect.provide(layer),
        Effect.withRandomFixed([0])
      );

      const fiber = yield* Effect.fork(program);

      yield* Deferred.await(started);

      expect(yield* Ref.get(attempts)).toBe(1);
      expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);

      yield* TestClock.adjust("5 seconds");

      const profile = yield* Fiber.join(fiber);

      expect(profile.did).toBe("did:plc:expert-a");
      expect(yield* Ref.get(attempts)).toBe(3);
    })
  );

  it.effect("preserves HTTP status from non-2xx responses", () =>
    Effect.gen(function* () {
      const layer = makeHttpLayer((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify({ error: "not found" }), {
              status: 404,
              headers: { "content-type": "application/json" }
            })
          )
        )
      );

      const error = yield* Effect.gen(function* () {
        const client = yield* makeBlueskyClient("https://public.api.bsky.app");
        return yield* client.getProfile("did:plc:nonexistent");
      }).pipe(
        Effect.provide(layer),
        Effect.withRandomFixed([0]),
        Effect.flip
      );

      expect(error._tag).toBe("BlueskyApiError");
      expect(error.status).toBe(404);
    })
  );

  it.effect("fails at the client boundary for invalid repo record payloads", () =>
    Effect.gen(function* () {
      const layer = makeHttpLayer((request) =>
        Effect.succeed(
          jsonResponse(request, {
            records: [
              {
                uri: "at://did:plc:expert-a/app.bsky.feed.post/abc123",
                cid: "cid-1",
                value: {
                  text: "missing createdAt"
                }
              }
            ],
            cursor: null
          })
        )
      );

      const error = yield* Effect.gen(function* () {
        const client = yield* makeBlueskyClient("https://public.api.bsky.app");
        return yield* client.listRecordsAtService({
          serviceUrl: "https://pds-a.example.com",
          repo,
          collection: "app.bsky.feed.post",
          limit: 1,
          reverse: true
        });
      }).pipe(
        Effect.provide(layer),
        Effect.flip
      );

      expect(error._tag).toBe("BlueskyApiError");
      expect(error.message).toContain("createdAt");
      expect(error.status).toBeUndefined();
    })
  );
});
