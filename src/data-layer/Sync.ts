import { Effect, Equal, Hash, Schema } from "effect";
import {
  DataLayerRegistryEntity,
  type DataLayerRegistrySeed
} from "../domain/data-layer";
import {
  checkedInDataLayerRegistryRoot,
  loadCheckedInDataLayerSeed
} from "../bootstrap/CheckedInDataLayerRegistry";
import { loadD1DataLayerSeed } from "../bootstrap/D1DataLayerRegistry";
import { AgentsRepo } from "../services/AgentsRepo";
import { CatalogRecordsRepo } from "../services/CatalogRecordsRepo";
import { CatalogsRepo } from "../services/CatalogsRepo";
import { DataServicesRepo } from "../services/DataServicesRepo";
import { DatasetSeriesRepo } from "../services/DatasetSeriesRepo";
import { DatasetsRepo } from "../services/DatasetsRepo";
import { DistributionsRepo } from "../services/DistributionsRepo";
import { SeriesRepo } from "../services/SeriesRepo";
import { VariablesRepo } from "../services/VariablesRepo";

type DataLayerEntityKind = DataLayerRegistryEntity["_tag"];

export type DataLayerSyncInsert = {
  readonly action: "insert";
  readonly kind: DataLayerEntityKind;
  readonly id: string;
  readonly hash: string;
  readonly entity: DataLayerRegistryEntity;
};

export type DataLayerSyncUpdate = {
  readonly action: "update";
  readonly kind: DataLayerEntityKind;
  readonly id: string;
  readonly currentHash: string;
  readonly nextHash: string;
  readonly current: DataLayerRegistryEntity;
  readonly next: DataLayerRegistryEntity;
};

export type DataLayerSyncMissingInSource = {
  readonly action: "missing-in-source";
  readonly kind: DataLayerEntityKind;
  readonly id: string;
  readonly hash: string;
  readonly entity: DataLayerRegistryEntity;
};

export type DataLayerSyncCounts = Record<
  DataLayerEntityKind,
  {
    readonly inserts: number;
    readonly updates: number;
    readonly missingInSource: number;
  }
>;

export type DataLayerSyncPlan = {
  readonly inserts: ReadonlyArray<DataLayerSyncInsert>;
  readonly updates: ReadonlyArray<DataLayerSyncUpdate>;
  readonly missingInSource: ReadonlyArray<DataLayerSyncMissingInSource>;
  readonly counts: DataLayerSyncCounts;
};

export type DataLayerSyncApplyResult = {
  readonly inserted: number;
  readonly updated: number;
  readonly missingInSource: number;
};

export type DataLayerSyncResult = {
  readonly plan: DataLayerSyncPlan;
  readonly applied: DataLayerSyncApplyResult | null;
};

type EntitySnapshot = {
  readonly entity: DataLayerRegistryEntity;
  readonly kind: DataLayerEntityKind;
  readonly id: string;
  readonly encoded: unknown;
  readonly hash: string;
};

const encodeEntity = Schema.encodeUnknownSync(DataLayerRegistryEntity);

const writeKindOrder: Record<DataLayerEntityKind, number> = {
  Agent: 0,
  Catalog: 1,
  Variable: 2,
  DatasetSeries: 3,
  Dataset: 4,
  DataService: 5,
  Distribution: 6,
  CatalogRecord: 7,
  Series: 8
};

const buildEmptyCounts = (): DataLayerSyncCounts => ({
  Agent: { inserts: 0, updates: 0, missingInSource: 0 },
  Catalog: { inserts: 0, updates: 0, missingInSource: 0 },
  CatalogRecord: { inserts: 0, updates: 0, missingInSource: 0 },
  Dataset: { inserts: 0, updates: 0, missingInSource: 0 },
  Distribution: { inserts: 0, updates: 0, missingInSource: 0 },
  DataService: { inserts: 0, updates: 0, missingInSource: 0 },
  DatasetSeries: { inserts: 0, updates: 0, missingInSource: 0 },
  Variable: { inserts: 0, updates: 0, missingInSource: 0 },
  Series: { inserts: 0, updates: 0, missingInSource: 0 }
});

const allEntities = (
  seed: DataLayerRegistrySeed
): ReadonlyArray<DataLayerRegistryEntity> => [
  ...seed.agents,
  ...seed.catalogs,
  ...seed.catalogRecords,
  ...seed.datasets,
  ...seed.distributions,
  ...seed.dataServices,
  ...seed.datasetSeries,
  ...seed.variables,
  ...seed.series
];

const formatHash = (value: number) => (value >>> 0).toString(16).padStart(8, "0");

