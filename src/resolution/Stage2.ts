import { Match, Option } from "effect";
import type { Agent, Dataset, Variable } from "../domain/data-layer";
import type { SurfaceFormEntryAny } from "../domain/surfaceForm";
import type {
  Stage1Match,
  Stage1PostContext,
  Stage1Result,
  Stage1Residual,
  AmbiguousCandidatesResidual,
  DeferredToStage2Residual,
  UnmatchedDatasetTitleResidual,
  UnmatchedTextResidual,
  UnmatchedUrlResidual
} from "../domain/stage1Resolution";
import type {
  CandidateEntry,
  Stage2PartialVariableShape,
  Stage2Corroboration,
  Stage2Result,
  Stage3Input
} from "../domain/stage2Resolution";
import type { Stage1MatchGrain } from "../domain/stage1Shared";
import type { DataLayerRegistryLookup } from "./dataLayerRegistry";
import type { FacetVocabularyShape } from "./facetVocabulary";
import {
  FUZZY_CANDIDATE_THRESHOLD,
  FUZZY_CONFIDENT_THRESHOLD,
  jaccardTokenSet
} from "./fuzzyMatch";
import { normalizeLookupText } from "./normalize";

type Stage2State = {
  readonly stage1MatchKeys: Set<string>;
  readonly matches: Map<string, Stage1Match>;
  readonly corroborations: Map<string, Stage2Corroboration>;
  readonly escalations: Array<Stage3Input>;
};

type FacetField =
  | "statisticType"
  | "aggregation"
  | "unitFamily"
  | "technologyOrFuel"
  | "measuredProperty"
  | "domainObject";

type ScoredVariableCandidate = {
  readonly variable: Variable;
  readonly matchedFacets: ReadonlyArray<FacetField>;
  readonly score: number;
};

type FuzzyCandidate<T extends Agent | Dataset> = {
  readonly entity: T;
  readonly label: string;
  readonly score: number;
};

type ResolvedMatchEntity = Agent | Dataset | Variable;

// This feeds unmatched-surface-form breadcrumbs, so punctuation and symbols
// should break into separate alphanumeric fragments. Fuzzy scoring keeps a
// different tokenizer in `fuzzyMatch.ts` because it compares word bags.
const tokenizeForUnmatched = (value: string) =>
  normalizeLookupText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

const uniqueStrings = (values: ReadonlyArray<string>) => [...new Set(values)];

const matchKey = (grain: Stage1MatchGrain, entityId: string) =>
  `${grain}\u0000${entityId}`;

const matchKeyFromStage1Match = (
  match: Stage1Match
): {
  readonly grain: Stage1MatchGrain;
  readonly entityId: string;
} => {
  switch (match._tag) {
    case "DistributionMatch":
      return {
        grain: "Distribution",
        entityId: match.distributionId
      };
    case "DatasetMatch":
      return {
        grain: "Dataset",
        entityId: match.datasetId
      };
    case "AgentMatch":
      return {
        grain: "Agent",
        entityId: match.agentId
      };
    case "VariableMatch":
      return {
        grain: "Variable",
        entityId: match.variableId
      };
  }
};

const matchKeyForEntity = (
  entity: ResolvedMatchEntity
): {
  readonly grain: Stage1MatchGrain;
  readonly entityId: Stage2Corroboration["matchKey"]["entityId"];
} => {
  switch (entity._tag) {
    case "Agent":
      return { grain: "Agent", entityId: entity.id };
    case "Dataset":
      return { grain: "Dataset", entityId: entity.id };
    case "Variable":
      return { grain: "Variable", entityId: entity.id };
  }
};

const emptyState = (stage1: Stage1Result): Stage2State => ({
  stage1MatchKeys: new Set(
    stage1.matches.map((match) => {
      const key = matchKeyFromStage1Match(match);
      return matchKey(key.grain, key.entityId);
    })
  ),
  matches: new Map<string, Stage1Match>(),
  corroborations: new Map<string, Stage2Corroboration>(),
  escalations: []
});

