import { Option } from "effect";
import type {
  AgentSignal,
  DataReferenceResolution,
  DatasetSignal,
  EnrichedBundle,
  ResolvedAgent,
  ResolvedDataset,
  TrailEntry
} from "../../domain/enrichedBundle";
import type { AgentId, DatasetId } from "../../domain/data-layer/ids";
import type { DataLayerRegistryLookup } from "../dataLayerRegistry";
import { findDatasetMatchesForName } from "../datasetNameMatch";
import { normalizeDistributionHostname } from "../normalize";

// SUPERSEDED-BY: SKY-343 / src/resolution/bundle/resolveBundle.ts
// Keep this exact-match kernel in tree as a reference during the cutover.
// New bundle-resolution wiring should use resolveBundle instead.

// ---------------------------------------------------------------------------
// resolveDataReference — pure, total retrieval + scope-narrowing kernel.
//
// Takes one EnrichedBundle (a single chart asset and its upstream enrichment
// context) plus a prebuilt DataLayerRegistryLookup, and returns a trail of
// every probe it tried. Rung 1 (Agent) scans every candidate text/URL field
// without scope. Rung 2 (Dataset) probes URL and name fields scoped by the
// rung-1 agents via preferredAgentIds. Rungs 3/4 are stubbed.
//
// The function is total and side-effect-free. No Effect wrapper, no errors.
// Every input produces a DataReferenceResolution (possibly empty).
// ---------------------------------------------------------------------------

const toNonEmpty = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const safeDomain = (value: string): string | null =>
  normalizeDistributionHostname(value);

// Helper for pushing an agent hit if the lookup returns Some.
type AgentProbeContext = {
  readonly agents: Array<ResolvedAgent>;
  readonly trail: Array<TrailEntry>;
  readonly seen: Set<string>;
};

const recordAgentHit = (
  ctx: AgentProbeContext,
  signalName: string,
  query: string,
  agentIdOpt: Option.Option<{ readonly id: AgentId }>,
  via: AgentSignal
) => {
  if (Option.isNone(agentIdOpt)) {
    ctx.trail.push({
      rung: "Agent",
      signal: signalName,
      query,
      status: "miss",
      hits: 0,
      note: null
    });
    return;
  }

  const agentId = agentIdOpt.value.id;
  const dedupeKey = `${signalName}\u0000${agentId}`;
  if (ctx.seen.has(dedupeKey)) {
    ctx.trail.push({
      rung: "Agent",
      signal: signalName,
      query,
      status: "hit",
      hits: 0,
      note: "duplicate — agent already recorded for this signal"
    });
    return;
  }
  ctx.seen.add(dedupeKey);
  ctx.agents.push({ agentId, via });
  ctx.trail.push({
    rung: "Agent",
    signal: signalName,
    query,
    status: "hit",
    hits: 1,
    note: null
  });
};

const probeAgentByLabel = (
  ctx: AgentProbeContext,
  lookup: DataLayerRegistryLookup,
  signalName: string,
  value: string | null,
  makeVia: (query: string) => AgentSignal
) => {
  if (value === null) {
    ctx.trail.push({
      rung: "Agent",
      signal: signalName,
      query: null,
      status: "skipped-empty",
      hits: 0,
      note: null
    });
    return;
  }
  recordAgentHit(
    ctx,
    signalName,
    value,
    lookup.findAgentByLabel(value),
    makeVia(value)
  );
};

const probeAgentByDomain = (
  ctx: AgentProbeContext,
  lookup: DataLayerRegistryLookup,
  signalName: string,
  rawValue: string | null,
  makeVia: (rawValue: string, domain: string) => AgentSignal
) => {
  if (rawValue === null) {
    ctx.trail.push({
      rung: "Agent",
      signal: signalName,
      query: null,
      status: "skipped-empty",
      hits: 0,
      note: null
    });
    return;
  }
  const domain = safeDomain(rawValue);
  if (domain === null) {
    ctx.trail.push({
      rung: "Agent",
      signal: signalName,
      query: rawValue,
      status: "miss",
      hits: 0,
      note: "could not extract domain"
    });
    return;
  }
  recordAgentHit(
    ctx,
    signalName,
    domain,
    lookup.findAgentByHomepageDomain(domain),
    makeVia(rawValue, domain)
  );
};

