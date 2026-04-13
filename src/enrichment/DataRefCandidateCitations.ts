import type {
  ResolutionOutcome,
  ResolutionEvidenceBundle,
  BoundResolutionBoundItem
} from "../domain/resolutionKernel";
import type {
  DataRefResolutionEnrichment
} from "../domain/enrichment";
import type { ResolutionState } from "../domain/data-layer/candidate";
import type { PreparedDataRefCandidateCitation } from "../domain/data-layer/query";

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

const toCitationKey = (
  row: Pick<
    PreparedDataRefCandidateCitation,
    | "citationSource"
    | "resolutionState"
    | "entityId"
    | "normalizedObservationStart"
    | "normalizedObservationEnd"
    | "observationLabel"
  >
) =>
  [
    row.citationSource,
    row.resolutionState,
    row.entityId,
    row.normalizedObservationStart,
    row.normalizedObservationEnd,
    row.observationLabel ?? ""
  ].join("\u0000");

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
    observationSortKey: end ?? start ?? "",
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
): PreparedDataRefCandidateCitation["entityId"] => {
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
): ResolutionState => {
  switch (match._tag) {
    case "VariableMatch":
      return "partially_resolved";
    case "AgentMatch":
    case "DatasetMatch":
    case "DistributionMatch":
      return "source_only";
  }
};

const assertedUnitForItem = (
  bundle: ResolutionEvidenceBundle,
  item: BoundResolutionBoundItem
) =>
  bundle.series.find((series) => series.itemKey === item.itemKey)?.unit ??
  bundle.yAxis?.unit ??
  null;

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
            : [(() => {
                const baseRow = {
                  entityId: item.variableId,
                  citationSource: "kernel" as const,
                  resolutionState: "resolved" as const,
                  assertedValueJson: null,
                  assertedUnit: assertedUnitForItem(outcome.bundle, item),
                  ...observation
                };

                return {
                  ...baseRow,
                  citationKey: toCitationKey(baseRow)
                };
              })()]
        ),
        ...(outcome.agentId === undefined
          ? []
          : [(() => {
              const baseRow = {
                entityId: outcome.agentId,
                citationSource: "kernel" as const,
                resolutionState: "resolved" as const,
                assertedValueJson: null,
                assertedUnit: null,
                ...observation
              };

              return {
                ...baseRow,
                citationKey: toCitationKey(baseRow)
              };
            })()])
      ];
    case "Ambiguous":
    case "OutOfRegistry":
      return outcome.items.flatMap((item) =>
        item._tag !== "bound"
          ? []
          : [(() => {
              const baseRow = {
                entityId: item.variableId,
                citationSource: "kernel" as const,
                resolutionState: "partially_resolved" as const,
                assertedValueJson: null,
                assertedUnit: assertedUnitForItem(outcome.bundle, item),
                ...observation
              };

              return {
                ...baseRow,
                citationKey: toCitationKey(baseRow)
              };
            })()]
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
    upsertCitation(citations, row.citationKey, row);
  }

  enrichment.stage1.matches.forEach((match) => {
    const entityId = stage1EntityId(match);
    if (kernelEntityIds.has(entityId)) {
      return;
    }

    const baseRow = {
      entityId,
      citationSource: "stage1" as const,
      resolutionState: stage1ResolutionState(match),
      assertedValueJson: null,
      assertedUnit: null,
      observationStart: null,
      observationEnd: null,
      observationLabel: null,
      normalizedObservationStart: "",
      normalizedObservationEnd: "",
      observationSortKey: "",
      hasObservationTime: false
    };

    upsertCitation(
      citations,
      toCitationKey(baseRow),
      {
        ...baseRow,
        citationKey: toCitationKey(baseRow)
      }
    );
  });

  return [...citations.values()];
};