const appendCorroboration = (
  state: Stage2State,
  grain: Stage1MatchGrain,
  entityId: Stage2Corroboration["matchKey"]["entityId"],
  evidence: Stage2Corroboration["evidence"][number]
) => {
  const key = matchKey(grain, entityId);
  const existing = state.corroborations.get(key);

  if (existing === undefined) {
    state.corroborations.set(key, {
      matchKey: {
        grain,
        entityId
      },
      evidence: [evidence]
    });
    return;
  }

  state.corroborations.set(key, {
    matchKey: existing.matchKey,
    evidence: [...existing.evidence, evidence]
  });
};

const buildMatchForEntity = (
  entity: ResolvedMatchEntity,
  evidence: Stage2Corroboration["evidence"][number]
): Stage1Match => {
  switch (entity._tag) {
    case "Agent":
      return {
        _tag: "AgentMatch",
        agentId: entity.id,
        name: entity.name,
        bestRank: evidence.rank,
        evidence: [evidence]
      };
    case "Dataset":
      return {
        _tag: "DatasetMatch",
        datasetId: entity.id,
        title: entity.title,
        bestRank: evidence.rank,
        evidence: [evidence]
      };
    case "Variable":
      return {
        _tag: "VariableMatch",
        variableId: entity.id,
        label: entity.label,
        bestRank: evidence.rank,
        evidence: [evidence]
      };
  }
};

const appendResolvedMatch = (
  state: Stage2State,
  entity: ResolvedMatchEntity,
  evidence: Stage2Corroboration["evidence"][number]
) => {
  const keyParts = matchKeyForEntity(entity);
  const key = matchKey(keyParts.grain, keyParts.entityId);

  if (state.stage1MatchKeys.has(key)) {
    appendCorroboration(state, keyParts.grain, keyParts.entityId, evidence);
    return;
  }

  const existing = state.matches.get(key);
  if (existing === undefined) {
    state.matches.set(key, buildMatchForEntity(entity, evidence));
    return;
  }

  state.matches.set(key, {
    ...existing,
    bestRank: Math.min(existing.bestRank, evidence.rank),
    evidence: [...existing.evidence, evidence]
  });
};

const appendEscalation = (state: Stage2State, escalation: Stage3Input) => {
  state.escalations.push(escalation);
};

const hasPartialDecomposition = (partial: Stage2PartialVariableShape) =>
  Object.keys(partial).length > 0;

const deriveUnmatchedSurfaceForms = (
  text: string,
  matchedSurfaceForms: ReadonlyArray<SurfaceFormEntryAny>
) => {
  const matchedTokens = new Set(
    matchedSurfaceForms.flatMap((entry) =>
      tokenizeForUnmatched(entry.normalizedSurfaceForm)
    )
  );

  return uniqueStrings(
    tokenizeForUnmatched(text).filter((token) => !matchedTokens.has(token))
  );
};

const scoreVariableCandidate = (
  partial: Stage2PartialVariableShape,
  variable: Variable
): ScoredVariableCandidate => {
  const matchedFacets: Array<FacetField> = [];

  if (
    partial.statisticType !== undefined &&
    variable.statisticType === partial.statisticType
  ) {
    matchedFacets.push("statisticType");
  }

  if (
    partial.aggregation !== undefined &&
    variable.aggregation === partial.aggregation
  ) {
    matchedFacets.push("aggregation");
  }

  if (
    partial.unitFamily !== undefined &&
    variable.unitFamily === partial.unitFamily
  ) {
    matchedFacets.push("unitFamily");
  }

  if (
    partial.technologyOrFuel !== undefined &&
    variable.technologyOrFuel === partial.technologyOrFuel
  ) {
    matchedFacets.push("technologyOrFuel");
  }

  if (
    partial.measuredProperty !== undefined &&
    variable.measuredProperty === partial.measuredProperty
  ) {
    matchedFacets.push("measuredProperty");
  }

  if (
    partial.domainObject !== undefined &&
    variable.domainObject === partial.domainObject
  ) {
    matchedFacets.push("domainObject");
  }

  return {
    variable,
    matchedFacets,
    score: matchedFacets.length
  };
};

