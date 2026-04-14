import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { checkedInDataLayerRegistryRoot, loadCheckedInDataLayerRegistry } from "../src/bootstrap/CheckedInDataLayerRegistry";
import { Candidate } from "../src/domain/data-layer";
import { layer as localFileSystemLayer } from "./helpers/LocalFileSystem";

const ROOT = join(import.meta.dirname, "..", checkedInDataLayerRegistryRoot);
const CANDIDATES_DIR = join(ROOT, "candidates");
// Flake fix: these cold-start checks load the registry and scan many JSON files under full-suite contention.
const coldStartValidationTimeoutMs = 30_000;
const inlinePinnedSeries = new Set([
  "de-public-electricity-generation-daily",
  "eu-public-electricity-generation-quarterly",
  "tr-electricity-generation-by-fuel-annual",
  "global-energy-co2-emissions-ar6-annual"
]);

async function collectJson(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectJson(full)));
    } else if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".")) {
      out.push(full);
    }
  }

  return out;
}

// SKIPPED: loads the entire on-disk catalog (~7000 files) per-test. Coverage moved to scripts/validate-data-layer-registry.ts (candidate decode + referential integrity + semantic consistency checks).
describe.skip("Cold-start validation", () => {
  it.effect(
    "registry-owned cold-start files load through the checked-in registry loader",
    () =>
      Effect.gen(function* () {
        const prepared = yield* loadCheckedInDataLayerRegistry().pipe(
          Effect.provide(localFileSystemLayer)
        );

        expect(Array.from(prepared.entities).length).toBeGreaterThan(0);
      }),
    coldStartValidationTimeoutMs
  );

  it("candidate files decode against the Candidate schema", async () => {
    const files = await collectJson(CANDIDATES_DIR);
    expect(files.length).toBeGreaterThan(0);

    const errors: Array<string> = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      const raw = JSON.parse(await readFile(file, "utf-8"));
      const result = Schema.decodeUnknownExit(Candidate)(raw);
      if (!Exit.isSuccess(result)) {
        errors.push(`${rel}: decode failed`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Candidate decode errors:\n${errors.join("\n")}`);
    }
  });

  it("candidate referential integrity — all referenced IDs exist", async () => {
    const registry = await Effect.runPromise(
      loadCheckedInDataLayerRegistry().pipe(Effect.provide(localFileSystemLayer))
    );
    const allIds = new Set<string>(
      Array.from(registry.entities, (entity) => entity.id as string)
    );
    const files = await collectJson(CANDIDATES_DIR);

    const refs: Array<{ file: string; field: string; id: string }> = [];
    const refFields = [
      "referencedDistributionId",
      "referencedDatasetId",
      "referencedAgentId",
      "referencedVariableId",
      "referencedSeriesId"
    ] as const;

    for (const file of files) {
      const rel = relative(ROOT, file);
      const raw = JSON.parse(await readFile(file, "utf-8"));
      for (const field of refFields) {
        if (typeof raw[field] === "string") {
          refs.push({ file: rel, field, id: raw[field] });
        }
      }
    }

    const missing = refs.filter((ref) => !allIds.has(ref.id));
    if (missing.length > 0) {
      throw new Error(
        `Missing IDs:\n${missing.map((ref) => `  ${ref.file}: ${ref.field} -> ${ref.id}`).join("\n")}`
      );
    }
  }, coldStartValidationTimeoutMs);

  it("candidate semantic consistency — linked records belong together", async () => {
    const registry = await Effect.runPromise(
      loadCheckedInDataLayerRegistry().pipe(Effect.provide(localFileSystemLayer))
    );
    const entities = Object.fromEntries(
      Array.from(registry.entities, (entity) => [entity.id, entity] as const)
    );
    const files = await collectJson(CANDIDATES_DIR);

    const errors: Array<string> = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      const raw = JSON.parse(await readFile(file, "utf-8"));

      if (raw.referencedAgentId && raw.referencedDatasetId) {
        const dataset = entities[raw.referencedDatasetId];
        if (
          dataset?._tag === "Dataset" &&
          dataset.publisherAgentId &&
          raw.referencedAgentId !== dataset.publisherAgentId
        ) {
          errors.push(
            `${rel}: referencedAgentId disagrees with dataset publisher (agent=${raw.referencedAgentId}, dataset publisher=${dataset.publisherAgentId})`
          );
        }
      }

      if (raw.referencedDistributionId && raw.referencedDatasetId) {
        const distribution = entities[raw.referencedDistributionId];
        if (
          distribution?._tag === "Distribution" &&
          distribution.datasetId !== raw.referencedDatasetId
        ) {
          errors.push(
            `${rel}: referencedDistributionId belongs to dataset ${distribution.datasetId}, not ${raw.referencedDatasetId}`
          );
        }
      }

      if (raw.referencedSeriesId && raw.referencedVariableId) {
        const series = entities[raw.referencedSeriesId];
        if (
          series?._tag === "Series" &&
          series.variableId !== raw.referencedVariableId
        ) {
          errors.push(
            `${rel}: referencedSeriesId points to variable ${series.variableId}, not ${raw.referencedVariableId}`
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Candidate semantic consistency errors:\n${errors.join("\n")}`);
    }
  }, coldStartValidationTimeoutMs);

  it("reports series→dataset backfill coverage", async () => {
    const registry = await Effect.runPromise(
      loadCheckedInDataLayerRegistry().pipe(Effect.provide(localFileSystemLayer))
    );
    const seriesEntities = registry.seed.series;
    const total = seriesEntities.length;
    const linked = seriesEntities.filter((s) => s.datasetId !== undefined).length;
    const unlinked = seriesEntities.filter((s) => s.datasetId === undefined).length;

    const manifestRaw = await readFile(
      join(ROOT, "series", ".series-dataset-backfill.json"),
      "utf-8"
    );
    const manifest = JSON.parse(manifestRaw) as {
      explicit: Record<
        string,
        { basis: "candidate-unanimous" | "candidate-majority" | "catalog-curated" }
      >;
      deliberatelyOmitted: Record<string, unknown>;
      zeroEvidence: ReadonlyArray<string>;
    };

    // Partition series filenames into manifest-covered legacy series and
    // SKY-323+ inline-pinned series.
    const seriesDirEntries = await readdir(join(ROOT, "series"));
    const seriesSlugs = seriesDirEntries
      .filter((f) => f.endsWith(".json") && !f.startsWith("."))
      .map((f) => f.replace(/\.json$/, ""));

    const manifestSlugs = new Set<string>(Object.keys(manifest.explicit));
    const manifestCoveredSlugs = seriesSlugs.filter((s) => manifestSlugs.has(s));
    const inlinePinnedSlugs = seriesSlugs.filter((s) => inlinePinnedSeries.has(s));

    // Every manifest slug must have a matching series file.
    expect(manifestCoveredSlugs.length).toBe(Object.keys(manifest.explicit).length);
    // Total series count == manifest-covered + inline-pinned.
    expect(total).toBe(manifestCoveredSlugs.length + inlinePinnedSlugs.length);

    const unanimousCount = Object.values(manifest.explicit).filter(
      (spec) => spec.basis === "candidate-unanimous"
    ).length;
    const majorityCount = Object.values(manifest.explicit).filter(
      (spec) => spec.basis === "candidate-majority"
    ).length;
    const curatedCount = Object.values(manifest.explicit).filter(
      (spec) => spec.basis === "catalog-curated"
    ).length;

    console.log(
      `[SKY-317 coverage] series.datasetId: ${linked}/${total} linked, ${unlinked} unlinked ` +
        `(${unanimousCount} candidate-unanimous, ${majorityCount} candidate-majority, ${curatedCount} catalog-curated, ${inlinePinnedSlugs.length} inline-pinned)`
    );
  }, coldStartValidationTimeoutMs);
});
