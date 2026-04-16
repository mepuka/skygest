import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, References, Schema } from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll } from "vitest";

import { loadCheckedInDataLayerSeed } from "../../../src/bootstrap/CheckedInDataLayerRegistry";
import type {
  Agent as AgentEntity,
  DataLayerRegistryEntity,
  DataLayerRegistrySeed
} from "../../../src/domain/data-layer";
import {
  AgentId,
  CatalogId,
  CatalogRecordId,
  DataServiceId,
  DatasetId,
  DatasetSeriesId,
  DistributionId,
  SeriesId,
  VariableId
} from "../../../src/domain/data-layer";
import emitSpecJson from "../generated/emit-spec.json";
import type {
  ShaclValidationReport,
  ShaclViolation
} from "../src/Domain/Shacl";
import {
  EmitSpec as EmitSpecSchema,
  type EmitSpecClassKey
} from "../src/Domain/EmitSpec";
import { IRI } from "../src/Domain/Rdf";
import { emitEntityQuads } from "../src/mapping/forward";
import { distillEntities } from "../src/mapping/reverse";
import {
  type RdfQuad,
  RdfStoreService
} from "../src/Service/RdfStore";
import { ShaclService } from "../src/Service/Shacl";
import { compareProjectionParity } from "../src/testing/projection-parity";

const asIri = Schema.decodeUnknownSync(IRI);
const emitSpec = Schema.decodeUnknownSync(EmitSpecSchema)(emitSpecJson);

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const testLayer = Layer.mergeAll(
  bunFsLayer,
  RdfStoreService.Default,
  ShaclService.Default
);

const coldStartRoot = fileURLToPath(
  new URL("../../../.generated/cold-start", import.meta.url)
);
const shapesPath = fileURLToPath(
  new URL("../shapes/dcat-instances.ttl", import.meta.url)
);
const shapesText = readFileSync(shapesPath, "utf8");
const RDF_TYPE = asIri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const SKOS_ALT_LABEL = asIri("http://www.w3.org/2004/02/skos/core#altLabel");
const SKOS_MAPPING_PREDICATES = [
  asIri("http://www.w3.org/2004/02/skos/core#exactMatch"),
  asIri("http://www.w3.org/2004/02/skos/core#closeMatch"),
  asIri("http://www.w3.org/2004/02/skos/core#broadMatch"),
  asIri("http://www.w3.org/2004/02/skos/core#narrowMatch")
] as const;
const decodeIdByTag = {
  Agent: Schema.decodeUnknownSync(AgentId),
  Catalog: Schema.decodeUnknownSync(CatalogId),
  CatalogRecord: Schema.decodeUnknownSync(CatalogRecordId),
  DataService: Schema.decodeUnknownSync(DataServiceId),
  Dataset: Schema.decodeUnknownSync(DatasetId),
  DatasetSeries: Schema.decodeUnknownSync(DatasetSeriesId),
  Distribution: Schema.decodeUnknownSync(DistributionId),
  Variable: Schema.decodeUnknownSync(VariableId),
  Series: Schema.decodeUnknownSync(SeriesId)
} as const;
const EXPECTED_LOAD_COUNTS = new Map<EmitSpecClassKey, number>([
  ["Agent", 66],
  ["Catalog", 60],
  ["CatalogRecord", 1792],
  ["DataService", 12],
  ["Dataset", 1790],
  ["DatasetSeries", 81],
  ["Distribution", 3530],
  // The checked-in registry loader intentionally skips dot-prefixed helper
  // files like `.variable-ids.json` and `.series-ids.json`, so the loaded
  // cold-start corpus is 25 Variables and 28 Series today.
  ["Variable", 25],
  ["Series", 28]
]);

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

const countByTag = (entities: ReadonlyArray<DataLayerRegistryEntity>) =>
  entities.reduce(
    (counts, entity) =>
      counts.set(
        entity._tag,
        (counts.get(entity._tag as EmitSpecClassKey) ?? 0) + 1
      ),
    new Map<EmitSpecClassKey, number>()
  );

