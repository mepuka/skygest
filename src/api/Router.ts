import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import { Effect, Layer } from "effect";
import { makeQueryLayer } from "../edge/Layer";
import type { KnowledgeLinkResult, KnowledgePostResult } from "../domain/bi";
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
import type { EnvBindings } from "../platform/Env";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { EditorialService } from "../services/EditorialService";
import { handleWithApiLayer, makeCachedApiHandler } from "../http/ApiSupport";
import { withHttpErrorMapping } from "../http/ErrorMapping";
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
          Effect.map((page: SearchPostsPageResult) => ({
            items: Array.from(page.items),
            page: { nextCursor: encodeSearchPostsCursor(page.nextCursor) }
          } satisfies KnowledgePostsPageOutput))
        )
      )
      .handle("recent", ({ urlParams }) =>
        withReadErrors("/api/posts/recent", Effect.flatMap(KnowledgeQueryService, (query) =>
          query.getRecentPostsPage(urlParams)
        )).pipe(
          Effect.map((page) => toPostsPage(page.items, page.nextCursor))
        )
      )
      .handle("explainTopics", ({ path }) =>
        withReadErrors("/api/posts/:uri/topics", Effect.flatMap(KnowledgeQueryService, (query) =>
          query.explainPostTopics(path.uri)
        ))
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
          Effect.map((items) => ({
            items: Array.from(items),
            page: { nextCursor: null }
          }))
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
          Effect.map((page) => toPostsPage(page.items, page.nextCursor))
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
