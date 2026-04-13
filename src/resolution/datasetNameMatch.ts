import { Option } from "effect";
import {
  AliasSchemeValues,
  aliasSchemes,
  type AliasScheme
} from "../domain/data-layer/alias";
import type { Agent, Dataset } from "../domain/data-layer";
import type { AgentId } from "../domain/data-layer/ids";
import type { VisionAssetEnrichment } from "../domain/enrichment";
import type { DatasetNameMatch } from "../domain/resolutionKernel";
import type { Stage1Input } from "../domain/stage1Resolution";
import type { DataLayerRegistryLookup } from "./dataLayerRegistry";
import { jaccardTokenSet } from "./fuzzyMatch";
import { extractStructuredIdentifierCandidates } from "./normalize";

const structuredAliasSchemes = aliasSchemes.filter(
  (scheme): scheme is AliasScheme =>
    scheme !== "url" && scheme !== AliasSchemeValues.displayAlias
);
// Dataset-title matching keeps three load-bearing policies together:
// strip peripheral years, require a 0.75 fuzzy floor, and let publisher
// preference break ties without ever outranking a better global score.
export const DATASET_TITLE_FUZZY_THRESHOLD = 0.75;
export const DATASET_TITLE_CONFIDENT_THRESHOLD = 0.9;
const DATASET_TITLE_SCORE_EPSILON = 0.000_001;

const toNonEmpty = (value: string | null | undefined) => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export const stripPeripheralYear = (value: string) => {
  const trimmed = value.trim();
  const stripped = trimmed
    .replace(/^\s*[\(\[]?(?:19|20)\d{2}[\)\]]?[\s:–-]*/u, "")
    .replace(/\s*[\(\[]?(?:19|20)\d{2}[\)\]]?\s*$/u, "")
    .replace(/\s*[-–,:/]\s*$/u, "")
    .trim();

  return stripped.length > 0 ? stripped : trimmed;
};

const listDatasetTitleCandidates = (datasetName: string): ReadonlyArray<string> => {
  const candidates = new Set<string>();
  const base = toNonEmpty(datasetName);
  if (base === null) {
    return [];
  }

  candidates.add(base);
  candidates.add(stripPeripheralYear(base));
  return [...candidates];
};

const listStructuredAliasCandidates = (
  datasetName: string
): ReadonlyArray<string> => {
  const candidates = new Set<string>();

  for (const candidate of [
    datasetName,
    ...extractStructuredIdentifierCandidates(datasetName)
  ]) {
    const value = toNonEmpty(candidate);
    if (value !== null) {
      candidates.add(value);
    }
  }

  return [...candidates];
};

const listAllDatasets = (
  lookup: DataLayerRegistryLookup
): ReadonlyArray<Dataset> =>
  Array.from(lookup.entities).flatMap((entity) =>
    entity._tag === "Dataset" ? [entity] : []
  );

const dedupeDatasets = (
  datasets: ReadonlyArray<Dataset>
): ReadonlyArray<Dataset> => {
  const seen = new Set<Dataset["id"]>();
  const deduped: Array<Dataset> = [];

  for (const dataset of datasets) {
    if (seen.has(dataset.id)) {
      continue;
    }

    seen.add(dataset.id);
    deduped.push(dataset);
  }

  return deduped;
};

export const listPreferredDatasetAgentIds = (
  input: Stage1Input,
  asset: VisionAssetEnrichment,
  lookup: DataLayerRegistryLookup
): ReadonlyArray<AgentId> => {
  const agentIds = new Set<AgentId>();

  const addAgentLabel = (label: string | null | undefined) => {
    const value = toNonEmpty(label);
    if (value === null) {
      return;
    }

    const match = lookup.findAgentByLabel(value);
    if (Option.isSome(match)) {
      agentIds.add(match.value.id);
    }
  };

  const addHomepageHint = (value: string | null | undefined) => {
    const hint = toNonEmpty(value);
    if (hint === null) {
      return;
    }

    const match = lookup.findAgentByHomepageDomain(hint);
    if (Option.isSome(match)) {
      agentIds.add(match.value.id);
    }
  };

  addAgentLabel(input.sourceAttribution?.provider?.providerLabel);
  addAgentLabel(input.sourceAttribution?.contentSource?.publication);
  addHomepageHint(input.sourceAttribution?.contentSource?.domain);
  addHomepageHint(input.sourceAttribution?.contentSource?.url);

  for (const mention of asset.analysis.organizationMentions) {
    addAgentLabel(mention.name);
  }

  for (const logoText of asset.analysis.logoText) {
    addAgentLabel(logoText);
  }

  return [...agentIds];
};