const toVariableCandidateEntry = (
  candidate: ScoredVariableCandidate,
  rank: number
): CandidateEntry => ({
  entityId: candidate.variable.id,
  label: candidate.variable.label,
  grain: "Variable",
  matchedFacets: [...candidate.matchedFacets],
  rank
});

const toEntityCandidateEntry = <T extends Agent | Dataset>(
  grain: Stage1MatchGrain,
  entity: T,
  rank: number
): CandidateEntry => ({
  entityId: entity.id,
  label: entity._tag === "Agent" ? entity.name : entity.title,
  grain,
  matchedFacets: [],
  rank
});

const formatScore = (score: number) => score.toFixed(2);

const bestThresholdForScore = (score: number) =>
  score >= FUZZY_CONFIDENT_THRESHOLD
    ? FUZZY_CONFIDENT_THRESHOLD
    : FUZZY_CANDIDATE_THRESHOLD;

const topFuzzyCandidates = <T extends Agent | Dataset>(
  entities: ReadonlyArray<T>,
  labelsForEntity: (entity: T) => ReadonlyArray<string>,
  text: string
): ReadonlyArray<FuzzyCandidate<T>> => {
  const scored = entities.flatMap((entity) => {
    let bestLabel = "";
    let bestScore = 0;

    for (const label of labelsForEntity(entity)) {
      const score = jaccardTokenSet(text, label);
      if (score > bestScore) {
        bestScore = score;
        bestLabel = label;
      }
    }

    return bestScore > 0
      ? [
          {
            entity,
            label: bestLabel,
            score: bestScore
          }
        ]
      : [];
  });

  if (scored.length === 0) {
    return [];
  }

  const bestScore = Math.max(...scored.map((candidate) => candidate.score));
  return scored
    .filter((candidate) => candidate.score === bestScore)
    .sort((left, right) =>
      left.entity._tag === "Agent" && right.entity._tag === "Agent"
        ? left.entity.name.localeCompare(right.entity.name) ||
          left.entity.id.localeCompare(right.entity.id)
        : left.entity._tag === "Dataset" && right.entity._tag === "Dataset"
          ? left.entity.title.localeCompare(right.entity.title) ||
            left.entity.id.localeCompare(right.entity.id)
          : left.entity.id.localeCompare(right.entity.id)
    );
};

const buildFacetDecompositionEscalation = (
  postContext: Stage1PostContext,
  originalResidual: DeferredToStage2Residual,
  partial: Stage2PartialVariableShape | undefined,
  candidateSet: ReadonlyArray<CandidateEntry>,
  matchedSurfaceForms: ReadonlyArray<SurfaceFormEntryAny>,
  unmatchedSurfaceForms: ReadonlyArray<string>,
  reason: string
): Stage3Input => {
  return {
    _tag: "Stage3Input",
    postUri: postContext.postUri,
    originalResidual,
    stage2Lane: "facet-decomposition",
    candidateSet: [...candidateSet],
    matchedSurfaceForms: [...matchedSurfaceForms],
    unmatchedSurfaceForms: [...unmatchedSurfaceForms],
    reason,
    ...(partial === undefined ? {} : { partialDecomposition: partial })
  };
};

