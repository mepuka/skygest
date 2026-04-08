import { describe, expect, it } from "@effect/vitest";
import { Schema, Exit } from "effect";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  Variable, Series, Observation, Candidate,
  Agent, Catalog, CatalogRecord, Dataset, Distribution, DataService, DatasetSeries,
} from "../src/domain/data-layer";

const ROOT = join(import.meta.dirname, "..", "references", "cold-start");

const SCHEMAS: Record<string, Schema.Schema<any>> = {
  Variable, Series, Observation, Candidate,
  Agent, Catalog, CatalogRecord, Dataset, Distribution, DataService, DatasetSeries,
};

async function collectJson(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && !["reports", "survey"].includes(e.name)) out.push(...await collectJson(full));
    else if (e.isFile() && e.name.endsWith(".json") && !e.name.startsWith(".")) out.push(full);
  }
  return out;
}

describe("Cold-start validation", () => {
  it("all JSON files decode against their schema", async () => {
    const files = await collectJson(ROOT);
    expect(files.length).toBeGreaterThan(0);
    const errors: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      const raw = JSON.parse(await readFile(file, "utf-8"));
      const tag = raw._tag;
      if (!tag || !SCHEMAS[tag]) { errors.push(`${rel}: unknown _tag "${tag}"`); continue; }
      const result = Schema.decodeUnknownExit(SCHEMAS[tag])(raw);
      if (!Exit.isSuccess(result)) {
        errors.push(`${rel}: decode failed — ${JSON.stringify(result.cause).slice(0, 200)}`);
      }
    }
    if (errors.length > 0) throw new Error(`Decode errors:\n${errors.join("\n")}`);
  });

  it("referential integrity — all referenced IDs exist", async () => {
    const files = await collectJson(ROOT);
    const allIds = new Set<string>();
    const refs: Array<{ file: string; field: string; id: string }> = [];
    const REF_FIELDS = [
      "variableId", "seriesId", "sourceDistributionId", "publisherAgentId",
      "parentAgentId", "catalogId", "primaryTopicId", "datasetId",
      "accessServiceId", "duplicateOf", "inSeries",
      "referencedDistributionId", "referencedDatasetId", "referencedAgentId",
      "referencedVariableId", "referencedSeriesId",
    ];
    const REF_ARRAYS = ["distributionIds", "dataServiceIds", "servesDatasetIds"];

    for (const file of files) {
      const rel = relative(ROOT, file);
      const raw = JSON.parse(await readFile(file, "utf-8"));
      if (raw.id) allIds.add(raw.id);
      for (const f of REF_FIELDS) {
        if (raw[f] && typeof raw[f] === "string" && raw[f].startsWith("https://id.skygest.io/"))
          refs.push({ file: rel, field: f, id: raw[f] });
      }
      for (const f of REF_ARRAYS) {
        if (Array.isArray(raw[f])) for (const id of raw[f])
          if (typeof id === "string" && id.startsWith("https://id.skygest.io/"))
            refs.push({ file: rel, field: f, id });
      }
    }
    const missing = refs.filter(r => !allIds.has(r.id));
    if (missing.length > 0)
      throw new Error(`Missing IDs:\n${missing.map(m => `  ${m.file}: ${m.field} → ${m.id}`).join("\n")}`);
  });
});