const toEntitySnapshot = (entity: DataLayerRegistryEntity): EntitySnapshot => {
  const encoded = encodeEntity(entity);
  return {
    entity,
    kind: entity._tag,
    id: entity.id,
    encoded,
    hash: formatHash(Hash.hash(encoded))
  };
};

const toEntitySnapshotMap = (seed: DataLayerRegistrySeed) =>
  new Map(allEntities(seed).map((entity) => {
    const snapshot = toEntitySnapshot(entity);
    return [snapshot.id, snapshot] as const;
  }));

const compareChangeKeys = (
  left: { readonly kind: DataLayerEntityKind; readonly id: string },
  right: { readonly kind: DataLayerEntityKind; readonly id: string }
) =>
  writeKindOrder[left.kind] - writeKindOrder[right.kind] ||
  left.id.localeCompare(right.id);

const summarizeSection = (
  title: string,
  items: ReadonlyArray<{ readonly kind: DataLayerEntityKind; readonly id: string }>
) => {
  if (items.length === 0) {
    return [] as ReadonlyArray<string>;
  }

  const preview = items
    .slice(0, 12)
    .map((item) => `- ${item.kind}: ${item.id}`);
  const remaining = items.length - preview.length;

  return [
    `${title}: ${String(items.length)}`,
    ...preview,
    ...(remaining > 0 ? [`- ... ${String(remaining)} more`] : [])
  ];
};

export const planDataLayerSync = (
  sourceSeed: DataLayerRegistrySeed,
  currentSeed: DataLayerRegistrySeed
): DataLayerSyncPlan => {
  const counts = buildEmptyCounts();
  const source = toEntitySnapshotMap(sourceSeed);
  const current = toEntitySnapshotMap(currentSeed);

  const inserts: Array<DataLayerSyncInsert> = [];
  const updates: Array<DataLayerSyncUpdate> = [];
  const missingInSource: Array<DataLayerSyncMissingInSource> = [];

  for (const [id, nextSnapshot] of source) {
    const currentSnapshot = current.get(id);

    if (currentSnapshot === undefined) {
      counts[nextSnapshot.kind] = {
        ...counts[nextSnapshot.kind],
        inserts: counts[nextSnapshot.kind].inserts + 1
      };
      inserts.push({
        action: "insert",
        kind: nextSnapshot.kind,
        id,
        hash: nextSnapshot.hash,
        entity: nextSnapshot.entity
      });
      continue;
    }

    if (
      currentSnapshot.hash === nextSnapshot.hash &&
      Equal.equals(currentSnapshot.encoded, nextSnapshot.encoded)
    ) {
      continue;
    }

    counts[nextSnapshot.kind] = {
      ...counts[nextSnapshot.kind],
      updates: counts[nextSnapshot.kind].updates + 1
    };
    updates.push({
      action: "update",
      kind: nextSnapshot.kind,
      id,
      currentHash: currentSnapshot.hash,
      nextHash: nextSnapshot.hash,
      current: currentSnapshot.entity,
      next: nextSnapshot.entity
    });
  }

  for (const [id, currentSnapshot] of current) {
    if (source.has(id)) {
      continue;
    }

    counts[currentSnapshot.kind] = {
      ...counts[currentSnapshot.kind],
      missingInSource: counts[currentSnapshot.kind].missingInSource + 1
    };
    missingInSource.push({
      action: "missing-in-source",
      kind: currentSnapshot.kind,
      id,
      hash: currentSnapshot.hash,
      entity: currentSnapshot.entity
    });
  }

  inserts.sort(compareChangeKeys);
  updates.sort(compareChangeKeys);
  missingInSource.sort(compareChangeKeys);

  return {
    inserts,
    updates,
    missingInSource,
    counts
  };
};

export const formatDataLayerSyncPlan = (plan: DataLayerSyncPlan) => {
  const lines: Array<string> = [
    "Data layer sync plan",
    `- inserts: ${String(plan.inserts.length)}`,
    `- updates: ${String(plan.updates.length)}`,
    `- missing-in-source: ${String(plan.missingInSource.length)}`
  ];

  const kindLines = Object.entries(plan.counts)
    .filter(([, counts]) =>
      counts.inserts > 0 ||
      counts.updates > 0 ||
      counts.missingInSource > 0
    )
    .map(
      ([kind, counts]) =>
        `- ${kind}: +${String(counts.inserts)} ~${String(counts.updates)} -${String(counts.missingInSource)}`
    );

  if (kindLines.length > 0) {
    lines.push("");
    lines.push("By kind");
    lines.push(...kindLines);
  }

  const sections = [
    ...summarizeSection("Insert preview", plan.inserts),
    ...summarizeSection("Update preview", plan.updates),
    ...summarizeSection("Missing-in-source preview", plan.missingInSource)
  ];

  if (sections.length > 0) {
    lines.push("");
    lines.push(...sections);
  }

  if (
    plan.inserts.length === 0 &&
    plan.updates.length === 0 &&
    plan.missingInSource.length === 0
  ) {
    lines.push("");
    lines.push("No changes.");
  }

  return lines.join("\n");
};

