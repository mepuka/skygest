import { Chunk, Data, HashMap, Option, Order } from "effect";
import { aliasSchemes, type AliasScheme } from "../domain/data-layer/alias";
import type {
  Agent,
  Dataset,
  Distribution,
  Variable
} from "../domain/data-layer";
import type {
  AgentHomepageEvidence,
  AgentLabelEvidence,
  AgentMatch,
  AgentProviderEvidence,
  AmbiguousCandidatesResidual,
  DatasetAliasEvidence,
  DatasetMatch,
  DatasetTitleEvidence,
  DeferredToKernelResidual,
  DistributionHostnameEvidence,
  DistributionMatch,
  DistributionUrlPrefixEvidence,
  ExactDistributionUrlEvidence,
  Stage1Evidence,
  Stage1Input,
  Stage1Match,
  Stage1MatchGrain,
  Stage1Residual,
  Stage1Result,
  UnmatchedDatasetTitleResidual,
  UnmatchedTextResidual,
  UnmatchedUrlResidual,
  VariableAliasEvidence,
  VariableMatch
} from "../domain/stage1Resolution";
import { ResolutionEntityId } from "../domain/resolutionEntityId";
import { stripUndefined } from "../platform/Json";
import type { DataLayerRegistryLookup } from "./dataLayerRegistry";
import {
  extractStructuredIdentifierCandidates,
  extractUrlLikeStrings,
  normalizeDistributionHostname,
  normalizeDistributionUrl,
  normalizeLookupText
} from "./normalize";

type MatchEntity = Distribution | Dataset | Agent | Variable;

type MatchBucket = {
  readonly key: MatchKey;
  readonly entity: MatchEntity;
  readonly label: string;
  readonly bestRank: number;
  readonly evidence: Chunk.Chunk<Stage1Evidence>;
};

type ResidualEntry = {
  readonly discoveryOrder: number;
  readonly residual: Stage1Residual;
};

class MatchKey extends Data.Class<{
  readonly grain: Stage1MatchGrain;
  readonly entityId: ResolutionEntityId;
}> {}

const structuredAliasSchemes = aliasSchemes.filter(
  (scheme): scheme is AliasScheme => scheme !== "url"
);

const grainPriority: Record<Stage1MatchGrain, number> = {
  Distribution: 0,
  Dataset: 1,
  Agent: 2,
  Variable: 3
};

const bucketOrder = Order.combineAll<MatchBucket>([
  Order.mapInput(Order.Number, (bucket) => bucket.bestRank),
  Order.mapInput(Order.String, (bucket) => bucket.key.entityId)
]);

const matchOrder = Order.combineAll<Stage1Match>([
  Order.mapInput(
    Order.Number,
    (match) => grainPriority[matchGrain(match)]
  ),
  Order.mapInput(Order.Number, (match) => match.bestRank),
  Order.mapInput(Order.String, (match) => matchCanonicalId(match))
]);

const residualOrder = Order.combineAll<ResidualEntry>([
  Order.mapInput(Order.String, (entry) => entry.residual._tag),
  Order.mapInput(Order.Number, (entry) => entry.discoveryOrder)
]);

const toNonEmpty = (value: string | null | undefined) => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const matchGrain = (match: Stage1Match): Stage1MatchGrain => {
  switch (match._tag) {
    case "DistributionMatch":
      return "Distribution";
    case "DatasetMatch":
      return "Dataset";
    case "AgentMatch":
      return "Agent";
    case "VariableMatch":
      return "Variable";
  }
};

const matchCanonicalId = (match: Stage1Match) => {
  switch (match._tag) {
    case "DistributionMatch":
      return match.distributionId;
    case "DatasetMatch":
      return match.datasetId;
    case "AgentMatch":
      return match.agentId;
    case "VariableMatch":
      return match.variableId;
  }
};

const labelForEntity = (entity: MatchEntity) => {
  switch (entity._tag) {
    case "Distribution":
      return entity.title ?? entity.id;
    case "Dataset":
      return entity.title;
    case "Agent":
      return entity.name;
    case "Variable":
      return entity.label;
  }
};

