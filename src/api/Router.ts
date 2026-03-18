import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import { Effect, Layer } from "effect";
import { makeQueryLayer } from "../edge/Layer";
import type {
  KnowledgeLinkResult,
  KnowledgePostResult,
  PostThreadOutput as PostThreadOutputShape,
  ThreadPostPosition as ThreadPostPositionShape,
  ThreadPostResult as ThreadPostResultShape
} from "../domain/bi";
import {
  type ChronologicalCursor,
  encodeChronologicalCursor,
  encodeLinkPageCursor,
  encodeSearchPostsCursor,
  type KnowledgeLinksPageOutput,
  type KnowledgePostsPageOutput,
  type LinkPageCursor,
  notFoundError,
  type SearchPostsPageResult
} from "../domain/api";
import type {
  BadRequestError as BadRequestErrorShape,
  ForbiddenError as ForbiddenErrorShape,
  InternalServerError as InternalServerErrorShape,
  NotFoundError as NotFoundErrorShape,
  ServiceUnavailableError as ServiceUnavailableErrorShape,
  UnauthorizedError as UnauthorizedErrorShape,
  UpstreamFailureError as UpstreamFailureErrorShape
} from "../domain/api";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { buildTypedEmbed, extractEmbedKind } from "../bluesky/EmbedExtract";
import type { FlattenedPost } from "../bluesky/ThreadFlatten";
import { flattenThread } from "../bluesky/ThreadFlatten";
import type { EnvBindings } from "../platform/Env";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { EditorialService } from "../services/EditorialService";
import { PostHydrationService } from "../services/PostHydrationService";
import { handleWithApiLayer, makeCachedApiHandler } from "../http/ApiSupport";
import {
  isTaggedError,
  toUpstreamFailure,
  withHttpErrorMapping
} from "../http/ErrorMapping";
import { PublicReadApi } from "./PublicReadApi";

const withReadErrors = <A, R>(
  route: string,
  effect: Effect.Effect<A, unknown, R>
) =>
  withHttpErrorMapping(effect, {
    route,
    internalMessage: "internal error"
  }) as Effect.Effect<
    A,
    | BadRequestErrorShape
    | UnauthorizedErrorShape
    | ForbiddenErrorShape
    | NotFoundErrorShape
    | UpstreamFailureErrorShape
    | ServiceUnavailableErrorShape
    | InternalServerErrorShape,
    R
  >;

const withThreadReadErrors = <A, R>(
  route: string,
  effect: Effect.Effect<A, unknown, R>
) =>
  withHttpErrorMapping(effect, {
    route,
    internalMessage: "internal error",
    classify: (error) => {
      if (isTaggedError(error, "BlueskyApiError")) {
        const status =
          "status" in error && typeof error.status === "number"
            ? error.status
            : undefined;

        if (status === 404) {
          return notFoundError("post thread not found");
        }
      }

      return toUpstreamFailure("failed to fetch post thread")(error);
    }
  }) as Effect.Effect<
    A,
    | BadRequestErrorShape
    | UnauthorizedErrorShape
    | ForbiddenErrorShape
    | NotFoundErrorShape
    | UpstreamFailureErrorShape
    | ServiceUnavailableErrorShape
    | InternalServerErrorShape,
    R
  >;

const toPostsPage = (
  items: ReadonlyArray<KnowledgePostResult>,
  nextCursor: ChronologicalCursor | null
) : KnowledgePostsPageOutput =>
  ({
    items: Array.from(items),
    page: {
      nextCursor: encodeChronologicalCursor(nextCursor)
    }
  });

const toLinksPage = (
  items: ReadonlyArray<KnowledgeLinkResult>,
  nextCursor: LinkPageCursor | null
) : KnowledgeLinksPageOutput =>
  ({
    items: Array.from(items),
    page: {
      nextCursor: encodeLinkPageCursor(nextCursor)
    }
  });

const hydratePosts = <A extends KnowledgePostResult>(items: ReadonlyArray<A>) =>
  Effect.flatMap(PostHydrationService, (hydration) =>
    hydration.hydratePosts(items)
  );

const extractText = (record: unknown): string => {
  if (typeof record === "object" && record !== null && "text" in record) {
    return typeof record.text === "string" ? record.text : "";
  }

  return "";
};

