import { Effect, Option, Schema } from "effect";
import type { AgentId, DatasetId } from "../../domain/data-layer/ids";
import type {
  SearchLimit,
  EntitySearchHit as EntitySearchHitValue
} from "../../domain/entitySearch";
import type { EnrichedBundle, ResolutionRung } from "../../domain/enrichedBundle";
import {
  BundleResolution as BundleResolutionSchema,
  type BundleResolution,
  type BundleResolutionSignal,
  type BundleResolutionSignalKind,
  type BundleResolutionTrailEntry,
  type ResolvedAgent,
  type ResolvedDataset
} from "../../domain/bundleResolution";
import {
  normalizeDistributionHostname,
  normalizeDistributionUrl,
  normalizeLookupText
} from "../../platform/Normalize";
import { DataLayerRegistry } from "../../services/DataLayerRegistry";
import { EntitySearchService } from "../../services/EntitySearchService";

type ResolveBundleOptions = {
  readonly limit?: SearchLimit;
};

type TextSignalQuery = {
  readonly signal: BundleResolutionSignal;
  readonly query: string;
};

type ExactSignalQuery = {
  readonly signal: BundleResolutionSignal;
  readonly query: string;
};

const decodeBundleResolution = Schema.decodeUnknownSync(BundleResolutionSchema);
const defaultSearchLimit = 5 as SearchLimit;

const toNonEmpty = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const makeSignal = (
  kind: BundleResolutionSignalKind,
  field: string,
  value: string
): BundleResolutionSignal => ({
  kind,
  field,
  value
});

const pushTextSignal = (
  values: Array<TextSignalQuery>,
  seen: Set<string>,
  kind: BundleResolutionSignalKind,
  field: string,
  rawValue: string | null | undefined
) => {
  const value = toNonEmpty(rawValue);
  if (value === null) {
    return;
  }

  const key = `${kind}\u0000${field}\u0000${normalizeLookupText(value)}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  values.push({
    signal: makeSignal(kind, field, value),
    query: value
  });
};

const pushExactHostnameSignal = (
  values: Array<ExactSignalQuery>,
  seen: Set<string>,
  kind: BundleResolutionSignalKind,
  field: string,
  rawValue: string | null | undefined
) => {
  const value = toNonEmpty(rawValue);
  if (value === null) {
    return;
  }

  const hostname = normalizeDistributionHostname(value);
  if (hostname === null) {
    return;
  }

  const key = `${kind}\u0000${field}\u0000${hostname}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  values.push({
    signal: makeSignal(kind, field, value),
    query: hostname
  });
};