const residualKey = (residual: Stage1Residual) => {
  switch (residual._tag) {
    case "UnmatchedUrlResidual":
      return [
        residual._tag,
        residual.source,
        residual.url,
        residual.normalizedUrl ?? "",
        residual.hostname ?? ""
      ].join("\u0000");
    case "UnmatchedDatasetTitleResidual":
      return [
        residual._tag,
        residual.datasetName,
        residual.normalizedTitle,
        residual.assetKey ?? ""
      ].join("\u0000");
    case "UnmatchedTextResidual":
      return [
        residual._tag,
        residual.source,
        residual.text,
        residual.normalizedText,
        residual.assetKey ?? "",
        residual.location ?? ""
      ].join("\u0000");
    case "AmbiguousCandidatesResidual":
      return [
        residual._tag,
        residual.grain,
        String(residual.bestRank),
        residual.candidates.map((candidate) => candidate.entityId).join("|")
      ].join("\u0000");
    case "DeferredToKernelResidual":
      return [
        residual._tag,
        residual.source,
        residual.text,
        residual.reason,
        residual.assetKey ?? ""
      ].join("\u0000");
  }
};

type BuildState = {
  index: HashMap.HashMap<MatchKey, MatchBucket>;
  residuals: Array<ResidualEntry>;
  residualKeys: Set<string>;
  nextResidualOrder: number;
};

const makeState = (): BuildState => ({
  index: HashMap.empty(),
  residuals: [],
  residualKeys: new Set<string>(),
  nextResidualOrder: 0
});

const addResidual = (state: BuildState, residual: Stage1Residual) => {
  const key = residualKey(residual);
  if (state.residualKeys.has(key)) {
    return;
  }

  state.residualKeys.add(key);
  state.residuals.push({
    discoveryOrder: state.nextResidualOrder++,
    residual
  });
};

const addEvidence = (
  state: BuildState,
  grain: Stage1MatchGrain,
  entity: MatchEntity,
  evidence: Stage1Evidence
) => {
  const key = new MatchKey({
    grain,
    entityId: entity.id
  });
  const next = Option.match(HashMap.get(state.index, key), {
    onNone: (): MatchBucket => ({
      key,
      entity,
      label: labelForEntity(entity),
      bestRank: evidence.rank,
      evidence: Chunk.of(evidence)
    }),
    onSome: (bucket): MatchBucket => ({
      ...bucket,
      bestRank: Math.min(bucket.bestRank, evidence.rank),
      evidence: Chunk.append(bucket.evidence, evidence)
    })
  });

  state.index = HashMap.set(state.index, key, next);
};

const pushDistributionMatches = (
  state: BuildState,
  source: ExactDistributionUrlEvidence["source"],
  url: string,
  lookup: DataLayerRegistryLookup
) => {
  const exact = lookup.findDistributionByUrl(url);
  if (Option.isSome(exact)) {
    addEvidence(state, "Distribution", exact.value, {
      _tag: "ExactDistributionUrlEvidence",
      signal: "distribution-url-exact",
      rank: 1,
      source,
      url,
      normalizedUrl: normalizeDistributionUrl(url) ?? url
    });
    return true;
  }

  const prefixMatches = [...lookup.findDistributionsByUrlPrefix(url)];
  if (prefixMatches.length > 0) {
    const normalizedPrefix = normalizeDistributionUrl(url) ?? url;
    for (const distribution of prefixMatches) {
      addEvidence(state, "Distribution", distribution, {
        _tag: "DistributionUrlPrefixEvidence",
        signal: "distribution-url-prefix",
        rank: 2,
        source,
        url,
        normalizedPrefix
      });
    }
    return true;
  }

  const hostnameMatches = [...lookup.findDistributionsByHostname(url)];
  if (hostnameMatches.length > 0) {
    const hostname = normalizeDistributionHostname(url) ?? url;
    for (const distribution of hostnameMatches) {
      addEvidence(state, "Distribution", distribution, {
        _tag: "DistributionHostnameEvidence",
        signal: "distribution-hostname",
        rank: 3,
        source,
        url,
        hostname
      });
    }
    return true;
  }

  addResidual(
    state,
    stripUndefined({
      _tag: "UnmatchedUrlResidual" as const,
      source,
      url,
      normalizedUrl: normalizeDistributionUrl(url) ?? undefined,
      hostname: normalizeDistributionHostname(url) ?? undefined
    })
  );
  return false;
};

