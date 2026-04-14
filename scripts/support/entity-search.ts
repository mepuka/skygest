import { SqliteClient } from "@effect/sql-sqlite-bun";
import {
  Config,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path
} from "effect";
import { Flag } from "effect/unstable/cli";
import { isAbsolute, resolve } from "node:path";
import {
  dataLayerRegistrySourceTableArgs
} from "../../src/bootstrap/D1DataLayerRegistry";
import {
  D1SnapshotKeys,
  SearchDbScriptKeys
} from "../../src/platform/ConfigShapes";
import { d1SnapshotLayer } from "../../src/platform/D1SnapshotLayer";

export const sourceDbFlag = Flag.string("source-db").pipe(
  Flag.withDescription(
    "Explicit sqlite path for the canonical data-layer source. When absent, falls back to a D1 snapshot."
  ),
  Flag.optional
);

export const sourceDbNameFlag = Flag.string("source-db-name").pipe(
  Flag.withDescription("Remote D1 database name used as the canonical source"),
  Flag.optional
);

export const searchDbNameFlag = Flag.string("search-db-name").pipe(
  Flag.withDescription("Remote D1 database name for the derived search index"),
  Flag.optional
);

export const freshSnapshotFlag = Flag.boolean("fresh").pipe(
  Flag.withDescription("Force a fresh D1 snapshot instead of reusing the cache"),
  Flag.withDefault(false)
);

export const verifyFlag = Flag.boolean("verify").pipe(
  Flag.withDescription("Run sanity-check queries after the rebuild"),
  Flag.withDefault(true)
);

export const SearchDbScriptConfig = Config.all({
  ...D1SnapshotKeys,
  ...SearchDbScriptKeys
});
export type SearchDbScriptConfig = Config.Success<typeof SearchDbScriptConfig>;

export const toAbsolutePath = (root: string, value: string) =>
  isAbsolute(value) ? value : resolve(root, value);

const clearSnapshotCache = (dbName: string, cacheDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cachePath = path.join(cacheDir, `${dbName}.sqlite`);
    const dumpPath = path.join(cacheDir, `${dbName}.dump.sql`);
    const tmpSqlitePath = `${cachePath}.tmp`;

    yield* fs.remove(cachePath, { force: true }).pipe(Effect.ignore);
    yield* fs.remove(dumpPath, { force: true }).pipe(Effect.ignore);
    yield* fs.remove(tmpSqlitePath, { force: true }).pipe(Effect.ignore);
  });

export const resolveSourceDbName = (
  configured: SearchDbScriptConfig,
  sourceDbName: Option.Option<string>
) =>
  Option.getOrElse(sourceDbName, () => configured.sourceDbName);

export const resolveSearchDbName = (
  configured: SearchDbScriptConfig,
  searchDbName: Option.Option<string>
) =>
  Option.getOrElse(searchDbName, () => configured.searchDbName);

export const resolveEntitySearchSourceSqliteLayer = (
  root: string,
  options: {
    readonly sourceDb: Option.Option<string>;
    readonly sourceDbName: Option.Option<string>;
    readonly fresh: boolean;
  }
): Effect.Effect<
  {
    readonly layer: Layer.Layer<
      SqliteClient.SqliteClient,
      never,
      FileSystem.FileSystem | Path.Path
    >;
    readonly sourceLabel: string;
  },
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const configured = yield* SearchDbScriptConfig;

    if (Option.isSome(options.sourceDb)) {
      const absolutePath = toAbsolutePath(root, options.sourceDb.value);
      return {
        layer: SqliteClient.layer({ filename: absolutePath, readonly: true }),
        sourceLabel: absolutePath
      };
    }

    const sourceDbName = resolveSourceDbName(configured, options.sourceDbName);
    const cacheDir = toAbsolutePath(root, configured.cacheDir);

    if (options.fresh) {
      yield* clearSnapshotCache(sourceDbName, cacheDir);
    }

    return {
      layer: d1SnapshotLayer({
        dbName: sourceDbName,
        cacheDir,
        maxAge: Duration.hours(configured.maxAgeHours),
        extraArgs: dataLayerRegistrySourceTableArgs
      }),
      sourceLabel: sourceDbName
    };
  });
