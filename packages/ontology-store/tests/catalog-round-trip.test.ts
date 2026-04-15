import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, References, Schema } from "effect";
import { fileURLToPath } from "node:url";

import { loadCheckedInDataLayerSeed } from "../../../src/bootstrap/CheckedInDataLayerRegistry";
import type {
  DataLayerRegistryEntity,
  DataLayerRegistrySeed
} from "../../../src/domain/data-layer";
import emitSpecJson from "../generated/emit-spec.json";
import {
  EmitSpec as EmitSpecSchema,
  type EmitSpecClassKey
} from "../src/Domain/EmitSpec";
import { IRI } from "../src/Domain/Rdf";
import { emitEntityQuads } from "../src/mapping/forward";
import { RdfStoreService } from "../src/Service/RdfStore";

const asIri = Schema.decodeUnknownSync(IRI);
const emitSpec = Schema.decodeUnknownSync(EmitSpecSchema)(emitSpecJson);

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const testLayer = Layer.mergeAll(bunFsLayer, RdfStoreService.Default);

const coldStartRoot = fileURLToPath(
  new URL("../../../.generated/cold-start", import.meta.url)
);
const RDF_TYPE = asIri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const SKOS_ALT_LABEL = asIri("http://www.w3.org/2004/02/skos/core#altLabel");
const SKOS_MAPPING_PREDICATES = [
  asIri("http://www.w3.org/2004/02/skos/core#exactMatch"),
  asIri("http://www.w3.org/2004/02/skos/core#closeMatch"),
  asIri("http://www.w3.org/2004/02/skos/core#broadMatch"),
  asIri("http://www.w3.org/2004/02/skos/core#narrowMatch")
] as const;

const expectedTypeCounts = (seed: DataLayerRegistrySeed) =>
  new Map<EmitSpecClassKey, number>([
    ["Agent", seed.agents.length],
    ["Catalog", seed.catalogs.length],
    ["CatalogRecord", seed.catalogRecords.length],
    ["DataService", seed.dataServices.length],
    ["Dataset", seed.datasets.length],
    ["DatasetSeries", seed.datasetSeries.length],
    ["Distribution", seed.distributions.length],
    ["Variable", seed.variables.length],
    ["Series", seed.series.length]
  ]);

const flattenSeed = (seed: DataLayerRegistrySeed): ReadonlyArray<DataLayerRegistryEntity> => [
  ...seed.agents,
  ...seed.catalogs,
  ...seed.catalogRecords,
  ...seed.dataServices,
  ...seed.datasets,
  ...seed.datasetSeries,
  ...seed.distributions,
  ...seed.variables,
  ...seed.series
];

const iriPredicates = new Set(
  Object.values(emitSpec.classes).flatMap((classSpec) =>
    classSpec.forward.fields.flatMap((field) =>
      field.predicate !== null && field.valueKind?._tag === "Iri"
        ? [field.predicate]
        : []
    )
  )
);

describe("cold-start catalog round-trip", () => {
  it(
    "phase 2: emit produces expected quad shape",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const seed = yield* loadCheckedInDataLayerSeed(coldStartRoot);
          const rdf = yield* RdfStoreService;
          const store = yield* rdf.makeStore;

          for (const entity of flattenSeed(seed)) {
            const quads = yield* emitEntityQuads(entity);
            yield* rdf.addQuads(store, quads);
          }

          for (const [classKey, expectedCount] of expectedTypeCounts(seed)) {
            const classSpec = emitSpec.classes[classKey];

            for (const classIri of [
              classSpec.primaryClassIri,
              ...classSpec.additionalClassIris
            ]) {
              const typeQuads = yield* rdf.query(store, {
                predicate: RDF_TYPE,
                object: classIri
              });

              expect(typeQuads).toHaveLength(expectedCount);
              expect(
                typeQuads.every((quad) => quad.subject.termType === "NamedNode")
              ).toBe(true);
            }
          }

          for (const predicate of iriPredicates) {
            const quads = yield* rdf.query(store, { predicate });
            expect(
              quads.every((quad) => quad.object.termType === "NamedNode")
            ).toBe(true);
          }

          for (const predicate of SKOS_MAPPING_PREDICATES) {
            const quads = yield* rdf.query(store, { predicate });
            expect(
              quads.every((quad) => quad.object.termType === "NamedNode")
            ).toBe(true);
          }

          const altLabelQuads = yield* rdf.query(store, {
            predicate: SKOS_ALT_LABEL
          });
          expect(
            altLabelQuads.every((quad) => quad.object.termType === "Literal")
          ).toBe(true);
        }).pipe(
          Effect.provide(testLayer),
          Effect.provideService(References.MinimumLogLevel, "Error"),
          Effect.scoped
        )
      ),
    60_000
  );
});