const handleFacetDecomposition = (
  state: Stage2State,
  postContext: Stage1PostContext,
  residual: DeferredToStage2Residual,
  lookup: DataLayerRegistryLookup,
  vocabulary: FacetVocabularyShape
) => {
  const partialDraft: {
    statisticType?: Stage2PartialVariableShape["statisticType"];
    aggregation?: Stage2PartialVariableShape["aggregation"];
    unitFamily?: Stage2PartialVariableShape["unitFamily"];
    technologyOrFuel?: Stage2PartialVariableShape["technologyOrFuel"];
    measuredProperty?: Stage2PartialVariableShape["measuredProperty"];
    domainObject?: Stage2PartialVariableShape["domainObject"];
  } = {};
  const matchedEntriesByFacet: Partial<Record<FacetField, SurfaceFormEntryAny>> =
    {};

  const statisticType = vocabulary.matchStatisticType(residual.text);
  const aggregation = vocabulary.matchAggregation(residual.text);
  const unitFamily = vocabulary.matchUnitFamily(residual.text);
  const technologyOrFuel = vocabulary.matchTechnologyOrFuel(residual.text);
  const measuredProperty = vocabulary.matchMeasuredProperty(residual.text);
  const domainObject = vocabulary.matchDomainObject(residual.text);

  if (Option.isSome(statisticType)) {
    partialDraft.statisticType = statisticType.value.canonical;
    matchedEntriesByFacet.statisticType = statisticType.value;
  }

  if (Option.isSome(aggregation)) {
    partialDraft.aggregation = aggregation.value.canonical;
    matchedEntriesByFacet.aggregation = aggregation.value;
  }

  if (Option.isSome(unitFamily)) {
    partialDraft.unitFamily = unitFamily.value.canonical;
    matchedEntriesByFacet.unitFamily = unitFamily.value;
  }

  if (Option.isSome(technologyOrFuel)) {
    partialDraft.technologyOrFuel = technologyOrFuel.value.canonical;
    matchedEntriesByFacet.technologyOrFuel = technologyOrFuel.value;
  }

  if (Option.isSome(measuredProperty)) {
    partialDraft.measuredProperty = measuredProperty.value.canonical;
    matchedEntriesByFacet.measuredProperty = measuredProperty.value;
  }

  if (Option.isSome(domainObject)) {
    partialDraft.domainObject = domainObject.value.canonical;
    matchedEntriesByFacet.domainObject = domainObject.value;
  }

  const partial = partialDraft as Stage2PartialVariableShape;

  const allMatchedEntries = [
    matchedEntriesByFacet.statisticType,
    matchedEntriesByFacet.aggregation,
    matchedEntriesByFacet.unitFamily,
    matchedEntriesByFacet.technologyOrFuel,
    matchedEntriesByFacet.measuredProperty,
    matchedEntriesByFacet.domainObject
  ];

  const matchedSurfaceForms = uniqueStrings(
    allMatchedEntries
      .filter((entry): entry is SurfaceFormEntryAny => entry !== undefined)
      .map((entry) => entry.normalizedSurfaceForm)
  ).map(
    (normalizedSurfaceForm) =>
      allMatchedEntries.find(
        (entry): entry is SurfaceFormEntryAny =>
          entry !== undefined &&
          entry.normalizedSurfaceForm === normalizedSurfaceForm
      )!
  );

  const unmatchedSurfaceForms = deriveUnmatchedSurfaceForms(
    residual.text,
    matchedSurfaceForms
  );

  if (matchedSurfaceForms.length === 0) {
    appendEscalation(
      state,
      buildFacetDecompositionEscalation(
        postContext,
        residual,
        undefined,
        [],
        [],
        unmatchedSurfaceForms,
        "facet vocabulary recognized no fields in text"
      )
    );
    return;
  }

  const candidates = [...lookup.entities]
    .filter((entity): entity is Variable => entity._tag === "Variable")
    .map((variable) => scoreVariableCandidate(partial, variable))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.variable.label.localeCompare(right.variable.label) ||
        left.variable.id.localeCompare(right.variable.id)
    );

  if (candidates.length === 0) {
    appendEscalation(
      state,
      buildFacetDecompositionEscalation(
        postContext,
        residual,
        hasPartialDecomposition(partial) ? partial : undefined,
        [],
        matchedSurfaceForms,
        unmatchedSurfaceForms,
        "no variable candidates matched the decoded facets"
      )
    );
    return;
  }

  const topScore = candidates[0]!.score;
  const topCandidates = candidates.filter((candidate) => candidate.score === topScore);

  if (topCandidates.length > 1) {
    appendEscalation(
      state,
      buildFacetDecompositionEscalation(
        postContext,
        residual,
        partial,
        topCandidates.map((candidate) => toVariableCandidateEntry(candidate, 1)),
        matchedSurfaceForms,
        unmatchedSurfaceForms,
        `${topCandidates.length} candidates tied on ${topScore} matched facets`
      )
    );
    return;
  }

  const winner = topCandidates[0]!;
  const evidence = {
    _tag: "FacetDecompositionEvidence" as const,
    signal: "facet-decomposition" as const,
    rank: 1 as const,
    matchedFacets: [...winner.matchedFacets],
    partialShape: partial,
    matchedSurfaceForms: winner.matchedFacets
      .map((facet) => matchedEntriesByFacet[facet])
      .filter((entry): entry is SurfaceFormEntryAny => entry !== undefined)
  };

  appendResolvedMatch(state, winner.variable, evidence);
};

