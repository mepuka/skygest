import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import type { DataRefResolutionEnrichment } from "../src/domain/enrichment";
import { DataRefResolutionEnrichment as DataRefResolutionEnrichmentSchema } from "../src/domain/enrichment";
import { chartAssetIdFromBluesky } from "../src/domain/data-layer/post-ids";
import type { PostUri } from "../src/domain/types";
import { buildDataRefCandidateCitations } from "../src/enrichment/DataRefCandidateCitations";
import { sampleDid } from "./support/runtime";

const decodeDataRefResolutionEnrichment = Schema.decodeUnknownSync(
  DataRefResolutionEnrichmentSchema
);

const postUri = `at://${sampleDid}/app.bsky.feed.post/data-ref-citation-test` as PostUri;
const assetKey = chartAssetIdFromBluesky(postUri, "bafkreidatarefcitationtest");
const agentId = "https://id.skygest.io/agent/ag_TESTDATAREFCIT01";
const datasetId = "https://id.skygest.io/dataset/ds_TESTDATAREFCIT01";
const distributionId = "https://id.skygest.io/distribution/dist_TESTDATAREFCIT01";
const variableId = "https://id.skygest.io/variable/var_TESTDATAREFCIT01";
const seriesId = "https://id.skygest.io/series/ser_TESTDATAREFCIT01";

const makeResolutionBundle = () => ({
  assetKey,
  resolution: {
    agents: [
      {
        entityId: agentId,
        signal: {
          kind: "source-attribution-provider-label",
          field: "sourceAttribution.provider.providerLabel",
          value: "Example Provider"
        },
        score: null,
        scoped: false,
        matchKind: "exact-hostname"
      }
    ],
    datasets: [
      {
        entityId: datasetId,
        signal: {
          kind: "source-line-dataset-name",
          field: "asset.analysis.sourceLines[].datasetName",
          value: "Example dataset"
        },
        score: 0.97,
        scoped: true,
        matchKind: "lexical"
      }
    ],
    series: [
      {
        entityId: seriesId,
        signal: {
          kind: "series-legend-label",
          field: "asset.analysis.series[].label",
          value: "Residential"
        },
        score: 0.88,
        scoped: true,
        matchKind: "lexical"
      }
    ],
    variables: [
      {
        entityId: variableId,
        signal: {
          kind: "chart-title",
          field: "asset.analysis.title",
          value: "Retail electricity price"
        },
        score: 0.93,
        scoped: true,
        matchKind: "semantic"
      }
    ],
    trail: []
  }
});