const resolveAgents = (
  bundle: EnrichedBundle,
  lookup: DataLayerRegistryLookup
): { agents: ReadonlyArray<ResolvedAgent>; trail: ReadonlyArray<TrailEntry> } => {
  const ctx: AgentProbeContext = {
    agents: [],
    trail: [],
    seen: new Set()
  };

  const sa = bundle.sourceAttribution;
  const analysis = bundle.asset.analysis;

  // 1. sourceAttribution.provider.providerLabel
  probeAgentByLabel(
    ctx,
    lookup,
    "sourceAttribution.provider.providerLabel",
    toNonEmpty(sa?.provider?.providerLabel),
    (providerLabel) => ({
      _tag: "SourceAttributionProvider",
      providerLabel
    })
  );

  // 2. sourceAttribution.contentSource.domain
  probeAgentByDomain(
    ctx,
    lookup,
    "sourceAttribution.contentSource.domain",
    toNonEmpty(sa?.contentSource?.domain),
    (_raw, domain) => ({ _tag: "SourceAttributionContentDomain", domain })
  );

  // 3. asset.analysis.visibleUrls[] → domain
  for (const rawUrl of analysis.visibleUrls) {
    const url = toNonEmpty(rawUrl);
    probeAgentByDomain(
      ctx,
      lookup,
      "asset.analysis.visibleUrls[].domain",
      url,
      (raw, domain) => ({ _tag: "VisibleUrlDomain", url: raw, domain })
    );
  }

  // 4. asset.analysis.logoText[] → label
  for (const logo of analysis.logoText) {
    probeAgentByLabel(
      ctx,
      lookup,
      "asset.analysis.logoText[]",
      toNonEmpty(logo),
      (logoText) => ({ _tag: "LogoText", logoText })
    );
  }

  // 5. asset.analysis.organizationMentions[].name → label
  for (const mention of analysis.organizationMentions) {
    probeAgentByLabel(
      ctx,
      lookup,
      "asset.analysis.organizationMentions[].name",
      toNonEmpty(mention.name),
      (name) => ({ _tag: "OrganizationMention", name })
    );
  }

  // 6. asset.analysis.sourceLines[].sourceText → label
  for (const sourceLine of analysis.sourceLines) {
    probeAgentByLabel(
      ctx,
      lookup,
      "asset.analysis.sourceLines[].sourceText",
      toNonEmpty(sourceLine.sourceText),
      (sourceText) => ({ _tag: "SourceLineText", sourceText })
    );
  }

  // 7. postContext.linkCards[].uri → domain
  for (const card of bundle.postContext.linkCards) {
    const uri = toNonEmpty(card.uri);
    probeAgentByDomain(
      ctx,
      lookup,
      "postContext.linkCards[].uri",
      uri,
      (raw, domain) => ({ _tag: "LinkCardDomain", uri: raw, domain })
    );
  }

  // 8. postContext.links[].domain → domain
  for (const link of bundle.postContext.links) {
    const linkDomain = toNonEmpty(link.domain);
    // The link record already has the extracted domain; prefer it over
    // re-extracting from link.url so we honor whatever normalization the
    // upstream pipeline used.
    if (linkDomain === null) {
      probeAgentByDomain(
        ctx,
        lookup,
        "postContext.links[].domain",
        toNonEmpty(link.url),
        (raw, domain) => ({ _tag: "PostLinkDomain", url: raw, domain })
      );
      continue;
    }
    recordAgentHit(
      ctx,
      "postContext.links[].domain",
      linkDomain,
      lookup.findAgentByHomepageDomain(linkDomain),
      { _tag: "PostLinkDomain", url: link.url, domain: linkDomain }
    );
  }

  return { agents: ctx.agents, trail: ctx.trail };
};

// ---------------------------------------------------------------------------
// Rung 2 — Dataset
// ---------------------------------------------------------------------------

type DatasetProbeContext = {
  readonly datasets: Array<ResolvedDataset>;
  readonly trail: Array<TrailEntry>;
  readonly seen: Set<DatasetId>;
  readonly preferredAgentIds: ReadonlyArray<AgentId>;
};

