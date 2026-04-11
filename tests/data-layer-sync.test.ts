import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import {
  checkedInDataLayerRegistryRoot,
  loadCheckedInDataLayerRegistry
} from "../src/bootstrap/CheckedInDataLayerRegistry";
import { loadD1DataLayerRegistry } from "../src/bootstrap/D1DataLayerRegistry";
import { runMigrations } from "../src/db/migrate";
import {
  Agent as AgentSchema,
  Series as SeriesSchema,
  Variable as VariableSchema,
  type DataLayerRegistrySeed
} from "../src/domain/data-layer";
import {
  planDataLayerSync,
  syncCheckedInDataLayer
} from "../src/data-layer/Sync";
import { runStage1 } from "../src/resolution/Stage1";
import { toDataLayerRegistryLookup } from "../src/resolution/dataLayerRegistry";
import { DataLayerReposD1 } from "../src/services/d1/DataLayerReposD1";
import { loadSnapshotFromString, toStage1Input } from "../eval/resolution-stage1/shared";
import { layer as localFileSystemLayer } from "./helpers/LocalFileSystem";
import { makeSqliteLayer } from "./support/runtime";

const decodeAgent = Schema.decodeUnknownSync(AgentSchema);
const decodeVariable = Schema.decodeUnknownSync(VariableSchema);
const decodeSeries = Schema.decodeUnknownSync(SeriesSchema);

const iso = "2026-04-11T12:00:00.000Z";

const makeSeed = (
  overrides?: Partial<DataLayerRegistrySeed>
): DataLayerRegistrySeed => ({
  agents: [],
  catalogs: [],
  catalogRecords: [],
  datasets: [],
  distributions: [],
  dataServices: [],
  datasetSeries: [],
  variables: [],
  series: [],
  ...overrides
});

const makeLayer = () => {
  const sqliteLayer = makeSqliteLayer();
  return Layer.mergeAll(
    localFileSystemLayer,
    sqliteLayer,
    DataLayerReposD1.layer.pipe(Layer.provideMerge(sqliteLayer))
  );
};

describe("data layer sync", () => {
  it("plans inserts, updates, and missing-in-source rows deterministically", () => {
    const agent = decodeAgent({
      _tag: "Agent",
      id: "https://id.skygest.io/agent/ag_SYNC000001",
      kind: "organization",
      name: "Energy Information Administration",
      aliases: [],
      createdAt: iso,
      updatedAt: iso
    });
    const updatedAgent = decodeAgent({
      ...agent,
      alternateNames: ["EIA"],
      updatedAt: "2026-04-12T12:00:00.000Z"
    });
    const variable = decodeVariable({
      _tag: "Variable",
      id: "https://id.skygest.io/variable/var_SYNC000001",
      label: "Retail electricity price",
      aliases: [],
      createdAt: iso,
      updatedAt: iso
    });
    const series = decodeSeries({
      _tag: "Series",
      id: "https://id.skygest.io/series/ser_SYNC000001",
      label: "Retail electricity price monthly",
      variableId: variable.id,
      fixedDims: {
        frequency: "monthly"
      },
      aliases: [],
      createdAt: iso,
      updatedAt: iso
    });

    const plan = planDataLayerSync(
      makeSeed({
        agents: [updatedAgent],
        variables: [variable]
      }),
      makeSeed({
        agents: [agent],
        series: [series]
      })
    );

    expect(plan.inserts.map((change) => change.id)).toEqual([variable.id]);
    expect(plan.updates.map((change) => change.id)).toEqual([agent.id]);
    expect(plan.missingInSource.map((change) => change.id)).toEqual([series.id]);
    expect(plan.counts.Variable.inserts).toBe(1);
    expect(plan.counts.Agent.updates).toBe(1);
    expect(plan.counts.Series.missingInSource).toBe(1);
  });

  it.effect("syncs the checked-in registry idempotently and preserves Stage 1 output", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const first = yield* syncCheckedInDataLayer({
        root: checkedInDataLayerRegistryRoot,
        updatedBy: "test-sync",
        apply: true
      });
      const second = yield* syncCheckedInDataLayer({
        root: checkedInDataLayerRegistryRoot,
        updatedBy: "test-sync",
        apply: true
      });

      expect(first.plan.inserts.length).toBeGreaterThan(0);
      expect(first.plan.updates).toHaveLength(0);
      expect(first.plan.missingInSource).toHaveLength(0);
      expect(second.plan.inserts).toHaveLength(0);
      expect(second.plan.updates).toHaveLength(0);
      expect(second.plan.missingInSource).toHaveLength(0);

      const filePrepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const d1Prepared = yield* loadD1DataLayerRegistry();
      const fileLookup = toDataLayerRegistryLookup(filePrepared);
      const d1Lookup = toDataLayerRegistryLookup(d1Prepared);

      const fs = yield* FileSystem.FileSystem;
      const snapshot = yield* fs.readFileString("eval/resolution-stage1/snapshot.jsonl");
      const rows = yield* loadSnapshotFromString(snapshot);
      const sampleSlugs = new Set([
        "001-ember-energy",
        "002-1reluctantcog",
        "011-thomashochman",
        "012-hausfath-bsky-social"
      ]);
      const fixtureRows = rows.filter((row) => sampleSlugs.has(row.slug));

      expect(fixtureRows).toHaveLength(sampleSlugs.size);

      for (const row of fixtureRows) {
        const fileResult = runStage1(toStage1Input(row), fileLookup);
        const d1Result = runStage1(toStage1Input(row), d1Lookup);
        expect(d1Result).toEqual(fileResult);
      }
    }).pipe(Effect.provide(makeLayer()))
  );
});