const sortStrings = (values: ReadonlyArray<string>) =>
  [...values].sort((left, right) => left.localeCompare(right));

const emitSeedToStore = (seed: DataLayerRegistrySeed) =>
  Effect.gen(function* () {
    const rdf = yield* RdfStoreService;
    const store = yield* rdf.makeStore;

    for (const entity of flattenSeed(seed)) {
      const quads = yield* emitEntityQuads(entity);
      yield* rdf.addQuads(store, quads);
    }

    return store;
  });

const quadKey = (quad: RdfQuad) =>
  JSON.stringify({
    subject: {
      termType: quad.subject.termType,
      value: quad.subject.value
    },
    predicate: {
      termType: quad.predicate.termType,
      value: quad.predicate.value
    },
    object:
      quad.object.termType === "Literal"
        ? {
            termType: quad.object.termType,
            value: quad.object.value,
            language: quad.object.language,
            datatype: quad.object.datatype.value
          }
        : {
            termType: quad.object.termType,
            value: quad.object.value
          },
    graph: {
      termType: quad.graph.termType,
      value: quad.graph.value
    }
  });

const formatViolation = (violation: ShaclViolation) =>
  [
    violation.focusNode,
    violation.sourceConstraint,
    violation.path ?? "<no-path>",
    violation.message
  ].join(" | ");

const iriPredicates = new Set(
  Object.values(emitSpec.classes).flatMap((classSpec) =>
    classSpec.forward.fields.flatMap((field) =>
      field.predicate !== null && field.valueKind?._tag === "Iri"
        ? [field.predicate]
        : []
    )
  )
);

type RoundTripArtifacts = {
  readonly seed: DataLayerRegistrySeed;
  readonly sourceEntities: ReadonlyArray<DataLayerRegistryEntity>;
  readonly emittedQuads: ReadonlyArray<RdfQuad>;
  readonly report: ShaclValidationReport;
  readonly turtle: string;
  readonly reparsedQuads: ReadonlyArray<RdfQuad>;
  readonly distilled: ReadonlyArray<DataLayerRegistryEntity>;
};

let artifacts!: RoundTripArtifacts;

