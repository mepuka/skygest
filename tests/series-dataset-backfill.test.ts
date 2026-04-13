import { describe, expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { Series } from "../src/domain/data-layer";

const ROOT = "references/cold-start";
const BACKFILL_PATH = `${ROOT}/series/.series-dataset-backfill.json`;

type BackfillManifest = {
  readonly version: 1;
  readonly explicit: Record<
    string,
    {
      readonly datasetId: string;
      readonly datasetFile: string;
      readonly evidence: string;
    }
  >;
  readonly deliberatelyOmitted: Record<string, { readonly reason: string }>;
  readonly zeroEvidence: ReadonlyArray<string>;
};

const loadBackfill = (): BackfillManifest =>
  JSON.parse(readFileSync(BACKFILL_PATH, "utf-8")) as BackfillManifest;

const loadSeries = (slug: string) =>
  Schema.decodeUnknownSync(Series)(
    JSON.parse(readFileSync(`${ROOT}/series/${slug}.json`, "utf-8"))
  );

const loadDataset = (file: string): { id: string; publisherAgentId?: string } =>
  JSON.parse(
    readFileSync(`${ROOT}/catalog/datasets/${file}`, "utf-8")
  );

const loadAllCandidates = () => {
  const dir = `${ROOT}/candidates`;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .map(
      (f) =>
        JSON.parse(readFileSync(join(dir, f), "utf-8")) as {
          referencedSeriesId?: string;
          referencedDatasetId?: string;
          referencedAgentId?: string;
        }
    );
};

describe("SKY-317 series→dataset backfill", () => {
  it("every explicit backfill pair resolves to a real dataset file", () => {
    const manifest = loadBackfill();
    for (const [slug, spec] of Object.entries(manifest.explicit)) {
      const ds = loadDataset(spec.datasetFile);
      expect(ds.id, `${slug} dataset file id mismatch`).toBe(spec.datasetId);
    }
  });

  it("every explicit-backfill series file carries datasetId matching the manifest", () => {
    const manifest = loadBackfill();
    for (const [slug, spec] of Object.entries(manifest.explicit)) {
      const series = loadSeries(slug);
      expect(
        series.datasetId,
        `${slug} should have datasetId set to ${spec.datasetId}`
      ).toBe(spec.datasetId);
    }
  });

  it("deliberately-omitted series files do NOT have datasetId set", () => {
    const manifest = loadBackfill();
    for (const slug of Object.keys(manifest.deliberatelyOmitted)) {
      const series = loadSeries(slug);
      expect(
        series.datasetId,
        `${slug} is in deliberatelyOmitted and must have datasetId undefined`
      ).toBeUndefined();
    }
  });

  it("zero-evidence series files do NOT have datasetId set", () => {
    const manifest = loadBackfill();
    for (const slug of manifest.zeroEvidence) {
      const series = loadSeries(slug);
      expect(
        series.datasetId,
        `${slug} has no candidate evidence and must have datasetId undefined`
      ).toBeUndefined();
    }
  });

  it("every backfilled dataset's publisherAgentId matches all candidates' referencedAgentId", () => {
    const manifest = loadBackfill();
    const candidates = loadAllCandidates();
    for (const [slug, spec] of Object.entries(manifest.explicit)) {
      const dataset = loadDataset(spec.datasetFile);
      const series = loadSeries(slug);
      const voters = candidates.filter(
        (c) => c.referencedSeriesId === series.id && c.referencedDatasetId !== undefined
      );
      expect(
        voters.length,
        `${slug} should have at least one voting candidate`
      ).toBeGreaterThan(0);
      for (const voter of voters) {
        expect(
          voter.referencedAgentId,
          `${slug} voter ${voter.referencedSeriesId} referencedAgentId should match dataset.publisherAgentId`
        ).toBe(dataset.publisherAgentId);
      }
    }
  });

  it("for every candidate that references both a series and a dataset, the series' datasetId agrees (when present)", () => {
    const candidates = loadAllCandidates();
    // Build seriesId → datasetId map from the 25 series files
    const seriesDir = `${ROOT}/series`;
    const seriesById = new Map<string, { slug: string; datasetId: string | undefined }>();
    for (const file of readdirSync(seriesDir)) {
      if (!file.endsWith(".json") || file.startsWith(".")) continue;
      const slug = file.replace(/\.json$/, "");
      const series = loadSeries(slug);
      seriesById.set(series.id, { slug, datasetId: series.datasetId });
    }

    const conflicts: Array<string> = [];
    for (const c of candidates) {
      if (
        typeof c.referencedSeriesId !== "string" ||
        typeof c.referencedDatasetId !== "string"
      )
        continue;
      const series = seriesById.get(c.referencedSeriesId);
      if (series?.datasetId === undefined) continue;
      if (series.datasetId !== c.referencedDatasetId) {
        conflicts.push(
          `series ${series.slug} has datasetId ${series.datasetId} but candidate votes ${c.referencedDatasetId}`
        );
      }
    }

    expect(
      conflicts,
      `no candidate may disagree with a backfilled series.datasetId:\n${conflicts.join("\n")}`
    ).toEqual([]);
  });
});
