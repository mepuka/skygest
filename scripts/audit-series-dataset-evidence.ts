/**
 * SKY-317 evidence audit — reports the series→dataset backfill decision
 * matrix from cold-start candidates.
 *
 * Usage: bun scripts/audit-series-dataset-evidence.ts
 *
 * Emits a table of (seriesSlug, voteCount, status, winningDataset) and a
 * list of zero-evidence series. Treats the candidate corpus as ground truth
 * — never invents pairings.
 */
import { Command } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Path, Result, Schema } from "effect";
import {
  decodeJsonStringEitherWith,
  formatSchemaParseError
} from "../src/platform/Json";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

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

const decodeSeriesIdMap = decodeJsonStringEitherWith(SeriesIdMap);

const runAudit = Effect.fn("audit-series-dataset-evidence.run")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(process.cwd(), "references/cold-start");

  // 1. Load series slug → id map
  const seriesIdsPath = path.join(root, "series", ".series-ids.json");
  const seriesIdsText = yield* fs.readFileString(seriesIdsPath).pipe(
    Effect.mapError(
      (cause) =>
        new Error(`failed to read ${seriesIdsPath}: ${String(cause)}`)
    )
  );
  const decodedSeriesIds = decodeSeriesIdMap(seriesIdsText);
  if (Result.isFailure(decodedSeriesIds)) {
    return yield* Effect.fail(
      new Error(
        `invalid series id map at ${seriesIdsPath}: ${formatSchemaParseError(decodedSeriesIds.failure)}`
      )
    );
  }
  const seriesIds = decodedSeriesIds.success;

  const slugById = new Map<string, string>();
  for (const [slug, id] of Object.entries(seriesIds)) {
    slugById.set(id, slug);
  }

  // 2. Load agents (id → name)
  const agentsDir = path.join(root, "catalog", "agents");
  const agentFiles = yield* fs.readDirectory(agentsDir).pipe(
    Effect.mapError(
      (cause) => new Error(`failed to list ${agentsDir}: ${String(cause)}`)
    )
  );
  const agentById = new Map<string, string>();
  for (const file of agentFiles) {
    if (!file.endsWith(".json")) continue;
    const agentPath = path.join(agentsDir, file);
    const text = yield* fs.readFileString(agentPath).pipe(
      Effect.mapError(
        (cause) => new Error(`failed to read ${agentPath}: ${String(cause)}`)
      )
    );
    const parsed = JSON.parse(text) as { id: string; name: string };
    agentById.set(parsed.id, parsed.name);
  }

  // 3. Load datasets (id → { file, title, publisher })
  const datasetsDir = path.join(root, "catalog", "datasets");
  const datasetFiles = yield* fs.readDirectory(datasetsDir).pipe(
    Effect.mapError(
      (cause) => new Error(`failed to list ${datasetsDir}: ${String(cause)}`)
    )
  );
  const datasetById = new Map<
    string,
    { file: string; title: string; publisherAgentId?: string }
  >();
  for (const file of datasetFiles) {
    if (!file.endsWith(".json")) continue;
    const datasetPath = path.join(datasetsDir, file);
    const text = yield* fs.readFileString(datasetPath).pipe(
      Effect.mapError(
        (cause) => new Error(`failed to read ${datasetPath}: ${String(cause)}`)
      )
    );
    const parsed = JSON.parse(text) as {
      id: string;
      title: string;
      publisherAgentId?: string;
    };
    datasetById.set(parsed.id, {
      file,
      title: parsed.title,
      publisherAgentId: parsed.publisherAgentId
    });
  }

  // 4. Walk candidates, collect series votes
  const candidatesDir = path.join(root, "candidates");
  const candidateFiles = yield* fs.readDirectory(candidatesDir).pipe(
    Effect.mapError(
      (cause) => new Error(`failed to list ${candidatesDir}: ${String(cause)}`)
    )
  );
  const votesBySlug = new Map<string, Array<SeriesVote>>();

  for (const file of candidateFiles) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    const candidatePath = path.join(candidatesDir, file);
    const text = yield* fs.readFileString(candidatePath).pipe(
      Effect.mapError(
        (cause) =>
          new Error(`failed to read ${candidatePath}: ${String(cause)}`)
      )
    );
    const parsed = JSON.parse(text) as {
      referencedSeriesId?: string;
      referencedDatasetId?: string;
      referencedAgentId?: string;
    };
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
