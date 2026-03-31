import { createHash } from "node:crypto";
import { canonicalTopics, conceptToCanonicalTopicSlug, legacyTopicCompatibility, matcherSignalExclusionConceptSlugs, ambiguityTerms, type CanonicalTopicSlug } from "./canonical";
import { compactWhitespace, normalizeWord, normalizeHashtag, normalizeDomain } from "./normalize";
import publicationCuratedSupplementJson from "../../config/ontology/publication-curated-supplement.json";

type ParsedConcept = {
  readonly slug: string;
  readonly iri: string;
  readonly label: string;
  readonly altLabels: ReadonlyArray<string>;
  readonly description: string | null;
  readonly topConcept: boolean;
  readonly broaderSlugs: ReadonlyArray<string>;
  readonly narrowerSlugs: ReadonlyArray<string>;
};

type BuildOntologySnapshotInput = {
  readonly ttl: string;
  readonly derivedStoreFilter: string;
  readonly owlJson?: string;
  readonly aboxTtl?: string;
};

type OntologyAnomaly = {
  readonly code: string;
  readonly message: string;
};

/** Seed tiers — "unknown" covers ABox-derived hostnames not in the curated list */
type PublicationSeedTier = "energy-focused" | "general-outlet" | "unknown";

type PublicationSeed = {
  readonly hostname: string;
  readonly tier: PublicationSeedTier;
};

type PublicationSeedManifest = {
  readonly ontologyVersion: string;
  readonly snapshotVersion: string;
  readonly publications: ReadonlyArray<PublicationSeed>;
};

type OntologyArtifacts = {
  readonly snapshot: OntologySnapshotData;
  readonly publicationsSeed: PublicationSeedManifest;
};

type OntologySnapshotData = {
  readonly ontologyVersion: string;
  readonly snapshotVersion: string;
  readonly generatedAt: string;
  readonly sourceDigest: string;
  readonly canonicalTopics: ReadonlyArray<{
    readonly slug: CanonicalTopicSlug;
    readonly label: string;
    readonly description: string;
    readonly conceptSlugs: ReadonlyArray<string>;
    readonly rootConceptSlugs: ReadonlyArray<string>;
    readonly terms: ReadonlyArray<string>;
    readonly hashtags: ReadonlyArray<string>;
    readonly domains: ReadonlyArray<string>;
  }>;
  readonly concepts: ReadonlyArray<{
    readonly slug: string;
    readonly iri: string;
    readonly label: string;
    readonly altLabels: ReadonlyArray<string>;
    readonly description: string | null;
    readonly topConcept: boolean;
    readonly broaderSlugs: ReadonlyArray<string>;
    readonly narrowerSlugs: ReadonlyArray<string>;
    readonly canonicalTopicSlug: CanonicalTopicSlug | null;
    readonly matcherTerms: ReadonlyArray<string>;
  }>;
  readonly signalCatalog: {
    readonly hashtags: ReadonlyArray<string>;
    readonly domains: ReadonlyArray<string>;
    readonly ambiguityTerms: ReadonlyArray<string>;
  };
  readonly authorTiers: {
    readonly energyFocused: ReadonlyArray<string>;
    readonly generalOutlets: ReadonlyArray<string>;
  };
  readonly anomalies: ReadonlyArray<OntologyAnomaly>;
};

const publicationTierStrength: Record<PublicationSeedTier, number> = {
  unknown: 0,
  "general-outlet": 1,
  "energy-focused": 2
};

