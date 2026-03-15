import publicationsSeedJson from "../../config/ontology/publications-seed.json";

/** Seed tiers only — "unknown" is a runtime-discovered tier, not a build-time tier */
type PublicationSeedTier = "energy-focused" | "general-outlet";

type PublicationSeed = {
  readonly hostname: string;
  readonly tier: PublicationSeedTier;
};

type PublicationSeedManifest = {
  readonly ontologyVersion: string;
  readonly snapshotVersion: string;
  readonly publications: ReadonlyArray<PublicationSeed>;
};

const assertValidPublicationSeedManifest = (
  manifest: unknown
): PublicationSeedManifest => {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    !("ontologyVersion" in manifest) ||
    !("snapshotVersion" in manifest) ||
    !("publications" in manifest) ||
    !Array.isArray((manifest as Record<string, unknown>).publications)
  ) {
    throw new Error("invalid publications seed manifest structure");
  }

  const m = manifest as PublicationSeedManifest;

  for (const pub of m.publications) {
    if (typeof pub.hostname !== "string" || pub.hostname.length === 0) {
      throw new Error(`invalid publication hostname: ${JSON.stringify(pub)}`);
    }
    if (pub.tier !== "energy-focused" && pub.tier !== "general-outlet") {
      throw new Error(`invalid publication tier: ${JSON.stringify(pub)}`);
    }
  }

  const hostnames = m.publications.map((p) => p.hostname);
  const uniqueHostnames = new Set(hostnames);
  if (uniqueHostnames.size !== hostnames.length) {
    throw new Error("duplicate hostnames found in publications seed manifest");
  }

  return m;
};

export const publicationsSeedManifest = assertValidPublicationSeedManifest(
  publicationsSeedJson
);
