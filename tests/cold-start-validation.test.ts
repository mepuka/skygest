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

describe("Cold-start validation", () => {
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
});