const parseCuratedPublicationSupplement = (
  input: unknown
): ReadonlyArray<PublicationSeed> => {
  if (!Array.isArray(input)) {
    throw new Error("config/ontology/publication-curated-supplement.json must be an array");
  }

  const entries = new Map<string, PublicationSeed>();

  for (const rawEntry of input) {
    if (typeof rawEntry !== "object" || rawEntry === null) {
      throw new Error("Curated publication supplement entries must be objects");
    }

    const hostname = normalizeDomain(String((rawEntry as { hostname?: unknown }).hostname ?? ""));
    const tier = (rawEntry as { tier?: unknown }).tier;

    if (hostname.length === 0) {
      throw new Error("Curated publication supplement entries must include a hostname");
    }

    if (tier !== "energy-focused" && tier !== "general-outlet" && tier !== "unknown") {
      throw new Error(`Invalid publication tier for curated supplement hostname: ${hostname}`);
    }

    entries.set(hostname, { hostname, tier });
  }

  return Array.from(entries.values()).sort((left, right) =>
    left.hostname.localeCompare(right.hostname)
  );
};

const curatedPublicationSupplement = parseCuratedPublicationSupplement(
  publicationCuratedSupplementJson
);

const parseQuotedValues = (input: string) =>
  Array.from(input.matchAll(/"([^"]+)"/g), (match) => compactWhitespace(match[1] ?? ""));

const sortStrings = (values: Iterable<string>) =>
  Array.from(new Set(Array.from(values).filter((value) => value.length > 0))).sort((a, b) =>
    a.localeCompare(b)
  );

const parseConceptBlocks = (ttl: string): ReadonlyArray<ParsedConcept> => {
  const rawBlocks = ttl.split(/\n(?=enews:[A-Za-z0-9_]+\s+a\s+)/u);

  return rawBlocks.flatMap((block) => {
    if (!/\ba\s+enews:EnergyTopic\b/u.test(block) || !/\bskos:Concept\b/u.test(block)) {
      return [];
    }

    const subject = block.match(/^enews:([A-Za-z0-9_]+)\s+a\s+/mu)?.[1];
    const label = block.match(/rdfs:label\s+"([^"]+)"@en/u)?.[1];

    if (subject === undefined || label === undefined) {
      throw new Error(`Unable to parse concept block subject or label: ${block.slice(0, 120)}`);
    }

    const broaderSlugs = sortStrings(
      Array.from(block.matchAll(/skos:broader\s+enews:([A-Za-z0-9_]+)/g), (match) => match[1] ?? "")
    );
    const narrowerSlugs = sortStrings(
      Array.from(block.matchAll(/skos:narrower\s+enews:([A-Za-z0-9_]+)/g), (match) => match[1] ?? "")
    );
    const altLabels = sortStrings(
      Array.from(block.matchAll(/skos:altLabel\s+((?:"[^"]+"@en(?:,\s*)?)+)/g), (match) =>
        parseQuotedValues(match[1] ?? "")
      ).flat()
    );
    const description = block.match(/skos:definition\s+"([^"]+)"@en/u)?.[1] ?? null;

    return [{
      slug: subject,
      iri: `http://example.org/ontology/energy-news#${subject}`,
      label: compactWhitespace(label),
      altLabels,
      description: description === null ? null : compactWhitespace(description),
      topConcept: block.includes("skos:topConceptOf"),
      broaderSlugs,
      narrowerSlugs
    }];
  });
};

const backfillNarrowerRelations = (concepts: ReadonlyArray<ParsedConcept>) => {
  const children = new Map<string, Set<string>>();

  for (const concept of concepts) {
    for (const broader of concept.broaderSlugs) {
      const next = children.get(broader) ?? new Set<string>();
      next.add(concept.slug);
      children.set(broader, next);
    }
  }

  return concepts.map((concept) => ({
    ...concept,
    narrowerSlugs: sortStrings([
      ...concept.narrowerSlugs,
      ...(children.get(concept.slug) ?? [])
    ])
  }));
};

const extractFencedBlock = (input: string, heading: string) => {
  const match = input.match(new RegExp(`${heading}[\\s\\S]*?\`\`\`([\\s\\S]*?)\`\`\``, "u"));

  if (match?.[1] === undefined) {
    throw new Error(`Unable to find fenced block for section: ${heading}`);
  }

  return match[1];
};

