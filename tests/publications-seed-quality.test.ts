import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";

type PublicationSeedEntry = {
  readonly hostname: string;
  readonly tier: string;
};

type PublicationSeedManifest = {
  readonly publications: ReadonlyArray<PublicationSeedEntry>;
};

const publicationsSeed = JSON.parse(
  readFileSync("config/ontology/publications-seed.json", "utf8")
) as PublicationSeedManifest;

const seededHostnames = new Set(
  publicationsSeed.publications.map((entry) => entry.hostname)
);

describe("checked-in publications seed quality", () => {
  it("keeps known junk, utility, and institutional hosts out of the seed", () => {
    for (const hostname of [
      "amazon.com",
      "apple.news",
      "apply.interfolio.com",
      "app.galabid.com",
      "docs.google.com",
      "news.berkeley.edu",
      "whitehouse.gov",
      "buff.ly",
      "wp.me",
      "bharatcharge.blogspot.com",
      "about.bnef.com",
      "afdc.energy.gov",
      "brookings.edu",
      "doi.org",
      "en.wikipedia.org",
      "open.spotify.com"
    ]) {
      expect(seededHostnames.has(hostname), `${hostname} should not be seeded`).toBe(false);
    }
  });

  it("retains a small allowlist of canonical publication hosts", () => {
    for (const hostname of [
      "reuters.com",
      "financialtimes.com",
      "carbonbrief.org",
      "bbc.co.uk",
      "abc.net.au"
    ]) {
      expect(seededHostnames.has(hostname), `${hostname} should stay seeded`).toBe(true);
    }
  });

  it("retains the curated follow-up publisher additions", () => {
    for (const hostname of [
      "businessinsider.com",
      "dailymail.co.uk",
      "foreignpolicy.com",
      "foxnews.com",
      "nypost.com",
      "telegraph.co.uk",
      "texastribune.org",
      "theintercept.com",
      "thestar.com",
      "time.com"
    ]) {
      expect(seededHostnames.has(hostname), `${hostname} should stay seeded`).toBe(true);
    }
  });
});