const pushExactUrlSignal = (
  values: Array<ExactSignalQuery>,
  seen: Set<string>,
  kind: BundleResolutionSignalKind,
  field: string,
  rawValue: string | null | undefined
) => {
  const value = toNonEmpty(rawValue);
  if (value === null) {
    return;
  }

  const url = normalizeDistributionUrl(value);
  if (url === null) {
    return;
  }

  const key = `${kind}\u0000${field}\u0000${url}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  values.push({
    signal: makeSignal(kind, field, value),
    query: url
  });
};

const collectAgentTextQueries = (
  bundle: EnrichedBundle
): ReadonlyArray<TextSignalQuery> => {
  const values: Array<TextSignalQuery> = [];
  const seen = new Set<string>();

  pushTextSignal(
    values,
    seen,
    "source-attribution-provider-label",
    "sourceAttribution.provider.providerLabel",
    bundle.sourceAttribution?.provider?.providerLabel
  );

  for (const logoText of bundle.asset.analysis.logoText) {
    pushTextSignal(
      values,
      seen,
      "logo-text",
      "asset.analysis.logoText[]",
      logoText
    );
  }

  for (const mention of bundle.asset.analysis.organizationMentions) {
    pushTextSignal(
      values,
      seen,
      "organization-mention",
      "asset.analysis.organizationMentions[].name",
      mention.name
    );
  }

  for (const sourceLine of bundle.asset.analysis.sourceLines) {
    pushTextSignal(
      values,
      seen,
      "source-line-text",
      "asset.analysis.sourceLines[].sourceText",
      sourceLine.sourceText
    );
  }

  return values;
};

const collectAgentExactHostnameQueries = (
  bundle: EnrichedBundle
): ReadonlyArray<ExactSignalQuery> => {
  const values: Array<ExactSignalQuery> = [];
  const seen = new Set<string>();

  pushExactHostnameSignal(
    values,
    seen,
    "source-attribution-content-domain",
    "sourceAttribution.contentSource.domain",
    bundle.sourceAttribution?.contentSource?.domain
  );

  for (const visibleUrl of bundle.asset.analysis.visibleUrls) {
    pushExactHostnameSignal(
      values,
      seen,
      "visible-url-domain",
      "asset.analysis.visibleUrls[]",
      visibleUrl
    );
  }

  for (const card of bundle.postContext.linkCards) {
    pushExactHostnameSignal(
      values,
      seen,
      "link-card-domain",
      "postContext.linkCards[].uri",
      card.uri
    );
  }

  for (const link of bundle.postContext.links) {
    pushExactHostnameSignal(
      values,
      seen,
      "post-link-domain",
      "postContext.links[].domain",
      link.domain ?? link.url
    );
  }

  return values;
};

const collectDatasetTextQueries = (
  bundle: EnrichedBundle
): ReadonlyArray<TextSignalQuery> => {
  const values: Array<TextSignalQuery> = [];
  const seen = new Set<string>();

  for (const sourceLine of bundle.asset.analysis.sourceLines) {
    pushTextSignal(
      values,
      seen,
      "source-line-dataset-name",
      "asset.analysis.sourceLines[].datasetName",
      sourceLine.datasetName
    );
  }

  pushTextSignal(
    values,
    seen,
    "chart-title",
    "asset.analysis.title",
    bundle.asset.analysis.title
  );

  for (const sourceLine of bundle.asset.analysis.sourceLines) {
    pushTextSignal(
      values,
      seen,
      "source-line-text",
      "asset.analysis.sourceLines[].sourceText",
      sourceLine.sourceText
    );
  }

  return values;
};

const collectDatasetExactUrlQueries = (
  bundle: EnrichedBundle
): ReadonlyArray<ExactSignalQuery> => {
  const values: Array<ExactSignalQuery> = [];
  const seen = new Set<string>();

  pushExactUrlSignal(
    values,
    seen,
    "source-attribution-content-url",
    "sourceAttribution.contentSource.url",
    bundle.sourceAttribution?.contentSource?.url
  );

  for (const visibleUrl of bundle.asset.analysis.visibleUrls) {
    pushExactUrlSignal(
      values,
      seen,
      "visible-url",
      "asset.analysis.visibleUrls[]",
      visibleUrl
    );
  }

  for (const card of bundle.postContext.linkCards) {
    pushExactUrlSignal(
      values,
      seen,
      "link-card-url",
      "postContext.linkCards[].uri",
      card.uri
    );
  }

  for (const link of bundle.postContext.links) {
    pushExactUrlSignal(
      values,
      seen,
      "post-link-url",
      "postContext.links[].url",
      link.url
    );
  }

  return values;
};

const makeTrailEntry = (
  input: BundleResolutionTrailEntry
): BundleResolutionTrailEntry => input;

const makeTrailHitsFromSearch = (
  hits: ReadonlyArray<EntitySearchHitValue>
) => hits.map((hit) => ({
  entityId: hit.document.entityId,
  score: hit.score,
  matchKind: hit.matchKind
}));

const pushResolvedAgent = (
  agents: Array<ResolvedAgent>,
  seen: Set<string>,
  input: ResolvedAgent
) => {
  if (seen.has(input.entityId)) {
    return;
  }

  seen.add(input.entityId);
  agents.push(input);
};

const pushResolvedDataset = (
  datasets: Array<ResolvedDataset>,
  seen: Set<string>,
  input: ResolvedDataset
) => {
  if (seen.has(input.entityId)) {
    return;
  }

  seen.add(input.entityId);
  datasets.push(input);
};

const makeNotImplementedEntry = (
  rung: Extract<ResolutionRung, "Series" | "Variable">,
  note: string
): BundleResolutionTrailEntry =>
  makeTrailEntry({
    rung,
    signal: makeSignal("not-implemented", "(unimplemented)", rung),
    lane: "not-implemented",
    query: null,
    scoped: false,
    scopeAgentIds: [],
    hits: [],
    note
  });

export const resolveBundle = Effect.fn("resolveBundle")(function* (
  bundle: EnrichedBundle,
  options: ResolveBundleOptions = {}
) {
  const registry = yield* DataLayerRegistry;
  const entitySearch = yield* EntitySearchService;
  const lookup = registry.lookup;
  const limit = options.limit ?? defaultSearchLimit;

  const trail: Array<BundleResolutionTrailEntry> = [];
  const agents: Array<ResolvedAgent> = [];
  const datasets: Array<ResolvedDataset> = [];
  const seenAgentIds = new Set<string>();
  const seenDatasetIds = new Set<string>();

  for (const probe of collectAgentExactHostnameQueries(bundle)) {
    const matchedAgent = Option.getOrNull(
      lookup.findAgentByHomepageDomain(probe.query)
    );
    const hits =
      matchedAgent === null
        ? []
        : [
            {
              entityId: matchedAgent.id,
              score: null,
              matchKind: "exact-hostname" as const
            }
          ];

    trail.push(
      makeTrailEntry({
        rung: "Agent",
        signal: probe.signal,
        lane: "exact-hostname",
        query: probe.query,
        scoped: false,
        scopeAgentIds: [],
        hits,
        note: null
      })
    );

    if (matchedAgent !== null) {
      pushResolvedAgent(agents, seenAgentIds, {
        entityId: matchedAgent.id,
        signal: probe.signal,
        score: null,
        scoped: false,
        matchKind: "exact-hostname"
      });
    }
  }

  for (const probe of collectAgentTextQueries(bundle)) {
    const hits = yield* entitySearch.searchAgents({
      query: probe.query,
      limit
    });

    trail.push(
      makeTrailEntry({
        rung: "Agent",
        signal: probe.signal,
        lane: "search",
        query: probe.query,
        scoped: false,
        scopeAgentIds: [],
        hits: makeTrailHitsFromSearch(hits),
        note: null
      })
    );

    for (const hit of hits) {
      pushResolvedAgent(agents, seenAgentIds, {
        entityId: hit.document.entityId as AgentId,
        signal: probe.signal,
        score: hit.score,
        scoped: false,
        matchKind: hit.matchKind
      });
    }
  }

  const scopeAgentIds = agents.map((agent) => agent.entityId);

  for (const probe of collectDatasetExactUrlQueries(bundle)) {
    const distribution = Option.getOrNull(lookup.findDistributionByUrl(probe.query));
    const matchedDatasetId =
      distribution?.datasetId ??
      Option.getOrNull(lookup.findDatasetByLandingPage(probe.query))?.id ??
      null;
    const note =
      distribution !== null
        ? "matched distribution URL"
        : matchedDatasetId !== null
          ? "matched dataset landing page"
          : null;
    const hits =
      matchedDatasetId === null
        ? []
        : [
            {
              entityId: matchedDatasetId,
              score: null,
              matchKind: "exact-url" as const
            }
          ];

    trail.push(
      makeTrailEntry({
        rung: "Dataset",
        signal: probe.signal,
        lane: "exact-url",
        query: probe.query,
        scoped: false,
        scopeAgentIds: [],
        hits,
        note
      })
    );

    if (matchedDatasetId !== null) {
      pushResolvedDataset(datasets, seenDatasetIds, {
        entityId: matchedDatasetId,
        signal: probe.signal,
        score: null,
        scoped: false,
        matchKind: "exact-url"
      });
    }
  }

  for (const probe of collectDatasetTextQueries(bundle)) {
    const scopedAgents = scopeAgentIds.length === 0 ? [null] : scopeAgentIds;

    for (const scopeAgentId of scopedAgents) {
      const hits = yield* entitySearch.searchDatasets(
        scopeAgentId === null
          ? {
              query: probe.query,
              limit
            }
          : {
              query: probe.query,
              scope: {
                publisherAgentId: scopeAgentId
              },
              limit
            }
      );

      trail.push(
        makeTrailEntry({
          rung: "Dataset",
          signal: probe.signal,
          lane: "search",
          query: probe.query,
          scoped: scopeAgentId !== null,
          scopeAgentIds: scopeAgentId === null ? [] : [scopeAgentId],
          hits: makeTrailHitsFromSearch(hits),
          note: null
        })
      );

      for (const hit of hits) {
        pushResolvedDataset(datasets, seenDatasetIds, {
          entityId: hit.document.entityId as DatasetId,
          signal: probe.signal,
          score: hit.score,
          scoped: scopeAgentId !== null,
          matchKind: hit.matchKind
        });
      }
    }
  }

  trail.push(
    makeNotImplementedEntry(
      "Series",
      "Series search will be wired in the next SKY-343 slice once the agent/dataset envelope is proven."
    )
  );
  trail.push(
    makeNotImplementedEntry(
      "Variable",
      "Variable search stays deferred in this initial SKY-343 slice."
    )
  );

  return decodeBundleResolution({
    agents,
    datasets,
    series: [],
    variables: [],
    trail
  }) satisfies BundleResolution;
});
