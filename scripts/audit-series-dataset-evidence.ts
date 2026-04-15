/**
 * SKY-317 evidence audit — reports the series→dataset backfill decision
 * matrix from cold-start candidates.
 *
 * Usage: bun scripts/audit-series-dataset-evidence.ts
 *
 * Emits a table of (seriesSlug, voteCount, status, winningDataset) and a
 * list of zero-evidence series. This is a historical candidate-evidence audit
 * only; active checked-in series links may now also be curated from the
 * catalog when candidate evidence was missing or known-bad.
 */
// Expected footer at plan-freeze time: UNANIMOUS 8  SPLIT 4  NONE 13 (see docs/plans/2026-04-13-sky-317-series-dataset-backfill.md §0.2)
import { Command } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Path, Result, Schema } from "effect";
import {
  SeriesDatasetAuditDecodeError,
  SeriesDatasetAuditIoError
} from "../src/domain/errors";
import {
  decodeJsonStringEitherWith,
  formatSchemaParseError
} from "../src/platform/Json";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";
import { checkedInDataLayerRegistryRoot } from "../src/bootstrap/CheckedInDataLayerRegistry";

type SeriesVote = {
  readonly candidate: string;
  readonly datasetId: string | undefined;
  readonly agentId: string | undefined;
};

type DecisionRow = {
  readonly slug: string;
  readonly votes: number;
  readonly status: "UNANIMOUS" | "SPLIT" | "NONE";
  readonly winner: string | undefined;
  readonly winnerFile: string | undefined;
  readonly winnerPublisher: string | undefined;
};

const SeriesIdMap = Schema.Record(Schema.String, Schema.String);

const AgentInput = Schema.Struct({
  id: Schema.String,
  name: Schema.String
});

const DatasetInput = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  publisherAgentId: Schema.optionalKey(Schema.String)
});

const CandidateInput = Schema.Struct({
  referencedSeriesId: Schema.optionalKey(Schema.String),
  referencedDatasetId: Schema.optionalKey(Schema.String),
  referencedAgentId: Schema.optionalKey(Schema.String)
});

const ioError = (operation: string, path: string, cause: unknown) =>
  new SeriesDatasetAuditIoError({
    operation,
    path,
    message: String(cause)
  });

const loadAndDecode = Effect.fn("audit-series-dataset-evidence.loadAndDecode")(
  function* <A, I>(path: string, schema: Schema.Schema<A, I>) {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs
      .readFileString(path)
      .pipe(Effect.mapError((cause) => ioError("readFileString", path, cause)));

    const decoded = decodeJsonStringEitherWith(schema)(text);
    if (Result.isFailure(decoded)) {
      return yield* new SeriesDatasetAuditDecodeError({
        path,
        message: `failed to decode ${path}`,
        issues: [formatSchemaParseError(decoded.failure)]
      });
    }

    return decoded.success;
  }
);

