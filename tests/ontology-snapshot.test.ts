import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import legacyTopics from "../config/ontology/energy-topics.json";
import { buildOntologySnapshot } from "../src/ontology/buildSnapshot";

const here = dirname(fileURLToPath(import.meta.url));
const ontologyRoot = resolve(here, "../../ontology_skill/ontologies/energy-news");

const readSource = (relativePath: string) =>
  readFileSync(resolve(ontologyRoot, relativePath), "utf8");

describe("ontology snapshot builder", () => {
  it("builds a deterministic curated canonical snapshot from the release artifacts", () => {
    const input = {
      ttl: readSource("release/energy-news-reference-individuals.ttl"),
      derivedStoreFilter: readSource("docs/derived-store-filter.md"),
      legacyTopics,
      owlJson: readSource("release/energy-news.json")
    };

    const first = buildOntologySnapshot(input);
    const second = buildOntologySnapshot(input);

    expect(first).toEqual(second);
    expect(first.concepts).toHaveLength(92);
    expect(first.canonicalTopics).toHaveLength(30);
    expect(first.authorTiers.energyFocused).toHaveLength(74);
    expect(first.authorTiers.generalOutlets).toHaveLength(17);
    expect(first.signalCatalog.hashtags).toHaveLength(85);
    expect(first.signalCatalog.domains).toHaveLength(34);
    expect(first.anomalies.some((anomaly) => anomaly.code === "hashtag_heading_count_mismatch")).toBe(true);
  });
});
