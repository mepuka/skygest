import {
  EntityProjectionRegistry,
  type EntityProjectionEntry
} from "@skygest/ontology-store";
import { Effect, Layer, Schema, ServiceMap } from "effect";
import {
  SearchEntityHit,
  type OntologyEntityIri,
  type OntologyEntityType,
  type SearchEntityHit as SearchEntityHitValue,
  type SearchEntityMatchReason
} from "../domain/entitySearch";
import { stripUndefined } from "../platform/Json";

export type OntologyEntityHydrationMissReason =
  | "unknown-entity-type"
  | "invalid-iri"
  | "not-found"
  | "decode-error";

export type HydrateOntologyEntityInput = {
  readonly entityType?: OntologyEntityType;
  readonly iri: OntologyEntityIri;
  readonly rank: number;
  readonly score: number;
  readonly matchReason: SearchEntityMatchReason;
  readonly evidenceText?: string;
  readonly candidateEntityTypes?: ReadonlyArray<OntologyEntityType>;
};

export type HydrateOntologyEntityResult =
  | {
      readonly _tag: "Hit";
      readonly hit: SearchEntityHitValue;
    }
  | {
      readonly _tag: "Miss";
      readonly iri: OntologyEntityIri;
      readonly entityType?: string;
      readonly reason: OntologyEntityHydrationMissReason;
    };

const EVIDENCE_TEXT_MAX_LENGTH = 240;
const LABEL_MAX_LENGTH = 120;
const SUMMARY_MAX_LENGTH = 360;
const whitespace = /\s+/g;

const normalizeText = (value: string, fallback: string): string => {
  const normalized = value.replace(whitespace, " ").trim();
  return normalized.length === 0 ? fallback : normalized;
};

const boundText = (value: string, maxLength: number): string =>
  value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 3))}...`;

const summarize = (
  entry: EntityProjectionEntry,
  entity: unknown,
  fallback: string
) =>
  boundText(
    normalizeText(entry.definition.render.summary(entity as never), fallback),
    SUMMARY_MAX_LENGTH
  );

const labelFromSummary = (summary: string, fallback: string): string =>
  boundText(
    normalizeText(summary.split(/[.!?]/)[0] ?? summary, fallback),
    LABEL_MAX_LENGTH
  );

const makeMiss = (
  input: HydrateOntologyEntityInput,
  reason: OntologyEntityHydrationMissReason,
  entityType?: string
): HydrateOntologyEntityResult => ({
  _tag: "Miss",
  iri: input.iri,
  reason,
  ...(entityType === undefined ? {} : { entityType })
});

const makeEvidenceText = (
  input: HydrateOntologyEntityInput,
  summary: string
): string =>
  boundText(
    normalizeText(
      input.evidenceText ?? (input.matchReason === "exact-iri" ? input.iri : summary),
      input.iri
    ),
    EVIDENCE_TEXT_MAX_LENGTH
  );

const decodeEntryIri = (
  entry: EntityProjectionEntry,
  input: HydrateOntologyEntityInput
): Effect.Effect<unknown, unknown> =>
  Schema.decodeUnknownEffect(entry.definition.identity.iri)(
    input.iri
  ) as Effect.Effect<unknown, unknown>;

const loadEntryEntity = (
  entry: EntityProjectionEntry,
  iri: unknown
): Effect.Effect<unknown, unknown> =>
  entry.storage.load(iri as never) as Effect.Effect<unknown, unknown>;

const decodeHit = (
  entry: EntityProjectionEntry,
  input: HydrateOntologyEntityInput,
  entity: unknown
): Effect.Effect<HydrateOntologyEntityResult> => {
  const fallback = `${entry.definition.tag} ${input.iri}`;
  const summary = summarize(entry, entity, fallback);
  return Schema.decodeUnknownEffect(SearchEntityHit)(
    stripUndefined({
      entityType: entry.definition.tag,
      iri: input.iri,
      label: labelFromSummary(summary, fallback),
      summary,
      rank: input.rank,
      score: input.score,
      matchReason: input.matchReason,
      evidence: [
        stripUndefined({
          kind: input.matchReason === "exact-iri" ? "iri" : "chunk",
          text: makeEvidenceText(input, summary),
          source: input.iri
        })
      ]
    })
  ).pipe(
    Effect.matchEffect({
      onFailure: () =>
        Effect.succeed(makeMiss(input, "decode-error", entry.definition.tag)),
      onSuccess: (hit) =>
        Effect.succeed({
          _tag: "Hit",
          hit
        } satisfies HydrateOntologyEntityResult)
    })
  );
};

const hydrateFromEntry = (
  entry: EntityProjectionEntry,
  input: HydrateOntologyEntityInput
): Effect.Effect<HydrateOntologyEntityResult> =>
  decodeEntryIri(entry, input).pipe(
    Effect.matchEffect({
      onFailure: () =>
        Effect.succeed(makeMiss(input, "invalid-iri", entry.definition.tag)),
      onSuccess: (iri) =>
        loadEntryEntity(entry, iri).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.succeed(makeMiss(input, "not-found", entry.definition.tag)),
            onSuccess: (entity) => decodeHit(entry, input, entity)
          })
        )
    })
  );

const candidateEntries = (
  registry: (typeof EntityProjectionRegistry)["Service"],
  input: HydrateOntologyEntityInput
): ReadonlyArray<EntityProjectionEntry> => {
  const allowed =
    input.candidateEntityTypes === undefined
      ? null
      : new Set(input.candidateEntityTypes.map((entityType) => String(entityType)));
  return registry.entries.filter(
    (entry) => allowed === null || allowed.has(entry.definition.tag)
  );
};

export class OntologyEntityHydrator extends ServiceMap.Service<
  OntologyEntityHydrator,
  {
    readonly hydrate: (
      input: HydrateOntologyEntityInput
    ) => Effect.Effect<HydrateOntologyEntityResult>;
  }
>()("@skygest/OntologyEntityHydrator") {
  static readonly layer = Layer.effect(
    OntologyEntityHydrator,
    Effect.gen(function* () {
      const registry = yield* EntityProjectionRegistry;

      const hydrate = (input: HydrateOntologyEntityInput) =>
        Effect.gen(function* () {
          if (input.entityType !== undefined) {
            return yield* registry.get(String(input.entityType)).pipe(
              Effect.matchEffect({
                onFailure: () =>
                  Effect.succeed(
                    makeMiss(input, "unknown-entity-type", input.entityType)
                  ),
                onSuccess: (entry) => hydrateFromEntry(entry, input)
              })
            );
          }

          for (const entry of candidateEntries(registry, input)) {
            const result = yield* hydrateFromEntry(entry, input);
            if (result._tag === "Hit") {
              return result;
            }
          }

          return makeMiss(input, "not-found");
        });

      return OntologyEntityHydrator.of({ hydrate });
    })
  );
}