const scoreDatasetTitle = (
  datasetName: string,
  dataset: Dataset
): number => {
  const haystacks = [
    dataset.title,
    ...dataset.aliases
      .filter((alias) => alias.scheme === AliasSchemeValues.displayAlias)
      .map((alias) => alias.value)
  ];

  let bestScore = 0;
  for (const candidate of listDatasetTitleCandidates(datasetName)) {
    for (const haystack of haystacks) {
      for (const comparison of listDatasetTitleCandidates(haystack)) {
        bestScore = Math.max(bestScore, jaccardTokenSet(candidate, comparison));
      }
    }
  }

  return bestScore;
};

const compareDatasetTitleScores = (
  left: {
    readonly dataset: Dataset;
    readonly score: number;
    readonly preferred: boolean;
  },
  right: {
    readonly dataset: Dataset;
    readonly score: number;
    readonly preferred: boolean;
  }
) =>
  right.score - left.score ||
  Number(right.preferred) - Number(left.preferred) ||
  left.dataset.title.localeCompare(right.dataset.title) ||
  left.dataset.id.localeCompare(right.dataset.id);

const findFuzzyDatasetTitleMatches = (
  datasetName: string,
  lookup: DataLayerRegistryLookup,
  preferredAgentIds: ReadonlyArray<AgentId>
): ReadonlyArray<{
  readonly dataset: Dataset;
  readonly score: number;
}> => {
  const preferredDatasetIds = new Set(
    dedupeDatasets(
      preferredAgentIds.flatMap((agentId) => [...lookup.findDatasetsByAgentId(agentId)])
    ).map((dataset) => dataset.id)
  );
  const scored = dedupeDatasets(listAllDatasets(lookup))
    .map((dataset) => ({
      dataset,
      score: scoreDatasetTitle(datasetName, dataset),
      preferred: preferredDatasetIds.has(dataset.id)
    }))
    .filter((candidate) => candidate.score >= DATASET_TITLE_FUZZY_THRESHOLD)
    .sort(compareDatasetTitleScores);

  const best = scored[0];
  if (best === undefined) {
    return [];
  }

  return scored
    .filter(
      (candidate) =>
        Math.abs(candidate.score - best.score) <= DATASET_TITLE_SCORE_EPSILON &&
        candidate.preferred === best.preferred
    )
    .map(({ dataset, score }) => ({
      dataset,
      score
    }));
};

const findDatasetAliasMatches = (
  datasetName: string,
  lookup: DataLayerRegistryLookup
): ReadonlyArray<DatasetNameMatch> => {
  const matches = new Map<string, DatasetNameMatch>();

  for (const candidate of listStructuredAliasCandidates(datasetName)) {
    for (const scheme of structuredAliasSchemes) {
      const dataset = lookup.findDatasetByAlias(scheme, candidate);
      if (Option.isNone(dataset) || matches.has(dataset.value.id)) {
        continue;
      }

      matches.set(dataset.value.id, {
        _tag: "DatasetAliasMatch",
        dataset: dataset.value,
        aliasScheme: scheme,
        aliasValue: candidate
      });
    }
  }

  return [...matches.values()];
};

export const findDatasetMatchesForName = (
  datasetName: string,
  lookup: DataLayerRegistryLookup,
  options: {
    readonly preferredAgentIds?: ReadonlyArray<AgentId>;
  } = {}
): ReadonlyArray<DatasetNameMatch> => {
  const value = toNonEmpty(datasetName);
  if (value === null) {
    return [];
  }

  const exactMatches = dedupeDatasets(
    listDatasetTitleCandidates(value)
      .map((candidate) => lookup.findDatasetByTitle(candidate))
      .flatMap((match) => (Option.isSome(match) ? [match.value] : []))
  );
  if (exactMatches.length > 0) {
    return exactMatches.map((dataset) => ({
      _tag: "DatasetTitleExactMatch" as const,
      dataset
    }));
  }

  const fuzzyMatches = findFuzzyDatasetTitleMatches(
    value,
    lookup,
    options.preferredAgentIds ?? []
  );
  if (fuzzyMatches.length > 0) {
    return fuzzyMatches.map(({ dataset, score }) => ({
      _tag: "DatasetTitleFuzzyMatch" as const,
      dataset,
      score
    }));
  }

  return findDatasetAliasMatches(value, lookup);
};