const handleDatasetTitleResidual = (
  state: Stage2State,
  postContext: Stage1PostContext,
  residual: UnmatchedDatasetTitleResidual,
  lookup: DataLayerRegistryLookup
) => {
  const candidates = topFuzzyCandidates(
    [...lookup.entities].filter((entity): entity is Dataset => entity._tag === "Dataset"),
    (dataset) => [dataset.title, ...(dataset.aliases ?? []).map((alias) => alias.value)],
    residual.datasetName
  );

  if (
    candidates.length === 0 ||
    candidates[0]!.score < FUZZY_CANDIDATE_THRESHOLD
  ) {
    appendEscalation(state, {
      _tag: "Stage3Input",
      postUri: postContext.postUri,
      originalResidual: residual,
      stage2Lane: "fuzzy-dataset-title",
      candidateSet: [],
      matchedSurfaceForms: [],
      unmatchedSurfaceForms: [normalizeLookupText(residual.datasetName)],
      reason:
        candidates.length === 0
          ? "no dataset candidates available for fuzzy matching"
          : `best fuzzy score ${formatScore(candidates[0]!.score)} below ${formatScore(FUZZY_CANDIDATE_THRESHOLD)} threshold`
    });
    return;
  }

  if (candidates.length > 1) {
    appendEscalation(state, {
      _tag: "Stage3Input",
      postUri: postContext.postUri,
      originalResidual: residual,
      stage2Lane: "fuzzy-dataset-title",
      candidateSet: candidates.map((candidate) =>
        toEntityCandidateEntry("Dataset", candidate.entity, 1)
      ),
      matchedSurfaceForms: [],
      unmatchedSurfaceForms: [normalizeLookupText(residual.datasetName)],
      reason: `${candidates.length} dataset candidates tied at fuzzy score ${formatScore(candidates[0]!.score)}`
    });
    return;
  }

  const winner = candidates[0]!;
  appendResolvedMatch(state, winner.entity, {
    _tag: "FuzzyDatasetTitleEvidence",
    signal: "fuzzy-dataset-title",
    rank: 1,
    candidateTitle: winner.entity.title,
    score: winner.score,
    threshold: bestThresholdForScore(winner.score)
  });
};