const parseEnergyFocusedAuthors = (input: string) =>
  sortStrings(
    extractFencedBlock(input, "## Energy-Focused Author Handles")
      .split(",")
      .map((value) => compactWhitespace(value))
  );

const parseGeneralOutletAuthors = (input: string) => {
  const section = input.match(/### General Outlet Breakdown\s+([\s\S]*?)## Energy-Focused Author Handles/u)?.[1];

  if (section === undefined) {
    throw new Error("Unable to find General Outlet Breakdown section");
  }

  return sortStrings(
    section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\|/.test(line) && !line.includes("Author") && !line.includes("---"))
      .map((line) => compactWhitespace(line.split("|")[1] ?? ""))
  );
};

const parseHashtags = (input: string) =>
  sortStrings(
    extractFencedBlock(input, "### Hashtags")
      .split(",")
      .map((value) => normalizeHashtag(value))
  );

const parseDomains = (input: string) =>
  sortStrings(
    extractFencedBlock(input, "### Link Domains")
      .split(",")
      .map((value) => normalizeDomain(value))
  );

const extractHeadingCount = (input: string, heading: string) => {
  const count = input.match(new RegExp(`${heading}\\s*\\((\\d+)\\)`, "u"))?.[1];
  return count === undefined ? null : Number(count);
};

const extractOntologyVersion = (ttl: string) =>
  ttl.match(/owl:versionInfo\s+"([^"]+)"/u)?.[1] ?? "unknown";

const extractOntologyModifiedDate = (ttl: string) =>
  ttl.match(/dcterms:modified\s+"([^"]+)"/u)?.[1] ?? "1970-01-01";

const makeSourceDigest = (input: BuildOntologySnapshotInput) =>
  createHash("sha256")
    .update(input.ttl)
    .update(input.derivedStoreFilter)
    .update(input.owlJson ?? "")
    .digest("hex");

const makePublicationSeedVersion = (
  ontologyVersion: string,
  publications: ReadonlyArray<PublicationSeed>
) => {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      ontologyVersion,
      publications
    }))
    .digest("hex");

  return `${ontologyVersion}-${digest.slice(0, 12)}`;
};

const validateMappingCoverage = (concepts: ReadonlyArray<ParsedConcept>) => {
  const parsedSlugs = new Set(concepts.map((concept) => concept.slug));
  const mappingSlugs = new Set(Object.keys(conceptToCanonicalTopicSlug));

  const missing = sortStrings(
    concepts
      .map((concept) => concept.slug)
      .filter((slug) => !mappingSlugs.has(slug))
  );
  const extra = sortStrings(
    Array.from(mappingSlugs).filter((slug) => !parsedSlugs.has(slug))
  );

  if (missing.length > 0) {
    throw new Error(`Canonical concept mapping is missing ${missing.length} concepts: ${missing.join(", ")}`);
  }

  if (extra.length > 0) {
    throw new Error(`Canonical concept mapping includes unknown concepts: ${extra.join(", ")}`);
  }
};

const buildMatcherTermsForConcept = (
  concept: ParsedConcept,
  useMatcherSignals: boolean
) =>
  useMatcherSignals
    ? sortStrings([concept.label, ...concept.altLabels])
    : [];

/**
 * Parse general outlet domains from the General Outlet Breakdown table.
 * The Author column contains domain-style identifiers (e.g. "bloomberg.com").
 * Reuses the same table-parsing logic as parseGeneralOutletAuthors.
 */
const parseGeneralOutletDomains = (input: string) => {
  const section = input.match(/### General Outlet Breakdown\s+([\s\S]*?)## Energy-Focused Author Handles/u)?.[1];

  if (section === undefined) {
    throw new Error("Unable to find General Outlet Breakdown section");
  }

  return sortStrings(
    section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\|/.test(line) && !line.includes("Author") && !line.includes("---"))
      .map((line) => normalizeDomain(line.split("|")[1] ?? ""))
  );
};