const insertEntity = (
  entity: DataLayerRegistryEntity,
  updatedBy: string
) =>
  Effect.gen(function* () {
    switch (entity._tag) {
      case "Agent": {
        const repo = yield* AgentsRepo;
        return yield* repo.insert(entity, { updatedBy });
      }
      case "Catalog": {
        const repo = yield* CatalogsRepo;
        return yield* repo.insert(entity, { updatedBy });
      }
      case "CatalogRecord": {
        const repo = yield* CatalogRecordsRepo;
        return yield* repo.insert(entity, { updatedBy });
      }
      case "Dataset": {
        const repo = yield* DatasetsRepo;
        return yield* repo.insert(entity, { updatedBy });
      }
      case "Distribution": {
        const repo = yield* DistributionsRepo;
        return yield* repo.insert(entity, { updatedBy });
      }
      case "DataService": {
        const repo = yield* DataServicesRepo;
        return yield* repo.insert(entity, { updatedBy });
      }
      case "DatasetSeries": {
        const repo = yield* DatasetSeriesRepo;
        return yield* repo.insert(entity, { updatedBy });
      }
      case "Variable": {
        const repo = yield* VariablesRepo;
        return yield* repo.insert(entity, { updatedBy });
      }
      case "Series": {
        const repo = yield* SeriesRepo;
        return yield* repo.insert(entity, { updatedBy });
      }
    }
  });

const updateEntity = (
  entity: DataLayerRegistryEntity,
  updatedBy: string
) =>
  Effect.gen(function* () {
    switch (entity._tag) {
      case "Agent": {
        const repo = yield* AgentsRepo;
        return yield* repo.update(entity, { updatedBy });
      }
      case "Catalog": {
        const repo = yield* CatalogsRepo;
        return yield* repo.update(entity, { updatedBy });
      }
      case "CatalogRecord": {
        const repo = yield* CatalogRecordsRepo;
        return yield* repo.update(entity, { updatedBy });
      }
      case "Dataset": {
        const repo = yield* DatasetsRepo;
        return yield* repo.update(entity, { updatedBy });
      }
      case "Distribution": {
        const repo = yield* DistributionsRepo;
        return yield* repo.update(entity, { updatedBy });
      }
      case "DataService": {
        const repo = yield* DataServicesRepo;
        return yield* repo.update(entity, { updatedBy });
      }
      case "DatasetSeries": {
        const repo = yield* DatasetSeriesRepo;
        return yield* repo.update(entity, { updatedBy });
      }
      case "Variable": {
        const repo = yield* VariablesRepo;
        return yield* repo.update(entity, { updatedBy });
      }
      case "Series": {
        const repo = yield* SeriesRepo;
        return yield* repo.update(entity, { updatedBy });
      }
    }
  });

export const applyDataLayerSyncPlan = (
  plan: DataLayerSyncPlan,
  options: {
    readonly updatedBy: string;
  }
) =>
  Effect.gen(function* () {
    yield* Effect.forEach(
      plan.inserts,
      (change) => insertEntity(change.entity, options.updatedBy),
      { discard: true }
    );

    yield* Effect.forEach(
      plan.updates,
      (change) => updateEntity(change.next, options.updatedBy),
      { discard: true }
    );

    return {
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      missingInSource: plan.missingInSource.length
    } satisfies DataLayerSyncApplyResult;
  });

export const syncCheckedInDataLayer = (options?: {
  readonly root?: string;
  readonly updatedBy?: string;
  readonly apply?: boolean;
}) =>
  Effect.gen(function* () {
    const sourceSeed = yield* loadCheckedInDataLayerSeed(
      options?.root ?? checkedInDataLayerRegistryRoot
    );
    const currentSeed = yield* loadD1DataLayerSeed();
    const plan = planDataLayerSync(sourceSeed, currentSeed);

    const applied = options?.apply === true
      ? yield* applyDataLayerSyncPlan(plan, {
          updatedBy: options.updatedBy ?? "sync-data-layer"
        })
      : null;

    return {
      plan,
      applied
    } satisfies DataLayerSyncResult;
  });
