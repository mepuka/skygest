import { Clock, Effect, Exit, FileSystem, Path, Result } from "effect";
import {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  Distribution
} from "../../domain/data-layer";
import {
  decodeJsonStringEitherWith,
  encodeJsonStringPrettyWith,
  formatSchemaParseError,
  stringifyUnknown
} from "../../platform/Json";
import type { IngestNode } from "./IngestNode";

const encodeAgentPretty = encodeJsonStringPrettyWith(Agent);
const encodeCatalogPretty = encodeJsonStringPrettyWith(Catalog);
const encodeDataServicePretty = encodeJsonStringPrettyWith(DataService);
const encodeDatasetPretty = encodeJsonStringPrettyWith(Dataset);
const encodeDistributionPretty = encodeJsonStringPrettyWith(Distribution);
const encodeCatalogRecordPretty = encodeJsonStringPrettyWith(CatalogRecord);

export const entityFilePathForNode = (
  path_: Path.Path,
  rootDir: string,
  node: IngestNode
): string => {
  switch (node._tag) {
    case "agent":
      return path_.resolve(rootDir, "catalog", "agents", `${node.slug}.json`);
    case "catalog":
      return path_.resolve(rootDir, "catalog", "catalogs", `${node.slug}.json`);
    case "data-service":
      return path_.resolve(
        rootDir,
        "catalog",
        "data-services",
        `${node.slug}.json`
      );
    case "dataset":
      return path_.resolve(rootDir, "catalog", "datasets", `${node.slug}.json`);
    case "distribution":
      return path_.resolve(
        rootDir,
        "catalog",
        "distributions",
        `${node.slug}.json`
      );
    case "catalog-record":
      return path_.resolve(
        rootDir,
        "catalog",
        "catalog-records",
        `${node.slug}.json`
      );
  }
};

export const encodeNodeData = (node: IngestNode): string => {
  switch (node._tag) {
    case "agent":
      return encodeAgentPretty(node.data);
    case "catalog":
      return encodeCatalogPretty(node.data);
    case "data-service":
      return encodeDataServicePretty(node.data);
    case "dataset":
      return encodeDatasetPretty(node.data);
    case "distribution":
      return encodeDistributionPretty(node.data);
    case "catalog-record":
      return encodeCatalogRecordPretty(node.data);
  }
};

const decodeExistingNodeDataWith = <E>(
  node: IngestNode,
  content: string,
  mapDecodeError: (message: string) => E
): Effect.Effect<IngestNode["data"], E> => {
  switch (node._tag) {
    case "agent": {
      const decoded = decodeJsonStringEitherWith(Agent)(content);
      if (Result.isFailure(decoded)) {
        return Effect.fail(
          mapDecodeError(
            `Cannot decode existing agent file for ${node.slug}: ${formatSchemaParseError(decoded.failure)}`
          )
        );
      }
      return Effect.succeed(decoded.success);
    }
    case "catalog": {
      const decoded = decodeJsonStringEitherWith(Catalog)(content);
      if (Result.isFailure(decoded)) {
        return Effect.fail(
          mapDecodeError(
            `Cannot decode existing catalog file for ${node.slug}: ${formatSchemaParseError(decoded.failure)}`
          )
        );
      }
      return Effect.succeed(decoded.success);
    }
    case "data-service": {
      const decoded = decodeJsonStringEitherWith(DataService)(content);
      if (Result.isFailure(decoded)) {
        return Effect.fail(
          mapDecodeError(
            `Cannot decode existing data-service file for ${node.slug}: ${formatSchemaParseError(decoded.failure)}`
          )
        );
      }
      return Effect.succeed(decoded.success);
    }
    case "dataset": {
      const decoded = decodeJsonStringEitherWith(Dataset)(content);
      if (Result.isFailure(decoded)) {
        return Effect.fail(
          mapDecodeError(
            `Cannot decode existing dataset file for ${node.slug}: ${formatSchemaParseError(decoded.failure)}`
          )
        );
      }
      return Effect.succeed(decoded.success);
    }
    case "distribution": {
      const decoded = decodeJsonStringEitherWith(Distribution)(content);
      if (Result.isFailure(decoded)) {
        return Effect.fail(
          mapDecodeError(
            `Cannot decode existing distribution file for ${node.slug}: ${formatSchemaParseError(decoded.failure)}`
          )
        );
      }
      return Effect.succeed(decoded.success);
    }
    case "catalog-record": {
      const decoded = decodeJsonStringEitherWith(CatalogRecord)(content);
      if (Result.isFailure(decoded)) {
        return Effect.fail(
          mapDecodeError(
            `Cannot decode existing catalog-record file for ${node.slug}: ${formatSchemaParseError(decoded.failure)}`
          )
        );
      }
      return Effect.succeed(decoded.success);
    }
  }
};

export const isNotFoundPlatformError = (cause: unknown): boolean => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    (cause as { readonly _tag: unknown })._tag === "PlatformError" &&
    "reason" in cause
  ) {
    const reason = (cause as { readonly reason: unknown }).reason;
    if (
      typeof reason === "object" &&
      reason !== null &&
      "_tag" in reason &&
      (reason as { readonly _tag: unknown })._tag === "NotFound"
    ) {
      return true;
    }
  }
  const msg = stringifyUnknown(cause).toLowerCase();
  return (
    msg.includes("notfound") ||
    msg.includes("enoent") ||
    msg.includes("no such file")
  );
};

export const writeEntityFileWith = <E>(
  filePath: string,
  content: string,
  mapFsError: (input: {
    readonly operation: string;
    readonly path: string;
    readonly message: string;
  }) => E
): Effect.Effect<void, E, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const dir = path_.dirname(filePath);
    const now = yield* Clock.currentTimeMillis;
    const tmp = `${filePath}.tmp-${String(now)}`;
    yield* fs_.makeDirectory(dir, { recursive: true }).pipe(
      Effect.mapError((cause) =>
        mapFsError({
          operation: "makeDirectory",
          path: dir,
          message: stringifyUnknown(cause)
        })
      )
    );
    yield* fs_.writeFileString(tmp, content).pipe(
      Effect.mapError((cause) =>
        mapFsError({
          operation: "writeFileString",
          path: tmp,
          message: stringifyUnknown(cause)
        })
      )
    );
    yield* fs_.rename(tmp, filePath).pipe(
      Effect.mapError((cause) =>
        mapFsError({
          operation: "rename",
          path: filePath,
          message: stringifyUnknown(cause)
        })
      ),
      Effect.tapError(() => fs_.remove(tmp).pipe(Effect.ignore))
    );
  });

export const assertNodeOwnsWriteTargetWith = <E>(
  path_: Path.Path,
  rootDir: string,
  node: IngestNode,
  mapLedgerError: (message: string) => E
): Effect.Effect<string, E, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const filePath = entityFilePathForNode(path_, rootDir, node);
    const readExit = yield* Effect.exit(fs_.readFileString(filePath));

    if (Exit.isFailure(readExit)) {
      if (isNotFoundPlatformError(readExit.cause)) {
        return filePath;
      }

      return yield* Effect.fail(
        mapLedgerError(
          `Cannot read existing ${node._tag} file at ${filePath}: ${stringifyUnknown(readExit.cause)}`
        )
      );
    }

    const existing = yield* decodeExistingNodeDataWith(
      node,
      readExit.value,
      mapLedgerError
    );
    if (existing.id !== node.data.id) {
      return yield* Effect.fail(
        mapLedgerError(
          `Refusing to overwrite ${filePath}: existing ${node._tag} id ${existing.id} does not match ${node.data.id}`
        )
      );
    }

    return filePath;
  });