const pushDatasetTitleMatch = (
  state: BuildState,
  datasetName: string,
  assetKey: string | undefined,
  lookup: DataLayerRegistryLookup,
  options: {
    readonly emitResidualOnMiss?: boolean;
  } = {}
) => {
  const match = lookup.findDatasetByTitle(datasetName);
  if (Option.isSome(match)) {
    addEvidence(
      state,
      "Dataset",
      match.value,
      stripUndefined({
        _tag: "DatasetTitleEvidence" as const,
        signal: "dataset-title" as const,
        rank: 1,
        assetKey,
        datasetName,
        normalizedTitle: normalizeLookupText(datasetName)
      })
    );
    return true;
  }

  if (options.emitResidualOnMiss ?? true) {
    addResidual(
      state,
      stripUndefined({
        _tag: "UnmatchedDatasetTitleResidual" as const,
        datasetName,
        normalizedTitle: normalizeLookupText(datasetName),
        assetKey
      })
    );
  }
  return false;
};

const pushStructuredAliasMatches = (
  state: BuildState,
  text: string,
  source: string,
  lookup: DataLayerRegistryLookup
) => {
  const candidates = new Set<string>([
    text,
    ...extractStructuredIdentifierCandidates(text)
  ]);
  let matched = false;

  for (const candidate of candidates) {
    const value = toNonEmpty(candidate);
    if (value === null) {
      continue;
    }

    for (const scheme of structuredAliasSchemes) {
      const dataset = lookup.findDatasetByAlias(scheme, value);
      if (Option.isSome(dataset)) {
        matched = true;
        addEvidence(state, "Dataset", dataset.value, {
          _tag: "DatasetAliasEvidence",
          signal: "dataset-alias",
          rank: 2,
          aliasScheme: scheme,
          aliasValue: value,
          source
        });
      }

      const variable = lookup.findVariableByAlias(scheme, value);
      if (Option.isSome(variable)) {
        matched = true;
        addEvidence(state, "Variable", variable.value, {
          _tag: "VariableAliasEvidence",
          signal: "variable-alias",
          rank: 1,
          aliasScheme: scheme,
          aliasValue: value,
          source
        });
      }
    }
  }

  return matched;
};

const pushAgentProviderHints = (
  state: BuildState,
  input: Stage1Input,
  lookup: DataLayerRegistryLookup
) => {
  if (input.sourceAttribution === null) {
    return;
  }

  const provider = input.sourceAttribution.provider;
  if (provider !== null) {
    const agentByLabel = lookup.findAgentByLabel(provider.providerLabel);
    if (Option.isSome(agentByLabel)) {
      addEvidence(state, "Agent", agentByLabel.value, {
        _tag: "AgentProviderEvidence",
        signal: "agent-provider",
        rank: 1,
        providerLabel: provider.providerLabel,
        providerId: provider.providerId,
        sourceFamily: provider.sourceFamily
      });
    }
  }

  const homepageHint =
    input.sourceAttribution.contentSource?.domain ??
    input.sourceAttribution.contentSource?.url ??
    null;

  if (homepageHint === null) {
    return;
  }

  const homepageAgent = lookup.findAgentByHomepageDomain(homepageHint);
  if (Option.isSome(homepageAgent)) {
    addEvidence(state, "Agent", homepageAgent.value, {
      _tag: "AgentHomepageEvidence",
      signal: "agent-homepage-domain",
      rank: 2,
      providerLabel: provider?.providerLabel ?? homepageHint,
      homepageDomain:
        normalizeDistributionHostname(homepageHint) ?? normalizeLookupText(homepageHint)
    });
  }
};