describe("buildDataRefCandidateCitations", () => {
  it("emits direct resolution rows and keeps unmatched Stage 1 rows", () => {
    const enrichment = decodeDataRefResolutionEnrichment({
      kind: "data-ref-resolution",
      stage1: {
        matches: [
          {
            _tag: "AgentMatch",
            agentId,
            name: "Example Provider",
            bestRank: 1,
            evidence: []
          },
          {
            _tag: "DatasetMatch",
            datasetId,
            title: "Example dataset",
            bestRank: 1,
            evidence: []
          },
          {
            _tag: "DistributionMatch",
            distributionId,
            title: "Example landing page",
            bestRank: 1,
            evidence: []
          },
          {
            _tag: "VariableMatch",
            variableId,
            label: "Retail electricity price",
            bestRank: 1,
            evidence: []
          }
        ],
        residuals: []
      },
      resolution: [makeResolutionBundle()],
      resolverVersion: "bundle-resolution@sky-367",
      processedAt: 1
    });

    const citations = buildDataRefCandidateCitations(enrichment);

    expect(citations).toEqual([
      {
        entityId: agentId,
        citationKey: `resolution\u0000resolved\u0000${agentId}\u0000\u0000\u0000`,
        citationSource: "resolution",
        resolutionState: "resolved",
        assertedValueJson: null,
        assertedUnit: null,
        observationStart: null,
        observationEnd: null,
        observationLabel: null,
        normalizedObservationStart: "",
        normalizedObservationEnd: "",
        observationSortKey: "",
        hasObservationTime: false
      },
      {
        entityId: datasetId,
        citationKey: `resolution\u0000resolved\u0000${datasetId}\u0000\u0000\u0000`,
        citationSource: "resolution",
        resolutionState: "resolved",
        assertedValueJson: null,
        assertedUnit: null,
        observationStart: null,
        observationEnd: null,
        observationLabel: null,
        normalizedObservationStart: "",
        normalizedObservationEnd: "",
        observationSortKey: "",
        hasObservationTime: false
      },
      {
        entityId: distributionId,
        citationKey: `stage1\u0000source_only\u0000${distributionId}\u0000\u0000\u0000`,
        citationSource: "stage1",
        resolutionState: "source_only",
        assertedValueJson: null,
        assertedUnit: null,
        observationStart: null,
        observationEnd: null,
        observationLabel: null,
        normalizedObservationStart: "",
        normalizedObservationEnd: "",
        observationSortKey: "",
        hasObservationTime: false
      },
      {
        entityId: variableId,
        citationKey: `stage1\u0000partially_resolved\u0000${variableId}\u0000\u0000\u0000`,
        citationSource: "stage1",
        resolutionState: "partially_resolved",
        assertedValueJson: null,
        assertedUnit: null,
        observationStart: null,
        observationEnd: null,
        observationLabel: null,
        normalizedObservationStart: "",
        normalizedObservationEnd: "",
        observationSortKey: "",
        hasObservationTime: false
      }
    ]);
  });

  it("emits legacy kernel citations with observation windows and asserted units", () => {
    const enrichment = decodeDataRefResolutionEnrichment({
      kind: "data-ref-resolution",
      stage1: {
        matches: [
          {
            _tag: "DatasetMatch",
            datasetId,
            title: "Example dataset",
            bestRank: 1,
            evidence: []
          }
        ],
        residuals: []
      },
      kernel: [
        {
          _tag: "Resolved",
          bundle: {
            temporalCoverage: {
              startDate: "2024-01",
              endDate: "2024-03"
            },
            yAxis: {
              unit: "MW"
            },
            series: [
              {
                itemKey: "series-1",
                unit: "GW"
              }
            ]
          },
          items: [
            {
              _tag: "bound",
              variableId,
              itemKey: "series-1"
            }
          ],
          agentId
        }
      ],
      resolverVersion: "resolution-kernel@sky-314",
      processedAt: 1
    });

    const citations = buildDataRefCandidateCitations(enrichment);

    expect(citations).toEqual([
      {
        entityId: variableId,
        citationKey:
          `kernel\u0000resolved\u0000${variableId}\u00002024-01\u00002024-03\u0000`,
        citationSource: "kernel",
        resolutionState: "resolved",
        assertedValueJson: null,
        assertedUnit: "GW",
        observationStart: "2024-01",
        observationEnd: "2024-03",
        observationLabel: null,
        normalizedObservationStart: "2024-01",
        normalizedObservationEnd: "2024-03",
        observationSortKey: "2024-03",
        hasObservationTime: true
      },
      {
        entityId: agentId,
        citationKey:
          `kernel\u0000resolved\u0000${agentId}\u00002024-01\u00002024-03\u0000`,
        citationSource: "kernel",
        resolutionState: "resolved",
        assertedValueJson: null,
        assertedUnit: null,
        observationStart: "2024-01",
        observationEnd: "2024-03",
        observationLabel: null,
        normalizedObservationStart: "2024-01",
        normalizedObservationEnd: "2024-03",
        observationSortKey: "2024-03",
        hasObservationTime: true
      },
      {
        entityId: datasetId,
        citationKey: `stage1\u0000source_only\u0000${datasetId}\u0000\u0000\u0000`,
        citationSource: "stage1",
        resolutionState: "source_only",
        assertedValueJson: null,
        assertedUnit: null,
        observationStart: null,
        observationEnd: null,
        observationLabel: null,
        normalizedObservationStart: "",
        normalizedObservationEnd: "",
        observationSortKey: "",
        hasObservationTime: false
      }
    ]);
  });

  it("prefers v2 resolution rows when both resolution and kernel fields are present", () => {
    const hybrid = {
      kind: "data-ref-resolution",
      stage1: {
        matches: [],
        residuals: []
      },
      resolution: [makeResolutionBundle()],
      kernel: [
        {
          _tag: "Resolved",
          bundle: {},
          items: [
            {
              _tag: "bound",
              variableId,
              itemKey: "series-1"
            }
          ]
        }
      ],
      resolverVersion: "bundle-resolution@sky-367",
      processedAt: 1
    } as unknown as DataRefResolutionEnrichment;

    const citations = buildDataRefCandidateCitations(hybrid);

    expect(citations.map((citation) => citation.citationSource)).toEqual([
      "resolution",
      "resolution"
    ]);
    expect(citations.map((citation) => citation.entityId)).toEqual([
      agentId,
      datasetId
    ]);
  });
});
