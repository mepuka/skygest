import { Effect, FileSystem, Layer, Path, Result, Schema } from "effect";
import {
  Agent,
  Catalog,
  CatalogRecord,
  type DataLayerRegistryEntity,
  DataService,
  Dataset,
  DatasetSeries,
  Distribution,
  Series,
  Variable,
  type DataLayerRegistryIssue,
  type DataLayerRegistrySeed
} from "../domain/data-layer";
import {
  DataLayerRegistryLoadError
} from "../domain/errors";
import {
  decodeJsonStringEither,
  formatSchemaParseError
} from "../platform/Json";
import {
  formatDataLayerRegistryDiagnostic,
  prepareDataLayerRegistry,
  toDataLayerRegistryLookup
} from "../resolution/dataLayerRegistry";
import { DataLayerRegistry } from "../services/DataLayerRegistry";

export const checkedInDataLayerRegistryRoot = "references/cold-start";

const directorySpecs = [
  { key: "agents", dir: "catalog/agents", schema: Agent, expectedTag: "Agent" },
  { key: "catalogs", dir: "catalog/catalogs", schema: Catalog, expectedTag: "Catalog" },
  { key: "catalogRecords", dir: "catalog/catalog-records", schema: CatalogRecord, expectedTag: "CatalogRecord" },
  { key: "datasets", dir: "catalog/datasets", schema: Dataset, expectedTag: "Dataset" },
  { key: "distributions", dir: "catalog/distributions", schema: Distribution, expectedTag: "Distribution" },
  { key: "dataServices", dir: "catalog/data-services", schema: DataService, expectedTag: "DataService" },
  { key: "datasetSeries", dir: "catalog/dataset-series", schema: DatasetSeries, expectedTag: "DatasetSeries" },
  { key: "variables", dir: "variables", schema: Variable, expectedTag: "Variable" },
  { key: "series", dir: "series", schema: Series, expectedTag: "Series" }
] as const;

type DirectorySpec = (typeof directorySpecs)[number];

const asIssueList = (issues: ReadonlyArray<DataLayerRegistryIssue>) => [...issues];

const toLoadError = (
  root: string,
  issues: ReadonlyArray<DataLayerRegistryIssue>
) =>
  new DataLayerRegistryLoadError({
    root,
    diagnostic: {
      root,
      issues: asIssueList(issues)
    },
    message: formatDataLayerRegistryDiagnostic({
      root,
      issues: asIssueList(issues)
    })
  });

const readJsonFiles = (
  root: string,
  spec: DirectorySpec
): Effect.Effect<
  ReadonlyArray<{
    readonly path: string;
    readonly entity: DataLayerRegistryEntity;
  }>,
  ReadonlyArray<DataLayerRegistryIssue>,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directoryPath = path.join(root, spec.dir);
    const directoryResult = yield* Effect.exit(fs.readDirectory(directoryPath));
    if (directoryResult._tag === "Failure") {
      return yield* Effect.fail([
        {
          _tag: "FileReadIssue" as const,
          path: directoryPath,
          message: String(directoryResult.cause)
        }
      ]);
    }

    const entries = directoryResult.value;

    const jsonFiles = [...entries]
      .filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))
      .sort((left, right) => left.localeCompare(right));

    const issues: Array<DataLayerRegistryIssue> = [];
    const decoded: Array<{
      readonly path: string;
      readonly entity: DataLayerRegistryEntity;
    }> = [];

    for (const fileName of jsonFiles) {
      const filePath = path.join(directoryPath, fileName);
      const fileResult = yield* Effect.exit(fs.readFileString(filePath));
      if (fileResult._tag === "Failure") {
        issues.push({
          _tag: "FileReadIssue",
          path: filePath,
          message: String(fileResult.cause)
        });
        continue;
      }

      const parsed = decodeJsonStringEither(fileResult.value);
      if (Result.isFailure(parsed)) {
        issues.push({
          _tag: "JsonParseIssue",
          path: filePath,
          message: formatSchemaParseError(parsed.failure)
        });
        continue;
      }

      const raw = parsed.success;
      const actualTag =
        typeof raw === "object" &&
        raw !== null &&
        "_tag" in raw &&
        typeof raw._tag === "string"
          ? raw._tag
          : null;

      if (actualTag !== spec.expectedTag) {
        issues.push({
          _tag: "TagMismatchIssue",
          path: filePath,
          expectedTag: spec.expectedTag,
          actualTag
        });
        continue;
      }

      const entity = Schema.decodeUnknownResult(spec.schema)(raw);
      if (Result.isFailure(entity)) {
        issues.push({
          _tag: "SchemaDecodeIssue",
          path: filePath,
          entityTag: spec.expectedTag,
          message: formatSchemaParseError(entity.failure)
        });
        continue;
      }

      decoded.push({
        path: filePath,
        entity: entity.success as DataLayerRegistryEntity
      });
    }

    if (issues.length > 0) {
      return yield* Effect.fail(issues);
    }

    return decoded;
  });

const loadDecodedSeed = (
  root: string
): Effect.Effect<
  {
    readonly seed: DataLayerRegistrySeed;
    readonly pathById: ReadonlyMap<string, string>;
  },
  DataLayerRegistryLoadError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const issues: Array<DataLayerRegistryIssue> = [];
    const pathById = new Map<string, string>();
    const seedShape: Record<string, Array<unknown>> = {};

    for (const spec of directorySpecs) {
      yield* readJsonFiles(root, spec).pipe(
        Effect.match({
          onFailure: (failure) => {
            issues.push(...failure);
          },
          onSuccess: (items) => {
            seedShape[spec.key] = items.map((item) => {
              pathById.set(item.entity.id, item.path);
              return item.entity;
            });
          }
        })
      );
    }

    if (issues.length > 0) {
      return yield* toLoadError(root, issues);
    }

    return {
      seed: seedShape as unknown as DataLayerRegistrySeed,
      pathById
    };
  });

export const loadCheckedInDataLayerSeed = (
  root = checkedInDataLayerRegistryRoot
): Effect.Effect<DataLayerRegistrySeed, DataLayerRegistryLoadError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const decoded = yield* loadDecodedSeed(root);
    const prepared = prepareDataLayerRegistry(decoded.seed, {
      root,
      pathById: decoded.pathById
    });

    if (Result.isFailure(prepared)) {
      return yield* new DataLayerRegistryLoadError({
        root,
        diagnostic: prepared.failure,
        message: formatDataLayerRegistryDiagnostic(prepared.failure)
      });
    }

    return decoded.seed;
  });

export const loadCheckedInDataLayerRegistry = (
  root = checkedInDataLayerRegistryRoot
) =>
  Effect.gen(function* () {
    const decoded = yield* loadDecodedSeed(root);
    const prepared = prepareDataLayerRegistry(decoded.seed, {
      root,
      pathById: decoded.pathById
    });
    if (Result.isFailure(prepared)) {
      return yield* new DataLayerRegistryLoadError({
        root,
        diagnostic: prepared.failure,
        message: formatDataLayerRegistryDiagnostic(prepared.failure)
      });
    }

    return prepared.success;
  });

export const checkedInDataLayerRegistryLayer = (
  root = checkedInDataLayerRegistryRoot
) =>
  Layer.effect(
    DataLayerRegistry,
    Effect.gen(function* () {
      const prepared = yield* loadCheckedInDataLayerRegistry(root);
      return {
        prepared,
        lookup: toDataLayerRegistryLookup(prepared)
      };
    })
  );
