import { resolve } from "node:path";
import { buildOntologyArtifacts, encodeOntologySnapshot, encodePublicationsSeed } from "../ontology/buildSnapshot";

type PublicationSeedEntry = {
  readonly hostname: string;
  readonly tier: string;
};

type PublicationSeedManifest = {
  readonly ontologyVersion: string;
  readonly snapshotVersion: string;
  readonly publications: ReadonlyArray<PublicationSeedEntry>;
};

const args = process.argv.slice(2);
const knownFlags = new Set(["--report-only"]);
const flags = args.filter((arg) => arg.startsWith("--"));
const positionalArgs = args.filter((arg) => !arg.startsWith("--"));

for (const flag of flags) {
  if (!knownFlags.has(flag)) {
    throw new Error(`Unknown flag: ${flag}`);
  }
}

const reportOnly = flags.includes("--report-only");

const repoRoot = resolve(import.meta.dir, "../..");
const ontologyRoot = positionalArgs[0] === undefined
  ? resolve(repoRoot, "../ontology_skill/ontologies/energy-news")
  : resolve(repoRoot, positionalArgs[0]);
const snapshotOutputPath = positionalArgs[1] === undefined
  ? resolve(repoRoot, "config/ontology/energy-snapshot.json")
  : resolve(repoRoot, positionalArgs[1]);
const publicationsSeedOutputPath = resolve(
  snapshotOutputPath,
  "../publications-seed.json"
);

const readRequired = async (path: string) => {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`Missing ontology source file: ${path}`);
  }

  return file.text();
};

const readOptional = async (path: string) => {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : undefined;
};

const parsePublicationSeed = (input: string): PublicationSeedManifest =>
  JSON.parse(input) as PublicationSeedManifest;

const summarizePublicationSeedDiff = (
  previous: PublicationSeedManifest | null,
  next: PublicationSeedManifest
) => {
  const previousByHostname = new Map(
    (previous?.publications ?? []).map((entry) => [entry.hostname, entry.tier])
  );
  const nextByHostname = new Map(
    next.publications.map((entry) => [entry.hostname, entry.tier])
  );

  const added = next.publications
    .filter((entry) => !previousByHostname.has(entry.hostname))
    .map((entry) => entry.hostname)
    .sort((left, right) => left.localeCompare(right));

  const removed = (previous?.publications ?? [])
    .filter((entry) => !nextByHostname.has(entry.hostname))
    .map((entry) => entry.hostname)
    .sort((left, right) => left.localeCompare(right));

  const retiered = next.publications
    .flatMap((entry) => {
      const previousTier = previousByHostname.get(entry.hostname);
      return previousTier === undefined || previousTier === entry.tier
        ? []
        : [`${entry.hostname}: ${previousTier} -> ${entry.tier}`];
    })
    .sort((left, right) => left.localeCompare(right));

  return { added, removed, retiered };
};

const printSample = (label: string, values: ReadonlyArray<string>) => {
  if (values.length === 0) {
    console.log(`${label}=0`);
    return;
  }

  console.log(`${label}=${values.length}`);
  console.log(`${label}:sample=${values.slice(0, 12).join(", ")}`);
};

const aboxPath = resolve(ontologyRoot, "data/abox-snapshot.ttl");
const aboxTtl = await readOptional(aboxPath);

if (aboxTtl !== undefined) {
  console.log(`Found ABox snapshot: ${aboxPath}`);
} else {
  console.log(`No ABox snapshot found at ${aboxPath} — skipping ABox enrichment`);
}

const { snapshot, publicationsSeed } = buildOntologyArtifacts({
  ttl: await readRequired(resolve(ontologyRoot, "release/energy-news-reference-individuals.ttl")),
  derivedStoreFilter: await readRequired(resolve(ontologyRoot, "docs/derived-store-filter.md")),
  owlJson: await readRequired(resolve(ontologyRoot, "release/energy-news.json")),
  ...(aboxTtl !== undefined ? { aboxTtl } : {})
});

const currentPublicationsSeedText = await readOptional(publicationsSeedOutputPath);
const currentPublicationsSeed = currentPublicationsSeedText === undefined
  ? null
  : parsePublicationSeed(currentPublicationsSeedText);
const seedDiff = summarizePublicationSeedDiff(currentPublicationsSeed, publicationsSeed);
const unknownPublications = publicationsSeed.publications.filter(
  (entry) => entry.tier === "unknown"
);

console.log(`ontologyVersion=${snapshot.ontologyVersion}`);
console.log(`ontologySnapshotVersion=${snapshot.snapshotVersion}`);
console.log(`publicationsSeedVersion=${publicationsSeed.snapshotVersion}`);
console.log(`canonicalTopics=${snapshot.canonicalTopics.length}`);
console.log(`concepts=${snapshot.concepts.length}`);
console.log(`publications=${publicationsSeed.publications.length}`);
console.log(`publicationsUnknown=${unknownPublications.length}`);
console.log(`anomalies=${snapshot.anomalies.length}`);
printSample("publicationsAdded", seedDiff.added);
printSample("publicationsRemoved", seedDiff.removed);
printSample("publicationsRetiered", seedDiff.retiered);

if (reportOnly) {
  console.log("reportOnly=true");
  console.log("No files written");
} else {
  await Bun.write(snapshotOutputPath, encodeOntologySnapshot(snapshot));
  await Bun.write(publicationsSeedOutputPath, encodePublicationsSeed(publicationsSeed));

  console.log(`Wrote ontology snapshot to ${snapshotOutputPath}`);
  console.log(`Wrote publications seed to ${publicationsSeedOutputPath}`);
}
