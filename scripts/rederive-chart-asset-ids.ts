import { dirname, isAbsolute, resolve } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import {
  Clock,
  Config,
  Console,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema
} from "effect";
import { SqlClient } from "effect/unstable/sql";
import { Command, Flag } from "effect/unstable/cli";
import { EnrichmentOutput } from "../src/domain/enrichment";
import { PostUri, platformFromUri } from "../src/domain/types";
import { repairChartAssetIdsForPost } from "../src/enrichment/ChartAssetIdRepair";
import { D1SnapshotKeys } from "../src/platform/ConfigShapes";
import { d1SnapshotLayer } from "../src/platform/D1SnapshotLayer";
import { parseUrlLike } from "../src/platform/Normalize";
import {
  encodeJsonStringWith,
  stringifyUnknown
} from "../src/platform/Json";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";
import { decodeJsonColumnWithDbError } from "../src/services/d1/jsonColumns";
import { decodeWithDbError } from "../src/services/d1/schemaDecode";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_SNAPSHOT_DB_NAME = "skygest-staging";
const DEFAULT_FAILURE_LOG_PATH = resolve(
  ROOT,
  ".cache",
  "rederive-chart-asset-ids.failures.jsonl"
);
const DEFAULT_SCAN_LIMIT = 100_000;

const encodeEnrichmentOutput = encodeJsonStringWith(EnrichmentOutput);

const TargetEnrichmentType = Schema.Literals([
  "vision",
  "source-attribution"
]);
type TargetEnrichmentType = Schema.Schema.Type<typeof TargetEnrichmentType>;

const RepairRowSchema = Schema.Struct({
  postUri: PostUri,
  enrichmentType: TargetEnrichmentType,
  enrichmentPayloadJson: Schema.String
});
const RepairRowsSchema = Schema.Array(RepairRowSchema);
type RepairRow = Schema.Schema.Type<typeof RepairRowSchema>;

type FailureLogEntry = {
  readonly postUri: string;
  readonly enrichmentType: TargetEnrichmentType;
  readonly reason: string;
  readonly message: string;
  readonly legacyAssetKeys: ReadonlyArray<string>;
};

type PlannedUpdate = {
  readonly postUri: RepairRow["postUri"];
  readonly enrichmentType: RepairRow["enrichmentType"];
  readonly enrichmentPayloadJson: string;
  readonly replacements: number;
};

type RepairSummary = {
  readonly scanned: number;
  readonly repaired: number;
  readonly alreadyCanonical: number;
  readonly noAssetReferences: number;
  readonly failed: number;
};

const LEGACY_ASSET_STABLE_REF_PATTERN = /^(?:embed|media):\d+:(.+)$/u;
const MISSING_REF_ASSET_KEY_PATTERN = /^(?:embed|media):\d+:missing-ref$/u;
const SERIES_ITEM_KEY_MARKER = ":series:";

const toAbsolutePath = (value: string) =>
  isAbsolute(value) ? value : resolve(ROOT, value);

const ensureParentDirectory = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(dirname(filePath), { recursive: true });
  });

const dbFlag = Flag.string("db").pipe(
  Flag.withDescription(
    "Explicit sqlite path. Required for --apply. When absent, dry-run reads from a cached D1 snapshot."
  ),
  Flag.optional
);

const snapshotDbNameFlag = Flag.string("snapshot-db-name").pipe(
  Flag.withDescription(
    `Wrangler D1 database name to snapshot when --db is absent (default: ${DEFAULT_SNAPSHOT_DB_NAME})`
  ),
  Flag.withDefault(DEFAULT_SNAPSHOT_DB_NAME)
);

const applyFlag = Flag.boolean("apply").pipe(
  Flag.withDescription("Persist the repaired payloads back into the sqlite file"),
  Flag.withDefault(false)
);

const failuresOutFlag = Flag.string("failures-out").pipe(
  Flag.withDescription("Path for the JSONL failure log"),
  Flag.withDefault(DEFAULT_FAILURE_LOG_PATH)
);

const limitFlag = Flag.integer("limit").pipe(
  Flag.withDescription("Maximum number of enrichment rows to scan"),
  Flag.withDefault(DEFAULT_SCAN_LIMIT)
);

const postUriFlag = Flag.string("post-uri").pipe(
  Flag.withDescription("Optional single post URI to scan"),
  Flag.optional
);

const resolveSqlClientLayer = (options: {
  readonly db: Option.Option<string>;
  readonly snapshotDbName: string;
  readonly apply: boolean;
}) =>
  Effect.gen(function* () {
    if (Option.isSome(options.db)) {
      const absolutePath = toAbsolutePath(options.db.value);
      return {
        layer: SqliteClient.layer({
          filename: absolutePath,
          readonly: !options.apply
        }),
        sourceLabel: absolutePath
      };
    }

    if (options.apply) {
      return yield* Effect.fail(
        new Error("--apply requires an explicit --db sqlite path")
      );
    }

    const snapshotConfig = yield* Config.all(D1SnapshotKeys);
    return {
      layer: d1SnapshotLayer({
        dbName: options.snapshotDbName,
        cacheDir: toAbsolutePath(snapshotConfig.cacheDir),
        maxAge: Duration.hours(snapshotConfig.maxAgeHours)
      }),
      sourceLabel: options.snapshotDbName
    };
  });

