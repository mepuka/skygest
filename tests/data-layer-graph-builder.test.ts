import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  Agent,
  Dataset,
  Series,
  Variable,
  makeAgentId,
  makeDatasetId,
  makeSeriesId,
  makeVariableId,
} from "../src/domain/data-layer";
import { buildDataLayerGraph } from "../src/data-layer/DataLayerGraph";

const decodeAgent = Schema.decodeUnknownSync(Agent);
const decodeDataset = Schema.decodeUnknownSync(Dataset);
const decodeSeries = Schema.decodeUnknownSync(Series);
const decodeVariable = Schema.decodeUnknownSync(Variable);

const iso = "2026-04-09T00:00:00.000Z";
const agentId = makeAgentId("https://id.skygest.io/agent/ag_1234567890AB");
const datasetId = makeDatasetId("https://id.skygest.io/dataset/ds_1234567890AB");
const variableId = makeVariableId(
  "https://id.skygest.io/variable/var_1234567890AB",
);
const seriesId = makeSeriesId("https://id.skygest.io/series/ser_1234567890AB");

const makeAgent = () =>
  decodeAgent({
    _tag: "Agent",
    id: agentId,
    kind: "organization",
    name: "Energy Information Administration",
    alternateNames: ["EIA"],
    homepage: "https://www.eia.gov",
    aliases: [],
    createdAt: iso,
    updatedAt: iso,
  });

const makeDataset = (
  overrides: Partial<Schema.Schema.Type<typeof Dataset>> = {},
) =>
  decodeDataset({
    _tag: "Dataset",
    id: datasetId,
    title: "EIA Emissions Data",
    aliases: [],
    createdAt: iso,
    updatedAt: iso,
    ...overrides,
  });

const makeVariable = () =>
  decodeVariable({
    _tag: "Variable",
    id: variableId,
    label: "Net generation",
    aliases: [],
    createdAt: iso,
    updatedAt: iso,
  });

const makeSeries = (
  overrides: Partial<Schema.Schema.Type<typeof Series>> = {},
) =>
  decodeSeries({
    _tag: "Series",
    id: seriesId,
    label: "Net generation (annual)",
    variableId,
    fixedDims: {},
    aliases: [],
    createdAt: iso,
    updatedAt: iso,
    ...overrides,
  });

const expectFailure = <A, E>(result: Result.Result<A, E>): E => {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isSuccess(result)) {
    throw new Error("expected graph build failure");
  }

  return result.failure;
};

describe("buildDataLayerGraph", () => {
  it("reports duplicate node keys directly", () => {
    const failure = expectFailure(buildDataLayerGraph([makeAgent(), makeAgent()]));

    expect(failure).toContainEqual({
      _tag: "DataLayerGraphDuplicateNodeIssue",
      path: `Agent:${agentId}`,
      nodeKey: `Agent::${agentId}`,
      entityId: agentId,
      reason: "duplicate-node-key",
    });
  });

  it("reports missing referenced nodes directly", () => {
    const failure = expectFailure(
      buildDataLayerGraph([
        makeDataset({
          publisherAgentId: agentId,
        }),
      ]),
    );

    expect(failure).toContainEqual({
      _tag: "MissingReferenceIssue",
      path: `Dataset:${datasetId}`,
      field: "publisherAgentId",
      targetId: agentId,
      expectedTag: "Agent",
    });
  });

  it("reports wrong target kinds directly", () => {
    const malformedDataset = {
      _tag: "Dataset",
      id: datasetId,
      title: "EIA Emissions Data",
      publisherAgentId: variableId,
      aliases: [],
      createdAt: iso,
      updatedAt: iso,
    } as unknown as Schema.Schema.Type<typeof Dataset>;

    const failure = expectFailure(
      buildDataLayerGraph([
        malformedDataset,
        makeVariable(),
      ]),
    );

    expect(failure).toContainEqual({
      _tag: "DataLayerGraphUnexpectedTargetIssue",
      path: `Dataset:${datasetId}`,
      field: "publisherAgentId",
      targetId: variableId,
      expectedTags: ["Agent"],
      actualTag: "Variable",
    });
  });

  it("enforces the published-in-dataset functional edge for series", () => {
    const failure = expectFailure(
      buildDataLayerGraph([makeVariable(), makeSeries()]),
    );

    expect(failure).toContainEqual({
      _tag: "DataLayerGraphCardinalityIssue",
      path: `Series:${seriesId}`,
      edgeKind: "published-in-dataset",
      expectedCount: 1,
      actualCount: 0,
    });
  });

  it("enforces the implements-variable functional edge for series", () => {
    const failure = expectFailure(
      buildDataLayerGraph([
        makeDataset(),
        makeSeries({
          datasetId,
          variableId: makeVariableId(
            "https://id.skygest.io/variable/var_MISSING12345",
          ),
        }),
      ]),
    );

    expect(failure).toContainEqual({
      _tag: "DataLayerGraphCardinalityIssue",
      path: `Series:${seriesId}`,
      edgeKind: "implements-variable",
      expectedCount: 1,
      actualCount: 0,
    });
  });
});
