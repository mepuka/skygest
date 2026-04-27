import { Effect, ServiceMap } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type {
  EntityGraphEndpointNotFoundError,
  EntityGraphLinkInvalidError,
  EntityGraphLinkNotFoundError,
  EntityGraphTraversalLimitError,
  EntityGraphTypeMismatchError,
  EntityNotFoundError
} from "../Domain/Errors";
import type {
  EntityIri,
  EntityLink,
  EntityLinkWithEvidence,
  EntityRecord,
  EntityTag,
  LinkEvidence,
  LinkId
} from "../Domain/EntityGraph";
import type { PredicateIri } from "../Domain/EntityDefinition";
import type { PredicateName, TypedLinkInput } from "../Domain/PredicateRegistry";

export interface LinkQueryOptions {
  readonly predicate?: PredicateIri;
  readonly state?: "active" | "superseded" | "retracted" | "draft";
  readonly asOf?: number;
  readonly minConfidence?: number;
  readonly limit?: number;
}

export interface TraversalPattern {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly predicates?: ReadonlyArray<PredicateIri>;
}

export interface TraversalResult {
  readonly seed: EntityIri;
  readonly links: ReadonlyArray<EntityLink>;
}

export interface NewLinkEvidence {
  readonly assertedBy: string;
  readonly assertionKind: "extracted" | "curated" | "inferred" | "imported";
  readonly confidence: number;
  readonly evidenceSpan?: string;
  readonly sourceIri?: EntityIri;
}

export class EntityGraphRepo extends ServiceMap.Service<
  EntityGraphRepo,
  {
    readonly upsertEntity: (
      iri: EntityIri,
      entityType: EntityTag
    ) => Effect.Effect<EntityRecord, SqlError>;
    readonly lookupEntity: (
      iri: EntityIri
    ) => Effect.Effect<EntityRecord, SqlError | EntityNotFoundError>;
    readonly listEntities: (filter?: {
      readonly entityType?: EntityTag;
      readonly limit?: number;
      readonly cursor?: string;
    }) => Effect.Effect<
      {
        readonly records: ReadonlyArray<EntityRecord>;
        readonly nextCursor?: string;
      },
      SqlError
    >;
    readonly createLink: <P extends PredicateName>(
      input: TypedLinkInput<P>
    ) => Effect.Effect<
      EntityLink,
      | SqlError
      | EntityGraphEndpointNotFoundError
      | EntityGraphLinkInvalidError
      | EntityGraphTypeMismatchError
    >;
    readonly recordEvidence: (
      linkId: LinkId,
      evidence: NewLinkEvidence
    ) => Effect.Effect<LinkEvidence, SqlError | EntityGraphLinkNotFoundError>;
    readonly retractLink: (
      linkId: LinkId,
      reason: string
    ) => Effect.Effect<boolean, SqlError | EntityGraphLinkNotFoundError>;
    readonly supersede: (
      oldId: LinkId,
      replacement: TypedLinkInput<PredicateName>
    ) => Effect.Effect<
      EntityLink,
      SqlError | EntityGraphLinkInvalidError | EntityGraphLinkNotFoundError
    >;
    readonly linksOut: (
      subject: EntityIri,
      opts?: LinkQueryOptions
    ) => Effect.Effect<ReadonlyArray<EntityLinkWithEvidence>, SqlError>;
    readonly linksIn: (
      object: EntityIri,
      opts?: LinkQueryOptions
    ) => Effect.Effect<ReadonlyArray<EntityLinkWithEvidence>, SqlError>;
    readonly neighbors: (
      iri: EntityIri,
      predicate?: PredicateIri,
      opts?: LinkQueryOptions
    ) => Effect.Effect<ReadonlyArray<EntityLink>, SqlError>;
    readonly traverse: (
      seed: EntityIri,
      pattern: TraversalPattern
    ) => Effect.Effect<TraversalResult, SqlError | EntityGraphTraversalLimitError>;
  }
>()("@skygest/ontology-store/EntityGraphRepo") {}