const pushAgentLabelMatch = (
  state: BuildState,
  source: AgentLabelEvidence["source"],
  text: string,
  lookup: DataLayerRegistryLookup,
  options: {
    readonly assetKey?: string;
    readonly location?: string;
    readonly rank?: number;
    readonly emitResidualOnMiss?: boolean;
  } = {}
) => {
  const agent = lookup.findAgentByLabel(text);
  if (Option.isSome(agent)) {
    addEvidence(
      state,
      "Agent",
      agent.value,
      stripUndefined({
        _tag: "AgentLabelEvidence" as const,
        signal: "agent-label" as const,
        rank: options.rank ?? 3,
        source,
        text,
        normalizedLabel: normalizeLookupText(text),
        assetKey: options.assetKey,
        location: options.location
      })
    );
    return true;
  }

  if (options.emitResidualOnMiss ?? true) {
    addResidual(
      state,
      stripUndefined({
        _tag: "UnmatchedTextResidual" as const,
        source,
        text,
        normalizedText: normalizeLookupText(text),
        assetKey: options.assetKey,
        location: options.location
      })
    );
  }
  return false;
};

const pushDeferredResidual = (
  state: BuildState,
  source: DeferredToKernelResidual["source"],
  text: string,
  assetKey?: string
) => {
  addResidual(
    state,
    stripUndefined({
      _tag: "DeferredToKernelResidual" as const,
      source,
      text,
      reason: "requires kernel semantic interpretation",
      assetKey
    })
  );
};

const buildMatch = (bucket: MatchBucket): Stage1Match => {
  switch (bucket.key.grain) {
    case "Distribution":
      return {
        _tag: "DistributionMatch",
        distributionId: bucket.entity.id as Distribution["id"],
        title:
          bucket.entity._tag === "Distribution"
            ? bucket.entity.title ?? null
            : null,
        bestRank: bucket.bestRank,
        evidence: [...bucket.evidence]
      };
    case "Dataset":
      return {
        _tag: "DatasetMatch",
        datasetId: bucket.entity.id as Dataset["id"],
        title: bucket.entity._tag === "Dataset" ? bucket.entity.title : bucket.label,
        bestRank: bucket.bestRank,
        evidence: [...bucket.evidence]
      };
    case "Agent":
      return {
        _tag: "AgentMatch",
        agentId: bucket.entity.id as Agent["id"],
        name: bucket.entity._tag === "Agent" ? bucket.entity.name : bucket.label,
        bestRank: bucket.bestRank,
        evidence: [...bucket.evidence]
      };
    case "Variable":
      return {
        _tag: "VariableMatch",
        variableId: bucket.entity.id as Variable["id"],
        label: bucket.entity._tag === "Variable" ? bucket.entity.label : bucket.label,
        bestRank: bucket.bestRank,
        evidence: [...bucket.evidence]
      };
  }
};

const resolveGrain = (
  state: BuildState,
  grain: Stage1MatchGrain
): ReadonlyArray<Stage1Match> => {
  const buckets = [...HashMap.values(state.index)]
    .filter((bucket) => bucket.key.grain === grain)
    .sort(bucketOrder);

  if (buckets.length === 0) {
    return [];
  }

  const firstBucket = buckets[0]!;
  const bestRank = firstBucket.bestRank;
  const top = buckets.filter((bucket) => bucket.bestRank === bestRank);
  if (top.length === 1) {
    return [buildMatch(top[0]!)];
  }

  const ambiguityResidual: AmbiguousCandidatesResidual = {
    _tag: "AmbiguousCandidatesResidual",
    grain,
    bestRank,
    candidates: top.map((bucket) => ({
      entityId: bucket.key.entityId,
      label: bucket.label
    })),
    evidence: top.flatMap((bucket) => [...bucket.evidence])
  };
  addResidual(state, ambiguityResidual);
  return [];
};