const loadRepairRows = (
  sql: SqlClient.SqlClient,
  options: {
    readonly postUri: PostUri | null;
    readonly limit: number;
  }
) =>
  sql<any>`
    SELECT
      post_uri as postUri,
      enrichment_type as enrichmentType,
      enrichment_payload_json as enrichmentPayloadJson
    FROM post_enrichments
    WHERE enrichment_type IN ('vision', 'source-attribution')
      AND (post_uri LIKE 'at://%' OR post_uri LIKE 'x://%')
      AND (${options.postUri} IS NULL OR post_uri = ${options.postUri})
    ORDER BY post_uri ASC, enrichment_type ASC
    LIMIT ${options.limit}
  `.pipe(
    Effect.flatMap((rows) =>
      decodeWithDbError(
        RepairRowsSchema,
        rows,
        "Failed to decode candidate enrichment rows for asset-key repair"
      )
    )
  );

const extractLegacyStableRef = (legacyAssetKey: string) => {
  const match = LEGACY_ASSET_STABLE_REF_PATTERN.exec(legacyAssetKey);
  const stableRef = match?.[1];
  return stableRef !== undefined && stableRef.length > 0 ? stableRef : null;
};

const isTwitterVideoStableRef = (stableRef: string) =>
  Option.match(parseUrlLike(stableRef), {
    onNone: () => false,
    onSome: (url) =>
      url.protocol === "https:" &&
      (
        url.hostname === "video.twimg.com" ||
        (
          url.hostname === "pbs.twimg.com" &&
          url.pathname.startsWith("/ext_tw_video_thumb/")
        )
      )
  });

const collectAssetReferenceValues = (value: unknown): ReadonlyArray<string> => {
  const collected: Array<string> = [];

  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }

    if (typeof current !== "object" || current === null) {
      return;
    }

    for (const [key, child] of Object.entries(current)) {
      if (key === "assetKey" && typeof child === "string") {
        collected.push(child);
      } else if (key === "assetKeys" && Array.isArray(child)) {
        for (const entry of child) {
          if (typeof entry === "string") {
            collected.push(entry);
          }
        }
      } else if (key === "itemKey" && typeof child === "string") {
        const markerIndex = child.indexOf(SERIES_ITEM_KEY_MARKER);
        collected.push(
          markerIndex > 0 ? child.slice(0, markerIndex) : child
        );
      }

      visit(child);
    }
  };

  visit(value);
  return collected;
};

const classifyIgnoredFailure = (
  row: RepairRow,
  payload: unknown,
  failure: FailureLogEntry
): "no-asset-references" | null => {
  if (
    failure.reason === "unparseable-legacy-asset-key" &&
    platformFromUri(row.postUri) === "twitter" &&
    failure.legacyAssetKeys.length > 0 &&
    failure.legacyAssetKeys.every((legacyAssetKey) => {
      const stableRef = extractLegacyStableRef(legacyAssetKey);
      return stableRef !== null && isTwitterVideoStableRef(stableRef);
    })
  ) {
    return "no-asset-references";
  }

  if (failure.reason !== "invalid-payload") {
    return null;
  }

  const assetReferences = collectAssetReferenceValues(payload);
  return assetReferences.length > 0 &&
      assetReferences.every((assetReference) =>
        MISSING_REF_ASSET_KEY_PATTERN.test(assetReference)
      )
    ? "no-asset-references"
    : null;
};

const planRepair = (row: RepairRow) =>
  Effect.gen(function* () {
    const payload = yield* decodeJsonColumnWithDbError(
      row.enrichmentPayloadJson,
      `enrichment payload for ${row.postUri}/${row.enrichmentType}`
    );
    const repaired = repairChartAssetIdsForPost({
      postUri: row.postUri,
      payload
    });

    switch (repaired._tag) {
      case "repaired": {
        const enrichmentPayloadJson = yield* Effect.try({
          try: () => encodeEnrichmentOutput(repaired.payload),
          catch: (cause) =>
            new Error(
              `Failed to encode repaired enrichment payload for ${row.postUri}/${row.enrichmentType}: ${stringifyUnknown(cause)}`
            )
        });

        return {
          _tag: "planned-update" as const,
          update: {
            postUri: row.postUri,
            enrichmentType: row.enrichmentType,
            enrichmentPayloadJson,
            replacements: repaired.replacements.length
          } satisfies PlannedUpdate
        };
      }
      case "unchanged":
        return {
          _tag: "unchanged" as const,
          reason: repaired.reason
        };
      case "failed":
        return (() => {
          const ignoredFailureReason = classifyIgnoredFailure(row, payload, {
            postUri: row.postUri,
            enrichmentType: row.enrichmentType,
            reason: repaired.reason,
            message: repaired.message,
            legacyAssetKeys: repaired.legacyAssetKeys
          });

          return ignoredFailureReason === null
            ? {
                _tag: "failed" as const,
                failure: {
                  postUri: row.postUri,
                  enrichmentType: row.enrichmentType,
                  reason: repaired.reason,
                  message: repaired.message,
                  legacyAssetKeys: repaired.legacyAssetKeys
                } satisfies FailureLogEntry
              }
            : {
                _tag: "unchanged" as const,
                reason: ignoredFailureReason
              };
        })();
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        _tag: "failed" as const,
        failure: {
          postUri: row.postUri,
          enrichmentType: row.enrichmentType,
          reason: "script-error",
          message: stringifyUnknown(error),
          legacyAssetKeys: []
        } satisfies FailureLogEntry
      })
    )
  );

