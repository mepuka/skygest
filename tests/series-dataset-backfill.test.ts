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
      readonly basis:
        | "candidate-unanimous"
        | "candidate-majority"
        | "catalog-curated";
    }
  >;
  readonly deliberatelyOmitted: Record<string, { readonly reason: string }>;
  readonly zeroEvidence: ReadonlyArray<string>;
};

const inlinePinnedSeries = new Set([
  "de-public-electricity-generation-daily",
  "eu-public-electricity-generation-quarterly",
  "tr-electricity-generation-by-fuel-annual",
  "global-energy-co2-emissions-ar6-annual"
]);

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
  it("covers every non-inline series with an explicit dataset pairing", () => {
    const manifest = loadBackfill();
    const seriesDir = `${ROOT}/series`;
    const nonInlineSeries = readdirSync(seriesDir)
      .filter((f) => f.endsWith(".json") && !f.startsWith("."))
      .map((f) => f.replace(/\.json$/, ""))
      .filter((slug) => !inlinePinnedSeries.has(slug))
      .sort();

    expect(Object.keys(manifest.explicit).sort()).toEqual(nonInlineSeries);
    expect(Object.keys(manifest.deliberatelyOmitted)).toEqual([]);
    expect(manifest.zeroEvidence).toEqual([]);
  });

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

  it("candidate-backed backfills still match candidate publisher evidence", () => {
    const manifest = loadBackfill();
    const candidates = loadAllCandidates();
    for (const [slug, spec] of Object.entries(manifest.explicit)) {
      if (
        spec.basis !== "candidate-unanimous" &&
        spec.basis !== "candidate-majority"
      ) {
        continue;
      }

      const dataset = loadDataset(spec.datasetFile);
      const series = loadSeries(slug);
      const voters = candidates.filter(
        (c) => c.referencedSeriesId === series.id && c.referencedDatasetId !== undefined
      );
      expect(
        voters.length,
        `${slug} should have at least one voting candidate`
      ).toBeGreaterThan(0);

      const matchingVoters = voters.filter(
        (voter) => voter.referencedDatasetId === spec.datasetId
      );
      if (spec.basis === "candidate-unanimous") {
        expect(
          matchingVoters.length,
          `${slug} unanimous manifest entry must match every voting candidate`
        ).toBe(voters.length);
      }
      if (spec.basis === "candidate-majority") {
        expect(
          matchingVoters.length,
          `${slug} majority manifest entry must be supported by a strict majority of candidate votes`
        ).toBeGreaterThan(voters.length / 2);
      }

      for (const voter of matchingVoters) {
        expect(
          voter.referencedAgentId,
          `${slug} voter ${voter.referencedSeriesId} referencedAgentId should match dataset.publisherAgentId`
        ).toBe(dataset.publisherAgentId);
      }
    }
  });
});
