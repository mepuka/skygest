import type {
  DataRefResolutionEnrichment,
  DataRefResolutionEnrichmentV2
} from "../domain/enrichment";
import {
  isDataRefResolutionEnrichmentV2,
  isLegacyDataRefResolutionEnrichment
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

const makeUntimedCitation = (
  input: Pick<
    PreparedDataRefCandidateCitation,
    "entityId" | "citationSource" | "resolutionState" | "assertedUnit"
  >
): PreparedDataRefCandidateCitation => {
  const baseRow = {
    entityId: input.entityId,
    citationSource: input.citationSource,
    resolutionState: input.resolutionState,
    assertedValueJson: null,
    assertedUnit: input.assertedUnit,
    observationStart: null,
    observationEnd: null,
    observationLabel: null,
    normalizedObservationStart: "",
    normalizedObservationEnd: "",
    observationSortKey: "",
    hasObservationTime: false
  };

  return {
    ...baseRow,
    citationKey: toCitationKey(baseRow)
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getString = (
  value: Record<string, unknown>,
  key: string
): string | null => {
  const field = value[key];
  return typeof field === "string" ? field : null;
};

const getArray = (
  value: Record<string, unknown>,
  key: string
): ReadonlyArray<unknown> => {
  const field = value[key];
  return Array.isArray(field) ? field : [];
};

const observationWindowFromLegacyBundle = (bundle: unknown) => {
  const bundleRecord = isRecord(bundle) ? bundle : null;
  const temporalCoverage = isRecord(bundleRecord?.temporalCoverage)
    ? bundleRecord.temporalCoverage
    : null;
  const start = getString(temporalCoverage ?? {}, "startDate");
  const end = getString(temporalCoverage ?? {}, "endDate");
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

const assertedUnitForLegacyItem = (
  bundle: unknown,
  item: Record<string, unknown>
) => {
  const itemKey = getString(item, "itemKey");
  const bundleRecord = isRecord(bundle) ? bundle : null;
  const series = getArray(bundleRecord ?? {}, "series");

  if (itemKey !== null) {
    for (const seriesEntry of series) {
      if (!isRecord(seriesEntry) || getString(seriesEntry, "itemKey") !== itemKey) {
        continue;
      }

      const seriesUnit = getString(seriesEntry, "unit");
      if (seriesUnit !== null) {
        return seriesUnit;
      }
    }
  }

  const yAxis = isRecord(bundleRecord?.yAxis) ? bundleRecord.yAxis : null;
  return getString(yAxis ?? {}, "unit");
};

const makeLegacyCitation = (
  input: Pick<
    PreparedDataRefCandidateCitation,
    "entityId" | "citationSource" | "resolutionState" | "assertedUnit"
  > &
    ReturnType<typeof observationWindowFromLegacyBundle>
): PreparedDataRefCandidateCitation => {
  const baseRow = {
    entityId: input.entityId,
    citationSource: input.citationSource,
    resolutionState: input.resolutionState,
    assertedValueJson: null,
    assertedUnit: input.assertedUnit,
    observationStart: input.observationStart,
    observationEnd: input.observationEnd,
    observationLabel: input.observationLabel,
    normalizedObservationStart: input.normalizedObservationStart,
    normalizedObservationEnd: input.normalizedObservationEnd,
    observationSortKey: input.observationSortKey,
    hasObservationTime: input.hasObservationTime
  };

  return {
    ...baseRow,
    citationKey: toCitationKey(baseRow)
  };
};

const legacyKernelRowsForOutcome = (
  outcome: unknown
): ReadonlyArray<PreparedDataRefCandidateCitation> => {
  if (!isRecord(outcome)) {
    return [];
  }

  const tag = getString(outcome, "_tag");
  const bundle = outcome.bundle;
  const observation = observationWindowFromLegacyBundle(bundle);

  switch (tag) {
    case "Resolved":
      return [
        ...getArray(outcome, "items").flatMap((item) => {
          if (!isRecord(item) || getString(item, "_tag") !== "bound") {
            return [];
          }

          const variableId = getString(item, "variableId");
          if (variableId === null) {
            return [];
          }

          return [
            makeLegacyCitation({
              entityId: variableId as PreparedDataRefCandidateCitation["entityId"],
              citationSource: "kernel",
              resolutionState: "resolved",
              assertedUnit: assertedUnitForLegacyItem(bundle, item),
              ...observation
            })
          ];
        }),
        ...(() => {
          const agentId = getString(outcome, "agentId");
          if (agentId === null) {
            return [];
          }

          return [
            makeLegacyCitation({
              entityId: agentId as PreparedDataRefCandidateCitation["entityId"],
              citationSource: "kernel",
              resolutionState: "resolved",
              assertedUnit: null,
              ...observation
            })
          ];
        })()
      ];
    case "Ambiguous":
    case "OutOfRegistry":
      return getArray(outcome, "items").flatMap((item) => {
        if (!isRecord(item) || getString(item, "_tag") !== "bound") {
          return [];
        }

        const variableId = getString(item, "variableId");
        if (variableId === null) {
          return [];
        }

        return [
          makeLegacyCitation({
            entityId: variableId as PreparedDataRefCandidateCitation["entityId"],
            citationSource: "kernel",
            resolutionState: "partially_resolved",
            assertedUnit: assertedUnitForLegacyItem(bundle, item),
            ...observation
          })
        ];
      });
    default:
      return [];
  }
};

const resolutionRowsForBundle = (
  bundle: DataRefResolutionEnrichmentV2["resolution"][number]
): ReadonlyArray<PreparedDataRefCandidateCitation> => [
  ...bundle.resolution.agents.map((agent) =>
    makeUntimedCitation({
      entityId: agent.entityId,
      citationSource: "resolution",
      resolutionState: "resolved",
      assertedUnit: null
    })
  ),
  ...bundle.resolution.datasets.map((dataset) =>
    makeUntimedCitation({
      entityId: dataset.entityId,
      citationSource: "resolution",
      resolutionState: "resolved",
      assertedUnit: null
    })
  )
];

export const buildDataRefCandidateCitations = (
  enrichment: DataRefResolutionEnrichment
): ReadonlyArray<PreparedDataRefCandidateCitation> => {
  const citations = new Map<string, PreparedDataRefCandidateCitation>();
  const resolutionRows = isDataRefResolutionEnrichmentV2(enrichment)
    ? enrichment.resolution.flatMap(resolutionRowsForBundle)
    : [];
  const legacyKernelRows = isLegacyDataRefResolutionEnrichment(enrichment)
    ? enrichment.kernel.flatMap(legacyKernelRowsForOutcome)
    : [];
  const preferredRows = resolutionRows.length > 0 ? resolutionRows : legacyKernelRows;
  const resolvedEntityIds = new Set(preferredRows.map((row) => row.entityId));

  for (const row of preferredRows) {
    upsertCitation(citations, row.citationKey, row);
  }

  enrichment.stage1.matches.forEach((match) => {
    const entityId = stage1EntityId(match);
    if (resolvedEntityIds.has(entityId)) {
      return;
    }

    const row = makeUntimedCitation({
      entityId,
      citationSource: "stage1",
      resolutionState: stage1ResolutionState(match),
      assertedUnit: null
    });

    upsertCitation(citations, row.citationKey, row);
  });

  return [...citations.values()];
};