describe("cold-start catalog round-trip", () => {
  beforeAll(async () => {
    artifacts = await Effect.runPromise(
      Effect.gen(function* () {
        const seed = yield* loadCheckedInDataLayerSeed(coldStartRoot);
        const sourceEntities = flattenSeed(seed);
        const rdf = yield* RdfStoreService;
        const shacl = yield* ShaclService;
        const store = yield* emitSeedToStore(seed);
        const emittedQuads = yield* rdf.query(store);
        const shapesStore = yield* shacl.loadShapes(shapesText);
        const report = yield* shacl.validate(store, shapesStore);
        const turtle = yield* rdf.toTurtle(store);
        const reparsedStore = yield* rdf.makeStore;
        yield* rdf.parseTurtle(reparsedStore, turtle);
        const reparsedQuads = yield* rdf.query(reparsedStore);
        const distilled = yield* distillEntities(reparsedStore);

        return {
          seed,
          sourceEntities,
          emittedQuads,
          report,
          turtle,
          reparsedQuads,
          distilled
        };
      }).pipe(
        Effect.provide(testLayer),
        Effect.provideService(References.MinimumLogLevel, "Error"),
        Effect.scoped
      )
    );
  }, 120_000);

  it("phase 1: load counts match the checked-in cold-start inventory", () => {
    expect(expectedTypeCounts(artifacts.seed)).toEqual(EXPECTED_LOAD_COUNTS);
    expect(artifacts.sourceEntities).toHaveLength(7384);
  });

  it("phase 2: emit produces expected quad shape", () => {
    for (const [classKey, expectedCount] of expectedTypeCounts(artifacts.seed)) {
      const classSpec = emitSpec.classes[classKey];

      for (const classIri of [
        classSpec.primaryClassIri,
        ...classSpec.additionalClassIris
      ]) {
        const typeQuads = artifacts.emittedQuads.filter(
          (quad) =>
            quad.predicate.value === RDF_TYPE &&
            quad.object.termType === "NamedNode" &&
            quad.object.value === classIri
        );

        expect(typeQuads).toHaveLength(expectedCount);
        expect(typeQuads.every((quad) => quad.subject.termType === "NamedNode")).toBe(
          true
        );
      }
    }

    for (const predicate of iriPredicates) {
      const quads = artifacts.emittedQuads.filter(
        (quad) => quad.predicate.value === predicate
      );
      expect(quads.every((quad) => quad.object.termType === "NamedNode")).toBe(
        true
      );
    }

    for (const predicate of SKOS_MAPPING_PREDICATES) {
      const quads = artifacts.emittedQuads.filter(
        (quad) => quad.predicate.value === predicate
      );
      expect(quads.every((quad) => quad.object.termType === "NamedNode")).toBe(
        true
      );
    }

    const altLabelQuads = artifacts.emittedQuads.filter(
      (quad) => quad.predicate.value === SKOS_ALT_LABEL
    );
    expect(altLabelQuads.every((quad) => quad.object.termType === "Literal")).toBe(
      true
    );
  });

  it("phase 3: emitted RDF conforms to the first-pass SHACL shapes", () => {
    if (!artifacts.report.conforms) {
      const grouped = new Map<string, Array<string>>();

      for (const violation of artifacts.report.violations) {
        const entries = grouped.get(violation.sourceShape) ?? [];
        entries.push(formatViolation(violation));
        grouped.set(violation.sourceShape, entries);
      }

      const summary = [...grouped.entries()]
        .map(
          ([shape, entries]) =>
            `${shape}\n${entries
              .slice(0, 5)
              .map((entry) => `  - ${entry}`)
              .join("\n")}`
        )
        .join("\n\n");

      throw new Error(`SHACL validation failed:\n${summary}`);
    }

    expect(artifacts.report).toEqual({
      conforms: true,
      violations: []
    });
  });

  it("phase 4: serialized Turtle reparses to the same quad multiset", () => {
    expect(artifacts.turtle.length).toBeGreaterThan(0);
    expect(artifacts.reparsedQuads).toHaveLength(artifacts.emittedQuads.length);
    expect(sortStrings(artifacts.emittedQuads.map(quadKey))).toEqual(
      sortStrings(artifacts.reparsedQuads.map(quadKey))
    );
  });

  it("phase 5: distill rebuilds the expected entity counts with valid ids", () => {
    expect(countByTag(artifacts.distilled)).toEqual(expectedTypeCounts(artifacts.seed));
    expect(sortStrings(artifacts.distilled.map((entity) => entity.id))).toEqual(
      sortStrings(artifacts.sourceEntities.map((entity) => entity.id))
    );

    for (const entity of artifacts.distilled) {
      const decodeId = decodeIdByTag[entity._tag as keyof typeof decodeIdByTag];
      expect(() => decodeId(entity.id)).not.toThrow();
    }

    const aemo = artifacts.distilled.find(
      (entity): entity is AgentEntity =>
        entity._tag === "Agent" &&
        entity.name === "Australian Energy Market Operator"
    );

    expect(aemo).toBeDefined();
    expect(aemo?.alternateNames).toContain("AEMO");
  });

  it("phase 6: distilled entities match the source projection outside the declared lossy boundary", () => {
    const distilledById = new Map(
      artifacts.distilled.map((entity) => [entity.id, entity])
    );
    const diffs: Array<string> = [];

    for (const source of artifacts.sourceEntities) {
      const distilled = distilledById.get(source.id);
      if (distilled === undefined) {
        diffs.push(`${source.id}: missing distilled entity`);
        continue;
      }

      const parity = compareProjectionParity(source, distilled);
      if (!parity.ok) {
        diffs.push(
          `${source.id}: ${parity.diffs
            .map(
              (diff) =>
                `${diff.field} source=${JSON.stringify(diff.source)} distilled=${JSON.stringify(diff.distilled)}`
            )
            .join("; ")}`
        );
      }
    }

    expect(diffs.slice(0, 10)).toEqual([]);
  });
});