const parseAboxPublicationDomains = (aboxTtl: string): ReadonlyArray<string> =>
  sortStrings(
    Array.from(
      aboxTtl.matchAll(/enews:siteDomain\s+"([^"]+)"/g),
      (match) => normalizeDomain(match[1] ?? "")
    ).filter((hostname) => hostname.length > 0)
  );

/** Exact hostnames that are clearly not publications */
const HOSTNAME_DENYLIST = new Set([
  "archive.is",
  "amazon.com",
  "apple.com",
  "apple.news",
  "google.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "linkedin.com",
  "instagram.com",
  "reddit.com",
  "tiktok.com",
  "github.com",
  "medium.com",
  "substack.com",
  "wordpress.com",
  "docs.google.com",
  "drive.google.com",
  "scholar.google.com",
  "blog.google",
  "share.google",
  "dropbox.com",
  "eventbrite.com",
  "bsky.app",
  "go.bsky.app",
  "podcasts.apple.com",
  "bit.ly",
  "buff.ly",
  "documentcloud.org",
  "doi.org",
  "en.wikipedia.org",
  "goo.gl",
  "lnkd.in",
  "open.spotify.com",
  "ow.ly",
  "t.me",
  "tinyurl.com",
  "web.archive.org",
  "wp.me"
]);

/** Suffixes for infrastructure, CDN, and hosting platforms */
const INFRASTRUCTURE_SUFFIX_DENYLIST = [
  "hubspotusercontent-na1.net",
  "hubspotusercontent-eu1.net",
  "cloudfront.net",
  "amazonaws.com",
  "s3.amazonaws.com",
  "azureedge.net",
  "googleapis.com",
  "googleusercontent.com",
  "gstatic.com",
  "firebaseapp.com",
  "herokuapp.com",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "workers.dev",
  "r2.dev",
  "github.io",
  "itch.io",
  "list-manage.com",
  "podigee.io",
  "greenhouse.io",
  "subscribepage.io",
  "avature.net"
] as const;

/** Platform-hosting suffixes — subdomains of these are user content, not publications */
const PLATFORM_HOSTING_SUFFIXES = [
  "substack.com",
  "wordpress.com",
  "blogspot.com",
  "medium.com",
  "eventbrite.com",
  "galabid.com",
  "interfolio.com",
  "google.com",
  "apple.com",
  "youtube.com"
] as const;

/** Suspicious subdomain prefixes that indicate app/service portals, not publications */
const SUSPICIOUS_SUBDOMAIN_PREFIXES = [
  "about.",
  "amp.",
  "app.",
  "apply.",
  "calendar.",
  "conference.",
  "forms.",
  "docs.",
  "event.",
  "events.",
  "share.",
  "m.",
  "api.",
  "cdn.",
  "mail.",
  "job-boards."
] as const;

type PublicationHostnameRejectionReason =
  | "exact-denylist"
  | "infrastructure-suffix"
  | "platform-hosting"
  | "suspicious-prefix";

const publicationHostnameRejectionReason = (
  hostname: string
): PublicationHostnameRejectionReason | null => {
  if (HOSTNAME_DENYLIST.has(hostname)) return "exact-denylist";

  if (INFRASTRUCTURE_SUFFIX_DENYLIST.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  )) return "infrastructure-suffix";

  if (PLATFORM_HOSTING_SUFFIXES.some(
    (suffix) => hostname.endsWith(`.${suffix}`) && hostname !== suffix
  )) return "platform-hosting";

  if (SUSPICIOUS_SUBDOMAIN_PREFIXES.some(
    (prefix) => hostname.startsWith(prefix)
  )) return "suspicious-prefix";

  return null;
};