const writeFailureLog = (
  filePath: string,
  failures: ReadonlyArray<FailureLogEntry>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* ensureParentDirectory(filePath);
    const contents = failures.map((entry) => JSON.stringify(entry)).join("\n");
    yield* fs.writeFileString(
      filePath,
      contents.length === 0 ? "" : `${contents}\n`
    );
  });

const applyUpdates = (
  sql: SqlClient.SqlClient,
  updates: ReadonlyArray<PlannedUpdate>,
  updatedAt: number
) =>
  sql.withTransaction(
    Effect.forEach(
      updates,
      (update) =>
        sql`
          UPDATE post_enrichments
          SET enrichment_payload_json = ${update.enrichmentPayloadJson},
              updated_at = ${updatedAt}
          WHERE post_uri = ${update.postUri}
            AND enrichment_type = ${update.enrichmentType}
        `.pipe(Effect.asVoid),
      { discard: true }
    )
  );

const buildSummary = (
  rows: ReadonlyArray<RepairRow>,
  plannedUpdates: ReadonlyArray<PlannedUpdate>,
  unchanged: ReadonlyArray<"no-asset-references" | "already-canonical">,
  failures: ReadonlyArray<FailureLogEntry>
): RepairSummary => ({
  scanned: rows.length,
  repaired: plannedUpdates.length,
  alreadyCanonical: unchanged.filter((reason) => reason === "already-canonical")
    .length,
  noAssetReferences: unchanged.filter(
    (reason) => reason === "no-asset-references"
  ).length,
  failed: failures.length
});

const command = Command.make(
  "rederive-chart-asset-ids",
  {
    db: dbFlag,
    snapshotDbName: snapshotDbNameFlag,
    apply: applyFlag,
    failuresOut: failuresOutFlag,
    limit: limitFlag,
    postUri: postUriFlag
  },
  ({ db, snapshotDbName, apply, failuresOut, limit, postUri }) =>
    Effect.gen(function* () {
      const failuresOutPath = toAbsolutePath(failuresOut);
      const filterPostUri = Option.match(postUri, {
        onNone: () => null,
        onSome: (value) =>
          Schema.decodeUnknownSync(PostUri)(value)
      });
      const sqlClient = yield* resolveSqlClientLayer({
        db,
        snapshotDbName,
        apply
      });
      const program = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* loadRepairRows(sql, {
          postUri: filterPostUri,
          limit
        });

        const plannedUpdates: Array<PlannedUpdate> = [];
        const unchanged: Array<"no-asset-references" | "already-canonical"> = [];
        const failures: Array<FailureLogEntry> = [];

        const plans = yield* Effect.forEach(rows, planRepair, {
          concurrency: 20
        });

        for (const plan of plans) {
          switch (plan._tag) {
            case "planned-update":
              plannedUpdates.push(plan.update);
              break;
            case "unchanged":
              unchanged.push(plan.reason);
              break;
            case "failed":
              failures.push(plan.failure);
              break;
          }
        }

        yield* writeFailureLog(failuresOutPath, failures);

        const summary = buildSummary(rows, plannedUpdates, unchanged, failures);

        yield* Console.log(
          `Scanned ${String(summary.scanned)} enrichment rows from ${sqlClient.sourceLabel}.`
        );
        yield* Console.log(
          `Repaired ${String(summary.repaired)} rows, left ${String(summary.alreadyCanonical)} already canonical, left ${String(summary.noAssetReferences)} without asset references, and logged ${String(summary.failed)} failures.`
        );

        if (!apply) {
          yield* Console.log(
            `Dry run only. Failure log written to ${failuresOutPath}. Re-run with --apply --db <path> to persist the repaired rows.`
          );
          return;
        }

        const updatedAt = yield* Clock.currentTimeMillis;
        yield* applyUpdates(sql, plannedUpdates, updatedAt);
        yield* Console.log(
          `Applied ${String(plannedUpdates.length)} row updates at ${String(updatedAt)}. Failure log written to ${failuresOutPath}.`
        );
      }).pipe(Effect.provide(sqlClient.layer));

      yield* program;
    })
);

const cli = Command.runWith(command, {
  version: "0.1.0"
});

if (import.meta.main) {
  runScriptMain(
    "rederive-chart-asset-ids",
    Effect.suspend(() => cli(Array.from(process.argv).slice(2))).pipe(
      Effect.provide(scriptPlatformLayer)
    )
  );
}
