import type {
  ResolutionOutcome,
  ResolutionEvidenceBundle
} from "../domain/resolutionKernel";
import type {
  DataRefResolutionEnrichment
} from "../domain/enrichment";
import type { ResolutionState } from "../domain/data-layer/candidate";

export type PreparedDataRefCandidateCitation = {
  readonly entityId: string;
  readonly resolutionState: ResolutionState;
  readonly assertedValueJson: string | null;
  readonly assertedUnit: string | null;
  readonly observationStart: string | null;
  readonly observationEnd: string | null;
  readonly observationLabel: string | null;
  readonly normalizedObservationStart: string;
  readonly normalizedObservationEnd: string;
  readonly hasObservationTime: boolean;
};

const resolutionStatePriority = (
  value: ResolutionState
): number => {
  switch (value) {
    case "source_only":
      return 0;
    case "partially_resolved":
      return 1;
    case "resolved":
      return 2;
  }
};

const observationWindowFromBundle = (bundle: ResolutionEvidenceBundle) => {
  const start = bundle.temporalCoverage?.startDate ?? null;
  const end = bundle.temporalCoverage?.endDate ?? null;
  const hasObservationTime = start !== null || end !== null;

  return {
    observationStart: start,
    observationEnd: end,
    observationLabel: null,
    normalizedObservationStart: start ?? end ?? "",
    normalizedObservationEnd: end ?? start ?? "",
    hasObservationTime
  };
};

const upsertCitation = (
  citations: Map<string, PreparedDataRefCandidateCitation>,
  key: string,
  value: PreparedDataRefCandidateCitation
) => {
  const existing = citations.get(key);
  if (existing === undefined) {
    citations.set(key, value);
    return;
  }

  const existingPriority = resolutionStatePriority(existing.resolutionState);
  const nextPriority = resolutionStatePriority(value.resolutionState);

  if (nextPriority > existingPriority) {
    citations.set(key, value);
    return;
  }

  if (
    nextPriority === existingPriority &&
    value.hasObservationTime &&
    !existing.hasObservationTime
  ) {
    citations.set(key, value);
  }
};

const stage1EntityId = (
  match: DataRefResolutionEnrichment["stage1"]["matches"][number]
) => {
  switch (match._tag) {
    case "AgentMatch":
      return match.agentId;
    case "DatasetMatch":
      return match.datasetId;
    case "DistributionMatch":
      return match.distributionId;
    case "VariableMatch":
      return match.variableId;
  }
};

const stage1ResolutionState = (
  match: DataRefResolutionEnrichment["stage1"]["matches"][number]
): ResolutionState =>
  match._tag === "VariableMatch"
    ? "partially_resolved"
    : "source_only";

const kernelRowsForOutcome = (
  outcome: ResolutionOutcome
): ReadonlyArray<PreparedDataRefCandidateCitation> => {
  const observation = observationWindowFromBundle(outcome.bundle);

  switch (outcome._tag) {
    case "Resolved":
      return [
        ...outcome.items.flatMap((item) =>
          item._tag !== "bound"
            ? []
            : [{
                entityId: item.variableId,
                resolutionState: "resolved" as const,
                assertedValueJson: null,
                assertedUnit: outcome.bundle.yAxis?.unit ?? null,
                ...observation
              }]
        ),
        ...(outcome.agentId === undefined
          ? []
          : [{
              entityId: outcome.agentId,
              resolutionState: "resolved" as const,
              assertedValueJson: null,
              assertedUnit: null,
              ...observation
            }])
      ];
    case "Ambiguous":
    case "OutOfRegistry":
      return outcome.items.flatMap((item) =>
        item._tag !== "bound"
          ? []
          : [{
              entityId: item.variableId,
              resolutionState: "partially_resolved" as const,
              assertedValueJson: null,
              assertedUnit: outcome.bundle.yAxis?.unit ?? null,
              ...observation
            }]
      );
    case "Underspecified":
    case "Conflicted":
    case "NoMatch":
      return [];
  }
};

export const buildDataRefCandidateCitations = (
  enrichment: DataRefResolutionEnrichment
): ReadonlyArray<PreparedDataRefCandidateCitation> => {
  const citations = new Map<string, PreparedDataRefCandidateCitation>();
  const kernelRows = enrichment.kernel.flatMap(kernelRowsForOutcome);
  const kernelEntityIds = new Set(kernelRows.map((row) => row.entityId));

  for (const row of kernelRows) {
    const key = [
      row.entityId,
      row.normalizedObservationStart,
      row.normalizedObservationEnd,
      row.observationLabel ?? ""
    ].join("\u0000");
    upsertCitation(citations, key, row);
  }

  enrichment.stage1.matches.forEach((match, index) => {
    const entityId = stage1EntityId(match);
    if (kernelEntityIds.has(entityId)) {
      return;
    }

    upsertCitation(
      citations,
      `stage1\u0000${entityId}\u0000${index}`,
      {
        entityId,
        resolutionState: stage1ResolutionState(match),
        assertedValueJson: null,
        assertedUnit: null,
        observationStart: null,
        observationEnd: null,
        observationLabel: null,
        normalizedObservationStart: "",
        normalizedObservationEnd: "",
        hasObservationTime: false
      }
    );
  });

  return [...citations.values()];
};