export const runStage1 = (
  input: Stage1Input,
  lookup: DataLayerRegistryLookup
): Stage1Result => {
  const state = makeState();

  for (const link of input.postContext.links) {
    pushDistributionMatches(state, "post-link", link.url, lookup);
    pushStructuredAliasMatches(state, link.url, "post-link:url", lookup);
    if (link.title !== null) {
      pushStructuredAliasMatches(state, link.title, "post-link:title", lookup);
    }
    if (link.description !== null) {
      pushStructuredAliasMatches(
        state,
        link.description,
        "post-link:description",
        lookup
      );
    }
  }

  for (const linkCard of input.postContext.linkCards) {
    pushDistributionMatches(state, "link-card", linkCard.uri, lookup);
    pushStructuredAliasMatches(state, linkCard.uri, "link-card:uri", lookup);
    if (linkCard.title !== null) {
      pushStructuredAliasMatches(state, linkCard.title, "link-card:title", lookup);
    }
    if (linkCard.description !== null) {
      pushStructuredAliasMatches(
        state,
        linkCard.description,
        "link-card:description",
        lookup
      );
    }
  }

  for (const url of extractUrlLikeStrings(input.postContext.text)) {
    pushDistributionMatches(state, "post-link", url, lookup);
  }

  const postTextConsumed = pushStructuredAliasMatches(
    state,
    input.postContext.text,
    "post-text",
    lookup
  );
  if (!postTextConsumed) {
    pushDeferredResidual(state, "post-text", input.postContext.text);
  }

  pushAgentProviderHints(state, input, lookup);

  if (input.vision !== null) {
    for (const asset of input.vision.assets) {
      for (const sourceLine of asset.analysis.sourceLines) {
        for (const url of extractUrlLikeStrings(sourceLine.sourceText)) {
          pushDistributionMatches(state, "source-line", url, lookup);
        }

        pushStructuredAliasMatches(
          state,
          sourceLine.sourceText,
          "source-line:text",
          lookup
        );

        const datasetName = toNonEmpty(sourceLine.datasetName);
        if (datasetName !== null) {
          const matchedDatasetName =
            pushDatasetTitleMatch(state, datasetName, asset.assetKey, lookup, {
              emitResidualOnMiss: false
            }) ||
            pushStructuredAliasMatches(
              state,
              datasetName,
              "source-line:dataset-name",
              lookup
            );
          if (!matchedDatasetName) {
            addResidual(
              state,
              stripUndefined({
                _tag: "UnmatchedDatasetTitleResidual" as const,
                datasetName,
                normalizedTitle: normalizeLookupText(datasetName),
                assetKey: asset.assetKey
              })
            );
          }
        }
      }

      const title = toNonEmpty(asset.analysis.title);
      if (title !== null) {
        const matchedTitle =
          pushAgentLabelMatch(state, "chart-title", title, lookup, {
            assetKey: asset.assetKey,
            rank: 4,
            emitResidualOnMiss: false
          }) ||
          pushStructuredAliasMatches(
            state,
            title,
            "chart-title",
            lookup
          );
        if (!matchedTitle) {
          pushDeferredResidual(state, "chart-title", title, asset.assetKey);
        }
      }

      for (const visibleUrl of asset.analysis.visibleUrls) {
        pushDistributionMatches(state, "visible-url", visibleUrl, lookup);
        pushStructuredAliasMatches(state, visibleUrl, "visible-url", lookup);
      }

      for (const mention of asset.analysis.organizationMentions) {
        pushAgentLabelMatch(state, "organization-mention", mention.name, lookup, {
          assetKey: asset.assetKey,
          location: mention.location
        });
      }

      for (const logoText of asset.analysis.logoText) {
        pushAgentLabelMatch(state, "logo-text", logoText, lookup, {
          assetKey: asset.assetKey
        });
      }

      const xAxisLabel = toNonEmpty(asset.analysis.xAxis?.label);
      if (xAxisLabel !== null) {
        const matchedAxis = pushStructuredAliasMatches(
          state,
          xAxisLabel,
          "x-axis-label",
          lookup
        );
        if (!matchedAxis) {
          pushDeferredResidual(state, "axis-label", xAxisLabel, asset.assetKey);
        }
      }

      const yAxisLabel = toNonEmpty(asset.analysis.yAxis?.label);
      if (yAxisLabel !== null) {
        const matchedAxis = pushStructuredAliasMatches(
          state,
          yAxisLabel,
          "y-axis-label",
          lookup
        );
        if (!matchedAxis) {
          pushDeferredResidual(state, "axis-label", yAxisLabel, asset.assetKey);
        }
      }
    }
  }

  const matches = [
    ...resolveGrain(state, "Distribution"),
    ...resolveGrain(state, "Dataset"),
    ...resolveGrain(state, "Agent"),
    ...resolveGrain(state, "Variable")
  ].sort(matchOrder);

  const residuals = state.residuals
    .sort(residualOrder)
    .map((entry) => entry.residual);

  return {
    matches,
    residuals
  };
};