const handleAgentLabelResidual = (
  state: Stage2State,
  postContext: Stage1PostContext,
  residual: UnmatchedTextResidual,
  lookup: DataLayerRegistryLookup
) => {
  // `UnmatchedTextResidual` covers several free-text sources, but in this
  // slice only agent-name lookup has a safe deterministic Stage 2 action.
  // Other free-text classes stay generic and continue to Stage 3 untouched.
  const candidates = topFuzzyCandidates(
    [...lookup.entities].filter((entity): entity is Agent => entity._tag === "Agent"),
    (agent) => [agent.name, ...(agent.alternateNames ?? [])],
    residual.text
  );

  if (
    candidates.length === 0 ||
    candidates[0]!.score < FUZZY_CANDIDATE_THRESHOLD
  ) {
    appendEscalation(state, {
      _tag: "Stage3Input",
      postUri: postContext.postUri,
      originalResidual: residual,
      stage2Lane: "fuzzy-agent-label",
      candidateSet: [],
      matchedSurfaceForms: [],
      unmatchedSurfaceForms: [normalizeLookupText(residual.text)],
      reason:
        candidates.length === 0
          ? "no agent candidates available for fuzzy matching"
          : `best fuzzy score ${formatScore(candidates[0]!.score)} below ${formatScore(FUZZY_CANDIDATE_THRESHOLD)} threshold`
    });
    return;
  }

  if (candidates.length > 1) {
    appendEscalation(state, {
      _tag: "Stage3Input",
      postUri: postContext.postUri,
      originalResidual: residual,
      stage2Lane: "fuzzy-agent-label",
      candidateSet: candidates.map((candidate) =>
        toEntityCandidateEntry("Agent", candidate.entity, 1)
      ),
      matchedSurfaceForms: [],
      unmatchedSurfaceForms: [normalizeLookupText(residual.text)],
      reason: `${candidates.length} agent candidates tied at fuzzy score ${formatScore(candidates[0]!.score)}`
    });
    return;
  }

  const winner = candidates[0]!;
  appendResolvedMatch(state, winner.entity, {
    _tag: "FuzzyAgentLabelEvidence",
    signal: "fuzzy-agent-label",
    rank: 1,
    candidateLabel: winner.label,
    score: winner.score,
    threshold: bestThresholdForScore(winner.score)
  });
};

const handleTieBreakerResidual = (
  state: Stage2State,
  postContext: Stage1PostContext,
  residual: AmbiguousCandidatesResidual
) => {
  appendEscalation(state, {
    _tag: "Stage3Input",
    postUri: postContext.postUri,
    originalResidual: residual,
    stage2Lane: "tie-breaker",
    candidateSet: residual.candidates.map((candidate) => ({
      entityId: candidate.entityId,
      label: candidate.label,
      grain: residual.grain,
      matchedFacets: [],
      rank: residual.bestRank
    })),
    matchedSurfaceForms: [],
    unmatchedSurfaceForms: [],
    reason: `${residual.candidates.length} candidates tied at rank ${residual.bestRank}`
  });
};

const handleUnmatchedUrlResidual = (
  state: Stage2State,
  postContext: Stage1PostContext,
  residual: UnmatchedUrlResidual
) => {
  appendEscalation(state, {
    _tag: "Stage3Input",
    postUri: postContext.postUri,
    originalResidual: residual,
    stage2Lane: "no-op",
    candidateSet: [],
    matchedSurfaceForms: [],
    unmatchedSurfaceForms: [],
    reason: "stage 2 has no action for unmatched URLs"
  });
};

export const runStage2 = (
  postContext: Stage1PostContext,
  stage1: Stage1Result,
  lookup: DataLayerRegistryLookup,
  vocabulary: FacetVocabularyShape
): Stage2Result => {
  const state = emptyState(stage1);

  for (const residual of stage1.residuals) {
    Match.valueTags(residual, {
      DeferredToStage2Residual: (value) =>
        handleFacetDecomposition(state, postContext, value, lookup, vocabulary),
      UnmatchedDatasetTitleResidual: (value) =>
        handleDatasetTitleResidual(state, postContext, value, lookup),
      UnmatchedTextResidual: (value) =>
        handleAgentLabelResidual(state, postContext, value, lookup),
      AmbiguousCandidatesResidual: (value) =>
        handleTieBreakerResidual(state, postContext, value),
      UnmatchedUrlResidual: (value) =>
        handleUnmatchedUrlResidual(state, postContext, value)
    });
  }

  return {
    matches: [...state.matches.values()],
    corroborations: [...state.corroborations.values()],
    escalations: [...state.escalations]
  };
};
