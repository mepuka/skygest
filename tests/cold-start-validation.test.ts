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

  it("semantic consistency — linked records belong together", async () => {
    const files = await collectJson(ROOT);
    const entities: Record<string, any> = {};
    for (const file of files) {
      const raw = JSON.parse(await readFile(file, "utf-8"));
      if (raw.id) entities[raw.id] = { ...raw, _file: relative(ROOT, file) };
    }

    const errors: string[] = [];

    for (const e of Object.values(entities)) {
      // Candidate.referencedAgentId must match Dataset.publisherAgentId
      if (e._tag === "Candidate" && e.referencedAgentId && e.referencedDatasetId) {
        const ds = entities[e.referencedDatasetId];
        if (ds?.publisherAgentId && e.referencedAgentId !== ds.publisherAgentId) {
          errors.push(`${e._file}: referencedAgentId disagrees with dataset publisher (agent=${e.referencedAgentId}, dataset publisher=${ds.publisherAgentId})`);
        }
      }

      // Candidate.referencedDistributionId must belong to referencedDatasetId
      if (e._tag === "Candidate" && e.referencedDistributionId && e.referencedDatasetId) {
        const dist = entities[e.referencedDistributionId];
        if (dist && dist.datasetId !== e.referencedDatasetId) {
          errors.push(`${e._file}: referencedDistributionId belongs to dataset ${dist.datasetId}, not ${e.referencedDatasetId}`);
        }
      }

      // Candidate.referencedSeriesId must point to referencedVariableId
      if (e._tag === "Candidate" && e.referencedSeriesId && e.referencedVariableId) {
        const ser = entities[e.referencedSeriesId];
        if (ser && ser.variableId !== e.referencedVariableId) {
          errors.push(`${e._file}: referencedSeriesId points to variable ${ser.variableId}, not ${e.referencedVariableId}`);
        }
      }

      // Distribution.datasetId must point to an existing Dataset
      if (e._tag === "Distribution" && e.datasetId) {
        const ds = entities[e.datasetId];
        if (ds && ds._tag !== "Dataset") {
          errors.push(`${e._file}: datasetId points to a ${ds._tag}, not a Dataset`);
        }
      }

      // Series.variableId must point to an existing Variable
      if (e._tag === "Series" && e.variableId) {
        const v = entities[e.variableId];
        if (v && v._tag !== "Variable") {
          errors.push(`${e._file}: variableId points to a ${v._tag}, not a Variable`);
        }
      }

      // CatalogRecord.catalogId must point to a Catalog
      if (e._tag === "CatalogRecord" && e.catalogId) {
        const cat = entities[e.catalogId];
        if (cat && cat._tag !== "Catalog") {
          errors.push(`${e._file}: catalogId points to a ${cat._tag}, not a Catalog`);
        }
      }
    }

    if (errors.length > 0)
      throw new Error(`Semantic consistency errors:\n${errors.join("\n")}`);
  });
});