const extractCreatedAt = (record: unknown, fallbackIndexedAt: string): string => {
  if (typeof record === "object" && record !== null && "createdAt" in record) {
    return typeof record.createdAt === "string" ? record.createdAt : fallbackIndexedAt;
  }

  return fallbackIndexedAt;
};

const toThreadPostResult = (
  flatPost: FlattenedPost,
  position: ThreadPostPositionShape
): ThreadPostResultShape => ({
  uri: flatPost.post.uri as ThreadPostResultShape["uri"],
  did: flatPost.post.author.did as ThreadPostResultShape["did"],
  handle: (flatPost.post.author.handle ?? null) as ThreadPostResultShape["handle"],
  displayName: (flatPost.post.author.displayName ?? null) as ThreadPostResultShape["displayName"],
  text: extractText(flatPost.post.record),
  createdAt: extractCreatedAt(flatPost.post.record, flatPost.post.indexedAt),
  replyCount: (flatPost.post.replyCount ?? null) as ThreadPostResultShape["replyCount"],
  repostCount: (flatPost.post.repostCount ?? null) as ThreadPostResultShape["repostCount"],
  likeCount: (flatPost.post.likeCount ?? null) as ThreadPostResultShape["likeCount"],
  quoteCount: (flatPost.post.quoteCount ?? null) as ThreadPostResultShape["quoteCount"],
  position,
  depth: flatPost.depth,
  parentUri: (flatPost.parentUri ?? null) as ThreadPostResultShape["parentUri"],
  embedType: extractEmbedKind(flatPost.post.embed) as ThreadPostResultShape["embedType"],
  embedContent: buildTypedEmbed(flatPost.post.embed) as ThreadPostResultShape["embedContent"]
});