const buildPublicationSeed = (
  derivedStoreFilter: string,
  ontologyVersion: string,
  aboxTtl?: string
): PublicationSeedManifest => {
  const energyFocusedDomains = parseDomains(derivedStoreFilter);
  const generalOutletDomains = parseGeneralOutletDomains(derivedStoreFilter);
  const energyFocusedDomainSet = new Set(energyFocusedDomains);
  const generalOutletDomainSet = new Set(generalOutletDomains);
  const tierByHostname = new Map<string, PublicationSeedTier>();

  for (const hostname of energyFocusedDomains) {
    tierByHostname.set(hostname, "energy-focused");
  }

  for (const hostname of generalOutletDomains) {
    if (!tierByHostname.has(hostname)) {
      tierByHostname.set(hostname, "general-outlet");
    }
  }

  // Keep one generated seed, but allow a small checked-in supplement for
  // high-confidence mainstream publishers that are not yet curated upstream.
  for (const entry of curatedPublicationSupplement) {
    const existingTier = tierByHostname.get(entry.hostname);
    if (
      existingTier === undefined ||
      publicationTierStrength[entry.tier] > publicationTierStrength[existingTier]
    ) {
      tierByHostname.set(entry.hostname, entry.tier);
    }
  }

  const curatedFromOntologyTotal = new Set([
    ...energyFocusedDomainSet,
    ...generalOutletDomainSet
  ]).size;
  const curatedSupplementTotal = curatedPublicationSupplement.filter(
    (entry) =>
      !energyFocusedDomainSet.has(entry.hostname) &&
      !generalOutletDomainSet.has(entry.hostname)
  ).length;
  const curatedTotal = tierByHostname.size;

  const aboxDomains = aboxTtl === undefined
    ? []
    : parseAboxPublicationDomains(aboxTtl);

  let acceptedAbox = 0;
  let rejectedAbox = 0;
  const rejectedAboxByReason = new Map<PublicationHostnameRejectionReason, number>();

  for (const hostname of aboxDomains) {
    if (tierByHostname.has(hostname)) {
      continue;
    }

    const rejectionReason = publicationHostnameRejectionReason(hostname);

    if (rejectionReason === null) {
      tierByHostname.set(hostname, "unknown");
      acceptedAbox++;
    } else {
      rejectedAbox++;
      rejectedAboxByReason.set(
        rejectionReason,
        (rejectedAboxByReason.get(rejectionReason) ?? 0) + 1
      );
    }
  }

  const publications = Array.from(tierByHostname.entries(), ([hostname, tier]) => ({
    hostname,
    tier
  })).sort((a, b) => a.hostname.localeCompare(b.hostname));
  const snapshotVersion = makePublicationSeedVersion(
    ontologyVersion,
    publications
  );

  console.log(`[publications-seed] curated total: ${curatedTotal}`);
  console.log(`[publications-seed] curated ontology total: ${curatedFromOntologyTotal}`);
  console.log(`[publications-seed] curated supplement total: ${curatedSupplementTotal}`);
  console.log(`[publications-seed] raw ABox total: ${aboxDomains.length}`);
  console.log(`[publications-seed] accepted ABox additions: ${acceptedAbox}`);
  console.log(`[publications-seed] rejected ABox additions: ${rejectedAbox}`);
  for (const [reason, count] of Array.from(rejectedAboxByReason.entries()).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    console.log(`[publications-seed] rejected ABox ${reason}: ${count}`);
  }
  console.log(`[publications-seed] final seed total: ${publications.length}`);

  return {
    ontologyVersion,
    snapshotVersion,
    publications
  };
};

export const buildOntologyArtifacts = (
  input: BuildOntologySnapshotInput
): OntologyArtifacts => {
  const snapshot = buildOntologySnapshot(input);
  const publicationsSeed = buildPublicationSeed(
    input.derivedStoreFilter,
    snapshot.ontologyVersion,
    input.aboxTtl
  );

  return { snapshot, publicationsSeed };
};