const recordDatasetHit = (
  ctx: DatasetProbeContext,
  signalName: string,
  query: string,
  datasetId: DatasetId,
  via: DatasetSignal
) => {
  if (ctx.seen.has(datasetId)) {
    ctx.trail.push({
      rung: "Dataset",
      signal: signalName,
      query,
      status: "hit",
      hits: 0,
      note: "duplicate — dataset already recorded via earlier signal"
    });
    return;
  }
  ctx.seen.add(datasetId);
  ctx.datasets.push({
    datasetId,
    via,
    agentScoped: ctx.preferredAgentIds.length > 0
  });
  ctx.trail.push({
    rung: "Dataset",
    signal: signalName,
    query,
    status: "hit",
    hits: 1,
    note: null
  });
};

const probeDatasetByUrl = (
  ctx: DatasetProbeContext,
  lookup: DataLayerRegistryLookup,
  signalName: string,
  rawUrl: string | null,
  makeVia: (url: string) => DatasetSignal
) => {
  if (rawUrl === null) {
    ctx.trail.push({
      rung: "Dataset",
      signal: signalName,
      query: null,
      status: "skipped-empty",
      hits: 0,
      note: null
    });
    return;
  }
  const distributionOpt = lookup.findDistributionByUrl(rawUrl);
  if (Option.isNone(distributionOpt)) {
    ctx.trail.push({
      rung: "Dataset",
      signal: signalName,
      query: rawUrl,
      status: "miss",
      hits: 0,
      note: null
    });
    return;
  }
  recordDatasetHit(
    ctx,
    signalName,
    rawUrl,
    distributionOpt.value.datasetId,
    makeVia(rawUrl)
  );
};

const probeDatasetByLandingPage = (
  ctx: DatasetProbeContext,
  lookup: DataLayerRegistryLookup,
  signalName: string,
  rawUrl: string | null,
  makeVia: (url: string) => DatasetSignal
) => {
  if (rawUrl === null) {
    ctx.trail.push({
      rung: "Dataset",
      signal: signalName,
      query: null,
      status: "skipped-empty",
      hits: 0,
      note: null
    });
    return;
  }
  const datasetOpt = lookup.findDatasetByLandingPage(rawUrl);
  if (Option.isNone(datasetOpt)) {
    ctx.trail.push({
      rung: "Dataset",
      signal: signalName,
      query: rawUrl,
      status: "miss",
      hits: 0,
      note: null
    });
    return;
  }
  recordDatasetHit(
    ctx,
    signalName,
    rawUrl,
    datasetOpt.value.id,
    makeVia(rawUrl)
  );
};

const probeDatasetByName = (
  ctx: DatasetProbeContext,
  lookup: DataLayerRegistryLookup,
  signalName: string,
  rawName: string | null,
  makeVia: (name: string) => DatasetSignal
) => {
  if (rawName === null) {
    ctx.trail.push({
      rung: "Dataset",
      signal: signalName,
      query: null,
      status: "skipped-empty",
      hits: 0,
      note: null
    });
    return;
  }
  const matches = findDatasetMatchesForName(rawName, lookup, {
    preferredAgentIds: ctx.preferredAgentIds
  });
  if (matches.length === 0) {
    ctx.trail.push({
      rung: "Dataset",
      signal: signalName,
      query: rawName,
      status: "miss",
      hits: 0,
      note: null
    });
    return;
  }
  let appended = 0;
  for (const match of matches) {
    const datasetId = match.dataset.id;
    if (ctx.seen.has(datasetId)) {
      continue;
    }
    ctx.seen.add(datasetId);
    ctx.datasets.push({
      datasetId,
      via: makeVia(rawName),
      agentScoped: ctx.preferredAgentIds.length > 0
    });
    appended += 1;
  }
  ctx.trail.push({
    rung: "Dataset",
    signal: signalName,
    query: rawName,
    status: "hit",
    hits: appended,
    note:
      matches.length === appended
        ? `matcher tag=${matches[0]?._tag ?? "unknown"}`
        : `matcher returned ${matches.length}, ${appended} new after dedupe`
  });
};

