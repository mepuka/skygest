import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOntologyArtifacts,
  buildOntologySnapshot
} from "../src/ontology/buildSnapshot";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "fixtures/ontology");

const readSource = (relativePath: string) =>
  readFileSync(resolve(fixtureRoot, relativePath), "utf8");

describe("ontology snapshot builder", () => {
  it("builds a deterministic curated canonical snapshot from the release artifacts", () => {
    const input = {
      ttl: readSource("energy-news-reference-individuals.ttl"),
      derivedStoreFilter: readSource("derived-store-filter.md"),
      owlJson: readSource("energy-news.json")
    };

    const first = buildOntologySnapshot(input);
    const second = buildOntologySnapshot(input);

    expect(first).toEqual(second);
    expect(first.concepts).toHaveLength(92);
    expect(first.canonicalTopics).toHaveLength(30);
    expect(first.authorTiers.energyFocused).toHaveLength(99);
    expect(first.authorTiers.generalOutlets).toHaveLength(17);
    expect(first.signalCatalog.hashtags).toHaveLength(85);
    expect(first.signalCatalog.domains).toHaveLength(34);
    expect(first.anomalies.some((anomaly) => anomaly.code === "hashtag_heading_count_mismatch")).toBe(true);
  });

  it("merges the checked-in curated publication supplement into the generated seed", () => {
    const { publicationsSeed } = buildOntologyArtifacts({
      ttl: readSource("energy-news-reference-individuals.ttl"),
      derivedStoreFilter: readSource("derived-store-filter.md"),
      owlJson: readSource("energy-news.json")
    });

    const seededHostnames = new Set(publicationsSeed.publications.map((item) => item.hostname));

    for (const hostname of [
      "businessinsider.com",
      "dailymail.co.uk",
      "foxnews.com",
      "telegraph.co.uk",
      "texastribune.org",
      "time.com"
    ]) {
      expect(seededHostnames.has(hostname), `${hostname} should be merged from the curated supplement`).toBe(true);
    }
  });

  it("changes the publication seed version when ABox-only entries change without changing the ontology snapshot version", () => {
    const base = buildOntologyArtifacts({
      ttl: readSource("energy-news-reference-individuals.ttl"),
      derivedStoreFilter: readSource("derived-store-filter.md"),
      owlJson: readSource("energy-news.json")
    });
    const withAbox = buildOntologyArtifacts({
      ttl: readSource("energy-news-reference-individuals.ttl"),
      derivedStoreFilter: readSource("derived-store-filter.md"),
      owlJson: readSource("energy-news.json"),
      aboxTtl: 'enews:one enews:siteDomain "example.com" .'
    });

    expect(withAbox.publicationsSeed.publications).toHaveLength(
      base.publicationsSeed.publications.length + 1
    );
    expect(withAbox.snapshot.snapshotVersion).toBe(base.snapshot.snapshotVersion);
    expect(withAbox.publicationsSeed.snapshotVersion).not.toBe(base.publicationsSeed.snapshotVersion);
  });

  it("keeps targeted junk hosts out of the ABox seed while allowing institutional hosts through", () => {
    const { publicationsSeed } = buildOntologyArtifacts({
      ttl: readSource("energy-news-reference-individuals.ttl"),
      derivedStoreFilter: readSource("derived-store-filter.md"),
      owlJson: readSource("energy-news.json"),
      aboxTtl: [
        'enews:one enews:siteDomain "amazon.com" .',
        'enews:two enews:siteDomain "apply.interfolio.com" .',
        'enews:three enews:siteDomain "app.galabid.com" .',
        'enews:four enews:siteDomain "docs.google.com" .',
        'enews:five enews:siteDomain "news.berkeley.edu" .',
        'enews:six enews:siteDomain "whitehouse.gov" .',
        'enews:seven enews:siteDomain "buff.ly" .',
        'enews:eight enews:siteDomain "wp.me" .',
        'enews:nine enews:siteDomain "blogname.blogspot.com" .',
        'enews:ten enews:siteDomain "about.bnef.com" .',
        'enews:eleven enews:siteDomain "businessinsider.com" .',
        'enews:twelve enews:siteDomain "foxnews.com" .',
        'enews:thirteen enews:siteDomain "bbc.co.uk" .',
        'enews:fourteen enews:siteDomain "texastribune.org" .'
      ].join("\n")
    });

    const seededHostnames = new Set(publicationsSeed.publications.map((item) => item.hostname));

    expect(seededHostnames.has("amazon.com")).toBe(false);
    expect(seededHostnames.has("apply.interfolio.com")).toBe(false);
    expect(seededHostnames.has("app.galabid.com")).toBe(false);
    expect(seededHostnames.has("docs.google.com")).toBe(false);
    expect(seededHostnames.has("buff.ly")).toBe(false);
    expect(seededHostnames.has("wp.me")).toBe(false);
    expect(seededHostnames.has("blogname.blogspot.com")).toBe(false);
    expect(seededHostnames.has("about.bnef.com")).toBe(false);

    expect(seededHostnames.has("news.berkeley.edu")).toBe(true);
    expect(seededHostnames.has("whitehouse.gov")).toBe(true);
    expect(seededHostnames.has("businessinsider.com")).toBe(true);
    expect(seededHostnames.has("foxnews.com")).toBe(true);
    expect(seededHostnames.has("bbc.co.uk")).toBe(true);
    expect(seededHostnames.has("texastribune.org")).toBe(true);
  });
});