export const buildOntologySnapshot = (
  input: BuildOntologySnapshotInput
): OntologySnapshotData => {
  const ontologyVersion = extractOntologyVersion(input.ttl);
  const generatedAt = `${extractOntologyModifiedDate(input.ttl)}T00:00:00.000Z`;
  const sourceDigest = makeSourceDigest(input);
  const snapshotVersion = `${ontologyVersion}-${sourceDigest.slice(0, 12)}`;
  const anomalies: Array<OntologyAnomaly> = [];

  let concepts = backfillNarrowerRelations(parseConceptBlocks(input.ttl));
  validateMappingCoverage(concepts);

  const duplicateMatcherTerms = new Map<string, Set<string>>();
  const energyFocused = parseEnergyFocusedAuthors(input.derivedStoreFilter);
  const generalOutlets = parseGeneralOutletAuthors(input.derivedStoreFilter);
  const globalHashtags = parseHashtags(input.derivedStoreFilter);
  const globalDomains = parseDomains(input.derivedStoreFilter);
  const headingHashtagCount = extractHeadingCount(input.derivedStoreFilter, "### Hashtags");

  if (headingHashtagCount !== null && headingHashtagCount !== globalHashtags.length) {
    anomalies.push({
      code: "hashtag_heading_count_mismatch",
      message: `Heading says ${headingHashtagCount} hashtags but parsed ${globalHashtags.length}.`
    });
  }

  const conceptMap = new Map(concepts.map((concept) => [concept.slug, concept] as const));
  const globalHashtagSet = new Set(globalHashtags);
  const globalDomainSet = new Set(globalDomains);

  const conceptsWithMappings = concepts.map((concept) => {
    const canonicalTopicSlug = conceptToCanonicalTopicSlug[concept.slug as keyof typeof conceptToCanonicalTopicSlug];
    const useMatcherSignals = !matcherSignalExclusionConceptSlugs.has(concept.slug);
    const matcherTerms = buildMatcherTermsForConcept(concept, useMatcherSignals);

    const normalizedLabel = normalizeWord(concept.label);
    for (const altLabel of concept.altLabels) {
      if (normalizeWord(altLabel) === normalizedLabel) {
        anomalies.push({
          code: "duplicate_alt_label",
          message: `${concept.slug} repeats its preferred label as an altLabel: "${altLabel}".`
        });
      }
    }

    for (const term of matcherTerms) {
      const owners = duplicateMatcherTerms.get(normalizeWord(term)) ?? new Set<string>();
      owners.add(concept.slug);
      duplicateMatcherTerms.set(normalizeWord(term), owners);
    }

    return {
      ...concept,
      canonicalTopicSlug,
      matcherTerms
    };
  });

  for (const [term, owners] of duplicateMatcherTerms.entries()) {
    if (owners.size > 1 && term.length > 0) {
      anomalies.push({
        code: "term_collision",
        message: `Matcher term "${term}" appears in multiple concepts: ${sortStrings(owners).join(", ")}.`
      });
    }
  }

  const canonicalTopicRows = canonicalTopics.map((definition) => {
    const termOverrides = "termOverrides" in definition ? definition.termOverrides ?? [] : [];
    const hashtags = "hashtags" in definition ? definition.hashtags ?? [] : [];
    const domains = "domains" in definition ? definition.domains ?? [] : [];
    const conceptSlugs = sortStrings(
      conceptsWithMappings
        .filter((concept) => concept.canonicalTopicSlug === definition.slug)
        .map((concept) => concept.slug)
    );
    const conceptTerms = sortStrings(
      conceptSlugs.flatMap((slug) => conceptMap.get(slug)?.altLabels === undefined
        ? []
        : [
            conceptMap.get(slug)?.label ?? "",
            ...(conceptMap.get(slug)?.altLabels ?? [])
          ])
    );
    const mergedTerms = sortStrings([
      ...conceptTerms,
      ...termOverrides,
      ...((legacyTopicCompatibility as Record<string, ReadonlyArray<string> | undefined>)[definition.slug] ?? [])
    ]);

    const resolvedHashtags = sortStrings(
      hashtags
        .map(normalizeHashtag)
        .filter((value) => {
          const present = globalHashtagSet.has(value);
          if (!present) {
            anomalies.push({
              code: "topic_hashtag_not_in_overlay",
              message: `${definition.slug} references hashtag "${value}" that is not in derived-store-filter.md.`
            });
          }
          return present;
        })
    );
    const resolvedDomains = sortStrings(
      domains
        .map(normalizeDomain)
        .filter((value) => {
          const present = globalDomainSet.has(value);
          if (!present) {
            anomalies.push({
              code: "topic_domain_not_in_overlay",
              message: `${definition.slug} references domain "${value}" that is not in derived-store-filter.md.`
            });
          }
          return present;
        })
    );

    if (conceptSlugs.length === 0) {
      throw new Error(`Canonical topic ${definition.slug} has no mapped concepts.`);
    }

    return {
      slug: definition.slug,
      label: definition.label,
      description: definition.description,
      conceptSlugs,
      rootConceptSlugs: sortStrings(definition.rootConceptSlugs),
      terms: mergedTerms,
      hashtags: resolvedHashtags,
      domains: resolvedDomains
    };
  });

  const finalConcepts = conceptsWithMappings.map((concept) => {
    const matcherTerms = canonicalTopicRows
      .filter((topic) => topic.conceptSlugs.includes(concept.slug) && !matcherSignalExclusionConceptSlugs.has(concept.slug))
      .flatMap((topic) => topic.terms)
      .filter((term) =>
        normalizeWord(term) === normalizeWord(concept.label) ||
        concept.altLabels.some((altLabel) => normalizeWord(term) === normalizeWord(altLabel))
      );

    return {
      ...concept,
      matcherTerms: sortStrings(matcherTerms),
      canonicalTopicSlug: conceptToCanonicalTopicSlug[concept.slug as keyof typeof conceptToCanonicalTopicSlug]
    };
  });

  if (finalConcepts.length !== 92) {
    throw new Error(`Expected 92 SKOS concepts, found ${finalConcepts.length}.`);
  }

  const topConceptCount = finalConcepts.filter((concept) => concept.topConcept).length;
  if (topConceptCount !== 23) {
    throw new Error(`Expected 23 top concepts, found ${topConceptCount}.`);
  }

  if (input.owlJson !== undefined) {
    const jsonText = input.owlJson.trim();
    if (!jsonText.includes("energy-news")) {
      anomalies.push({
        code: "owl_json_validation_weak",
        message: "release/energy-news.json did not include the expected ontology identifier."
      });
    }
  }

  return {
    ontologyVersion,
    snapshotVersion,
    generatedAt,
    sourceDigest,
    canonicalTopics: canonicalTopicRows,
    concepts: finalConcepts.map((concept) => ({
      slug: concept.slug,
      iri: concept.iri,
      label: concept.label,
      altLabels: concept.altLabels,
      description: concept.description,
      topConcept: concept.topConcept,
      broaderSlugs: concept.broaderSlugs,
      narrowerSlugs: concept.narrowerSlugs,
      canonicalTopicSlug: concept.canonicalTopicSlug,
      matcherTerms: concept.matcherTerms
    })),
    signalCatalog: {
      hashtags: globalHashtags,
      domains: globalDomains,
      ambiguityTerms: Array.from(ambiguityTerms)
    },
    authorTiers: {
      energyFocused,
      generalOutlets
    },
    anomalies: sortStrings(
      anomalies.map((anomaly) => `${anomaly.code}:${anomaly.message}`)
    ).map((serialized) => {
      const [code, ...messageParts] = serialized.split(":");
      return {
        code: code ?? "unknown",
        message: messageParts.join(":")
      };
    })
  };
};

export const encodeOntologySnapshot = (snapshot: OntologySnapshotData) =>
  `${JSON.stringify(snapshot, null, 2)}\n`;

export const encodePublicationsSeed = (manifest: PublicationSeedManifest) =>
  `${JSON.stringify(manifest, null, 2)}\n`;