const PublicReadHandlers = Layer.mergeAll(
  HttpApiBuilder.group(PublicReadApi, "posts", (handlers) =>
    handlers
      .handle("search", ({ urlParams }) =>
        withReadErrors("/api/posts/search", Effect.flatMap(KnowledgeQueryService, (query) =>
          query.searchPostsPage({
            query: urlParams.q,
            topic: urlParams.topic,
            since: urlParams.since,
            until: urlParams.until,
            limit: urlParams.limit,
            cursor: urlParams.cursor
          })
        )).pipe(
          Effect.flatMap((page: SearchPostsPageResult) =>
            hydratePosts(page.items).pipe(
              Effect.map((items) => ({
                items: Array.from(items),
                page: { nextCursor: encodeSearchPostsCursor(page.nextCursor) }
              } satisfies KnowledgePostsPageOutput))
            )
          )
        )
      )
      .handle("recent", ({ urlParams }) =>
        withReadErrors("/api/posts/recent", Effect.flatMap(KnowledgeQueryService, (query) =>
          query.getRecentPostsPage(urlParams)
        )).pipe(
          Effect.flatMap((page) =>
            hydratePosts(page.items).pipe(
              Effect.map((items) => toPostsPage(items, page.nextCursor))
            )
          )
        )
      )
      .handle("explainTopics", ({ path }) =>
        withReadErrors("/api/posts/:uri/topics", Effect.flatMap(KnowledgeQueryService, (query) =>
          query.explainPostTopics(path.uri)
        ))
      )
      .handle("thread", ({ path, urlParams }) =>
        withThreadReadErrors(
          "/api/posts/:uri/thread",
          Effect.flatMap(BlueskyClient, (bluesky) =>
            bluesky.getPostThread(path.uri, {
              depth: urlParams.depth ?? 3,
              parentHeight: urlParams.parentHeight ?? 3
            })
          ).pipe(
            Effect.flatMap((response) => {
              const flat = flattenThread(response.thread);

              if (flat === null) {
                return Effect.fail(notFoundError("post thread not found"));
              }

              return Effect.succeed({
                focusUri: flat.focus.post.uri as PostThreadOutputShape["focusUri"],
                ancestors: flat.ancestors.map((post) => toThreadPostResult(post, "ancestor")),
                focus: toThreadPostResult(flat.focus, "focus"),
                replies: flat.replies.map((post) => toThreadPostResult(post, "reply"))
              } satisfies PostThreadOutputShape);
            })
          )
        )
      )
      .handle("curated", ({ urlParams }) =>
        withReadErrors("/api/posts/curated", Effect.flatMap(EditorialService, (editorial) =>
          editorial.getCuratedFeed({
            topic: urlParams.topic,
            minScore: urlParams.minScore,
            since: urlParams.since,
            limit: urlParams.limit
          })
        )).pipe(
          Effect.flatMap((items) =>
            hydratePosts(items).pipe(
              Effect.map((hydratedItems) => ({
                items: Array.from(hydratedItems),
                page: { nextCursor: null }
              }))
            )
          )
        )
      )
  ),
  HttpApiBuilder.group(PublicReadApi, "links", (handlers) =>
    handlers.handle("list", ({ urlParams }) =>
      withReadErrors("/api/links", Effect.flatMap(KnowledgeQueryService, (query) =>
        query.getPostLinksPage(urlParams)
      )).pipe(
        Effect.map((page) => toLinksPage(page.items, page.nextCursor))
      )
    )
  ),
  HttpApiBuilder.group(PublicReadApi, "experts", (handlers) =>
    handlers
      .handle("list", ({ urlParams }) =>
        withReadErrors("/api/experts", Effect.flatMap(KnowledgeQueryService, (query) =>
          query.listExperts(urlParams)
        )).pipe(
          Effect.map((items) => ({ items }))
        )
      )
      .handle("posts", ({ path, urlParams }) =>
        withReadErrors("/api/experts/:did/posts", Effect.flatMap(KnowledgeQueryService, (query) =>
          query.getRecentPostsPage({
            topic: urlParams.topic,
            expertDid: path.did,
            since: urlParams.since,
            until: urlParams.until,
            limit: urlParams.limit,
            cursor: urlParams.cursor
          })
        )).pipe(
          Effect.flatMap((page) =>
            hydratePosts(page.items).pipe(
              Effect.map((items) => toPostsPage(items, page.nextCursor))
            )
          )
        )
      )
  ),
  HttpApiBuilder.group(PublicReadApi, "publications", (handlers) =>
    handlers.handle("list", ({ urlParams }) =>
      withReadErrors("/api/publications", Effect.flatMap(KnowledgeQueryService, (query) =>
        query.listPublications(urlParams)
      )).pipe(
        Effect.map((items) => ({ items }))
      )
    )
  ),
  HttpApiBuilder.group(PublicReadApi, "topics", (handlers) =>
    handlers
      .handle("list", ({ urlParams }) =>
        withReadErrors("/api/topics", Effect.flatMap(KnowledgeQueryService, (query) =>
          query.listTopics(urlParams)
        )).pipe(
          Effect.map((items) => ({
            view: urlParams.view ?? "facets",
            items
          }))
        )
      )
      .handle("get", ({ path }) =>
        withReadErrors(
          "/api/topics/:slug",
          Effect.flatMap(KnowledgeQueryService, (query) =>
            query.getTopic({ slug: path.slug })
          )
            .pipe(
              Effect.flatMap((item) =>
                item === null
                  ? Effect.fail(notFoundError(`topic not found: ${path.slug}`))
                  : Effect.succeed({ item })
              )
            )
        )
      )
      .handle("expand", ({ path, urlParams }) =>
        withReadErrors("/api/topics/:slug/expand", Effect.flatMap(KnowledgeQueryService, (query) =>
          query.expandTopics({
            slugs: [path.slug],
            mode: urlParams.mode
          })
        ))
      )
  )
);

const PublicReadCorsLayer = HttpApiBuilder.middlewareCors();

const makePublicReadLayer = (serviceLayer: Layer.Layer<any, any, never>) =>
  (() => {
    const handlersLayer = PublicReadHandlers.pipe(
      Layer.provideMerge(serviceLayer)
    );
    const apiLayer = HttpApiBuilder.api(PublicReadApi).pipe(
      Layer.provideMerge(handlersLayer)
    );

    return Layer.mergeAll(apiLayer, PublicReadCorsLayer);
  })();

const handleCachedPublicReadRequest = makeCachedApiHandler(
  (env: EnvBindings) =>
    makePublicReadLayer(makeQueryLayer(env))
);

export const handleApiRequestWithLayer = (
  request: Request,
  layer: Layer.Layer<any, any, never>
) => handleWithApiLayer(request, makePublicReadLayer(layer));

export const handleApiRequest = (
  request: Request,
  env: EnvBindings
) => handleCachedPublicReadRequest(request, env);