const resolveDatasets = (
  bundle: EnrichedBundle,
  lookup: DataLayerRegistryLookup,
  preferredAgentIds: ReadonlyArray<AgentId>
): {
  datasets: ReadonlyArray<ResolvedDataset>;
  trail: ReadonlyArray<TrailEntry>;
} => {
  const ctx: DatasetProbeContext = {
    datasets: [],
    trail: [],
    seen: new Set(),
    preferredAgentIds
  };

  const analysis = bundle.asset.analysis;

  // 1. visibleUrls[] → distribution URL short-circuit, then dataset.landingPage fallback
  for (const rawUrl of analysis.visibleUrls) {
    const url = toNonEmpty(rawUrl);
    probeDatasetByUrl(
      ctx,
      lookup,
      "asset.analysis.visibleUrls[]",
      url,
      (u) => ({ _tag: "VisibleUrlDistribution", url: u })
    );
    probeDatasetByLandingPage(
      ctx,
      lookup,
      "asset.analysis.visibleUrls[].landingPage",
      url,
      (u) => ({ _tag: "VisibleUrlDatasetLandingPage", url: u })
    );
  }

  // 2. linkCards[].uri → distribution URL short-circuit, then dataset.landingPage fallback
  for (const card of bundle.postContext.linkCards) {
    const uri = toNonEmpty(card.uri);
    probeDatasetByUrl(
      ctx,
      lookup,
      "postContext.linkCards[].uri",
      uri,
      (u) => ({ _tag: "LinkCardDistribution", uri: u })
    );
    probeDatasetByLandingPage(
      ctx,
      lookup,
      "postContext.linkCards[].uri.landingPage",
      uri,
      (u) => ({ _tag: "LinkCardDatasetLandingPage", uri: u })
    );
  }

  // 3. links[].url → distribution URL short-circuit, then dataset.landingPage fallback
  for (const link of bundle.postContext.links) {
    const url = toNonEmpty(link.url);
    probeDatasetByUrl(
      ctx,
      lookup,
      "postContext.links[].url",
      url,
      (u) => ({ _tag: "PostLinkDistribution", url: u })
    );
    probeDatasetByLandingPage(
      ctx,
      lookup,
      "postContext.links[].url.landingPage",
      url,
      (u) => ({ _tag: "PostLinkDatasetLandingPage", url: u })
    );
  }

  // 4. sourceLines[].datasetName → dataset name matcher
  for (const sourceLine of analysis.sourceLines) {
    probeDatasetByName(
      ctx,
      lookup,
      "asset.analysis.sourceLines[].datasetName",
      toNonEmpty(sourceLine.datasetName),
      (datasetName) => ({ _tag: "SourceLineDatasetName", datasetName })
    );
  }

  // 5. asset.analysis.title → dataset name matcher
  probeDatasetByName(
    ctx,
    lookup,
    "asset.analysis.title",
    toNonEmpty(analysis.title),
    (title) => ({ _tag: "ChartTitle", title })
  );

  // 6. sourceLines[].sourceText → dataset name matcher (new wiring)
  for (const sourceLine of analysis.sourceLines) {
    probeDatasetByName(
      ctx,
      lookup,
      "asset.analysis.sourceLines[].sourceText",
      toNonEmpty(sourceLine.sourceText),
      (sourceText) => ({ _tag: "SourceLineText", sourceText })
    );
  }

  return { datasets: ctx.datasets, trail: ctx.trail };
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** @deprecated Superseded by SKY-343 resolveBundle(); retained only as a cutover reference. */
export const resolveDataReference = (
  bundle: EnrichedBundle,
  lookup: DataLayerRegistryLookup
): DataReferenceResolution => {
  const trail: Array<TrailEntry> = [];

  // Rung 1 — Agent (no scope)
  const rung1 = resolveAgents(bundle, lookup);
  trail.push(...rung1.trail);

  const preferredAgentIds = rung1.agents.map((hit) => hit.agentId);

  // Rung 2 — Dataset (scoped by rung-1 agents)
  const rung2 = resolveDatasets(bundle, lookup, preferredAgentIds);
  trail.push(...rung2.trail);

  // Rung 3 — Series (stub; Series lookup API does not yet exist)
  trail.push({
    rung: "Series",
    signal: "(unimplemented)",
    query: null,
    status: "not-implemented-needs-lookup-api",
    hits: 0,
    note: "DataLayerRegistryLookup has no findSeriesByDatasetId/findSeriesByLabel yet"
  });

  // Rung 4 — Variable (stub; eventually consumes legendLabel / axis units)
  trail.push({
    rung: "Variable",
    signal: "(unimplemented)",
    query: null,
    status: "not-implemented-stub",
    hits: 0,
    note: "will consume series[].legendLabel + xAxis/yAxis label/unit in a later PR"
  });

  return {
    agents: rung1.agents,
    datasets: rung2.datasets,
    series: [],
    variables: [],
    trail
  };
};