const runAudit = Effect.fn("audit-series-dataset-evidence.run")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(
    process.cwd(),
    checkedInDataLayerRegistryRoot
  );

  // 1. Load series slug → id map
  const seriesIdsPath = path.join(root, "series", ".series-ids.json");
  const seriesIds = yield* loadAndDecode(seriesIdsPath, SeriesIdMap);

  const slugById = new Map<string, string>();
  for (const [slug, id] of Object.entries(seriesIds)) {
    slugById.set(id, slug);
  }

  // 2. Load agents (id → name)
  const agentsDir = path.join(root, "catalog", "agents");
  const agentFiles = yield* fs
    .readDirectory(agentsDir)
    .pipe(Effect.mapError((cause) => ioError("readDirectory", agentsDir, cause)));
  const agentById = new Map<string, string>();
  for (const file of agentFiles) {
    if (!file.endsWith(".json")) continue;
    const agentPath = path.join(agentsDir, file);
    const parsed = yield* loadAndDecode(agentPath, AgentInput);
    agentById.set(parsed.id, parsed.name);
  }

  // 3. Load datasets (id → { file, title, publisher })
  const datasetsDir = path.join(root, "catalog", "datasets");
  const datasetFiles = yield* fs
    .readDirectory(datasetsDir)
    .pipe(
      Effect.mapError((cause) => ioError("readDirectory", datasetsDir, cause))
    );
  const datasetById = new Map<
    string,
    { file: string; title: string; publisherAgentId?: string }
  >();
  for (const file of datasetFiles) {
    if (!file.endsWith(".json")) continue;
    const datasetPath = path.join(datasetsDir, file);
    const parsed = yield* loadAndDecode(datasetPath, DatasetInput);
    datasetById.set(parsed.id, {
      file,
      title: parsed.title,
      publisherAgentId: parsed.publisherAgentId
    });
  }

  // 4. Walk candidates, collect series votes
  const candidatesDir = path.join(root, "candidates");
  const candidateFiles = yield* fs
    .readDirectory(candidatesDir)
    .pipe(
      Effect.mapError((cause) => ioError("readDirectory", candidatesDir, cause))
    );
  const votesBySlug = new Map<string, Array<SeriesVote>>();

  for (const file of candidateFiles) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    const candidatePath = path.join(candidatesDir, file);
    const parsed = yield* loadAndDecode(candidatePath, CandidateInput);
    if (typeof parsed.referencedSeriesId !== "string") continue;
    const slug = slugById.get(parsed.referencedSeriesId);
    if (slug === undefined) continue;

    const existing = votesBySlug.get(slug) ?? [];
    existing.push({
      candidate: file,
      datasetId: parsed.referencedDatasetId,
      agentId: parsed.referencedAgentId
    });
    votesBySlug.set(slug, existing);
  }

  // 5. Build decision rows
  const rows: Array<DecisionRow> = [];
  for (const slug of [...Object.keys(seriesIds)].sort()) {
    const votes = votesBySlug.get(slug) ?? [];
    const nonNone = votes.filter((v) => v.datasetId !== undefined);
    const distinct = new Set(nonNone.map((v) => v.datasetId));

    if (distinct.size === 0) {
      rows.push({
        slug,
        votes: 0,
        status: "NONE",
        winner: undefined,
        winnerFile: undefined,
        winnerPublisher: undefined
      });
      continue;
    }

    if (distinct.size === 1) {
      const winnerId = [...distinct][0]!;
      const ds = datasetById.get(winnerId);
      const publisher =
        ds?.publisherAgentId !== undefined
          ? agentById.get(ds.publisherAgentId)
          : undefined;
      rows.push({
        slug,
        votes: nonNone.length,
        status: "UNANIMOUS",
        winner: winnerId,
        winnerFile: ds?.file,
        winnerPublisher: publisher
      });
      continue;
    }

    rows.push({
      slug,
      votes: nonNone.length,
      status: "SPLIT",
      winner: undefined,
      winnerFile: undefined,
      winnerPublisher: undefined
    });
  }

  // 6. Print
  yield* Console.log("=== SERIES → DATASET EVIDENCE ===");
  for (const row of rows) {
    const status = row.status.padEnd(10);
    const votes = String(row.votes).padStart(3);
    const title = row.winnerFile ?? "(none)";
    const publisher = row.winnerPublisher ?? "";
    yield* Console.log(
      `${status} ${votes}  ${row.slug.padEnd(42)}  ${title.padEnd(40)}  ${publisher}`
    );
  }

  const unanimousCount = rows.filter((r) => r.status === "UNANIMOUS").length;
  const splitCount = rows.filter((r) => r.status === "SPLIT").length;
  const noneCount = rows.filter((r) => r.status === "NONE").length;
  yield* Console.log(
    `\nUNANIMOUS ${unanimousCount}  SPLIT ${splitCount}  NONE ${noneCount}`
  );
});

const auditSeriesDatasetEvidenceCommand = Command.make(
  "audit-series-dataset-evidence",
  {},
  runAudit
);

const cli = Command.runWith(auditSeriesDatasetEvidenceCommand, {
  version: "0.1.0"
});

runScriptMain(
  "audit-series-dataset-evidence",
  Effect.suspend(() => cli(process.argv.slice(2))).pipe(
    Effect.provide(scriptPlatformLayer)
  )
);
