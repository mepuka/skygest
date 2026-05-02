import { Cause, Effect, Exit, Layer, Schema, ServiceMap } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type { EntityNotFoundError } from "../Domain/Errors";
import {
  type EntityIri,
  type EntityLink,
  type EntityLinkWithEvidence,
  type EntityRecord,
  type EntityTag
} from "../Domain/EntityGraph";
import { EntityGraphRepo, type LinkQueryOptions } from "./EntityGraphRepo";
import { EntityRegistry, EntityRegistryLookupError } from "./EntityRegistry";

export interface RenderedEntityContextNode {
  readonly iri: EntityIri;
  readonly entityType: EntityTag;
  readonly summary: string;
  readonly fulltext: string;
}

export interface EntityContextNeighbor extends RenderedEntityContextNode {
  readonly direction: "outbound" | "inbound";
  readonly via: EntityLink;
}

export interface UnhydratedEntityContextNeighbor {
  readonly iri: EntityIri;
  readonly entityType: EntityTag;
  readonly direction: "outbound" | "inbound";
  readonly via: EntityLink;
  readonly message: string;
}

export interface EntityContext {
  readonly entity: RenderedEntityContextNode;
  readonly linksOut: ReadonlyArray<EntityLinkWithEvidence>;
  readonly linksIn: ReadonlyArray<EntityLinkWithEvidence>;
  readonly neighbors: ReadonlyArray<EntityContextNeighbor>;
  readonly unhydratedNeighbors: ReadonlyArray<UnhydratedEntityContextNeighbor>;
}

export interface EntityContextOptions {
  readonly includeOutbound?: boolean;
  readonly includeInbound?: boolean;
  readonly limit?: number;
  readonly minConfidence?: number;
  readonly asOf?: number;
}

export class EntityContextHydrationError extends Schema.TaggedErrorClass<EntityContextHydrationError>()(
  "EntityContextHydrationError",
  {
    iri: Schema.String,
    entityType: Schema.String,
    message: Schema.String,
    cause: Schema.Unknown
  }
) {}

type EntityContextError =
  | EntityNotFoundError
  | EntityRegistryLookupError
  | EntityContextHydrationError
  | SqlError;

const messageFromUnknown = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const messageFromCause = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.findErrorOption(cause);
  return error._tag === "Some"
    ? messageFromUnknown(error.value)
    : Cause.pretty(cause);
};

const queryOptions = (opts: EntityContextOptions): LinkQueryOptions => ({
  limit: opts.limit ?? 25,
  ...(opts.minConfidence === undefined
    ? {}
    : { minConfidence: opts.minConfidence }),
  ...(opts.asOf === undefined ? {} : { asOf: opts.asOf })
});

export class EntityContextService extends ServiceMap.Service<
  EntityContextService,
  {
    readonly getEntity: (
      iri: EntityIri
    ) => Effect.Effect<RenderedEntityContextNode, EntityContextError>;
    readonly assemble: (
      iri: EntityIri,
      options?: EntityContextOptions
    ) => Effect.Effect<EntityContext, EntityContextError>;
  }
>()("@skygest/ontology-store/EntityContextService") {
  static readonly layer = Layer.effect(
    EntityContextService,
    Effect.gen(function* () {
      const graph = yield* EntityGraphRepo;
      const registry = yield* EntityRegistry;

      const renderRecord = (
        record: EntityRecord
      ): Effect.Effect<RenderedEntityContextNode, EntityContextError> =>
        Effect.gen(function* () {
          const definition = yield* registry.getDefinition(record.entityType);
          const storage = yield* registry.getStorageAdapter(record.entityType);
          const entity = yield* storage.load(record.iri as never).pipe(
            Effect.mapError(
              (cause) =>
                new EntityContextHydrationError({
                  iri: record.iri,
                  entityType: record.entityType,
                  message: messageFromUnknown(cause),
                  cause
                })
            )
          );
          return yield* Effect.try({
            try: () => ({
              iri: record.iri,
              entityType: record.entityType,
              summary: definition.render.summary(entity as never),
              fulltext: definition.render.fulltext(entity as never)
            }),
            catch: (cause) =>
              new EntityContextHydrationError({
                iri: record.iri,
                entityType: record.entityType,
                message: messageFromUnknown(cause),
                cause
              })
          });
        });

      const getEntity = (iri: EntityIri) =>
        graph.lookupEntity(iri).pipe(Effect.flatMap(renderRecord));

      const renderNeighbor = (
        direction: "outbound" | "inbound",
        link: EntityLink
      ): Effect.Effect<EntityContextNeighbor, EntityContextError> =>
        Effect.gen(function* () {
          const neighborIri =
            direction === "outbound" ? link.objectIri : link.subjectIri;
          if (neighborIri === undefined) {
            return yield* new EntityContextHydrationError({
              iri: link.subjectIri,
              entityType: link.subjectType,
              message: "entity context can only hydrate IRI object links",
              cause: link
            });
          }
          const node = yield* getEntity(neighborIri);
          return { ...node, direction, via: link };
        });

      const unhydratedNeighbor = (
        direction: "outbound" | "inbound",
        link: EntityLink,
        cause: Cause.Cause<unknown>
      ): UnhydratedEntityContextNeighbor => {
        const neighborIri =
          direction === "outbound" ? link.objectIri : link.subjectIri;
        const neighborType =
          direction === "outbound" ? link.objectType : link.subjectType;
        return {
          iri: neighborIri ?? link.subjectIri,
          entityType: neighborType,
          direction,
          via: link,
          message: messageFromCause(cause)
        };
      };

      const assemble = (iri: EntityIri, options: EntityContextOptions = {}) =>
        Effect.gen(function* () {
          const includeOutbound = options.includeOutbound ?? true;
          const includeInbound = options.includeInbound ?? true;
          const opts = queryOptions(options);
          const entity = yield* getEntity(iri);
          const linksOut = includeOutbound
            ? yield* graph.linksOut(iri, opts)
            : [];
          const linksIn = includeInbound
            ? yield* graph.linksIn(iri, opts)
            : [];
          const seen = new Set<string>();
          const neighborLinks = [
              ...linksOut.map((item) => ({
                direction: "outbound" as const,
                link: item.link
              })),
              ...linksIn.map((item) => ({
                direction: "inbound" as const,
                link: item.link
              }))
            ].filter((item) => {
              const neighborIri =
                item.direction === "outbound"
                  ? item.link.objectIri
                  : item.link.subjectIri;
              if (neighborIri === undefined || seen.has(neighborIri)) {
                return false;
              }
              seen.add(neighborIri);
              return true;
            });
          const neighborOutcomes = yield* Effect.forEach(
            neighborLinks,
            (item) => Effect.exit(renderNeighbor(item.direction, item.link))
          );
          const neighbors: Array<EntityContextNeighbor> = [];
          const unhydratedNeighbors: Array<UnhydratedEntityContextNeighbor> = [];
          for (const [index, outcome] of neighborOutcomes.entries()) {
            const item = neighborLinks[index];
            if (item === undefined) continue;
            if (Exit.isSuccess(outcome)) {
              neighbors.push(outcome.value);
            } else {
              unhydratedNeighbors.push(
                unhydratedNeighbor(item.direction, item.link, outcome.cause)
              );
            }
          }
          return {
            entity,
            linksOut,
            linksIn,
            neighbors,
            unhydratedNeighbors
          };
        });

      return EntityContextService.of({ getEntity, assemble });
    })
  );
}
