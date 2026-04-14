import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  EntitySearchDocument,
  EntitySearchHit,
  EntitySearchSemanticRecallInput,
  SearchVariablesInput
} from "../src/domain/entitySearch";
import {
  mintAgentId,
  mintDatasetId,
  mintSeriesId,
  mintVariableId
} from "../src/domain/data-layer/ids";

const decodeDocument = Schema.decodeUnknownSync(EntitySearchDocument);
const encodeDocument = Schema.encodeSync(EntitySearchDocument);
const decodeHit = Schema.decodeUnknownSync(EntitySearchHit);
const encodeHit = Schema.encodeSync(EntitySearchHit);
const decodeSearchVariablesInput = Schema.decodeUnknownSync(SearchVariablesInput);
const decodeSemanticRecallInput = Schema.decodeUnknownSync(
  EntitySearchSemanticRecallInput
);

describe("entitySearch domain", () => {
  it("round-trips a unified entity-search document and ranked hit", () => {
    const publisherAgentId = mintAgentId();
    const datasetId = mintDatasetId();
    const seriesId = mintSeriesId();
    const variableId = mintVariableId();

    const document = decodeDocument({
      entityId: variableId,
      entityType: "Variable",
      primaryLabel: "Wind generation",
      secondaryLabel: "Hourly",
      aliases: [
        {
          scheme: "display-alias",
          value: "Wind output",
          relation: "exactMatch"
        }
      ],
      publisherAgentId,
      datasetId,
      variableId,
      seriesId,
      measuredProperty: "generation",
      technologyOrFuel: "wind",
      statisticType: "actual",
      unitFamily: "power",
      place: "United States",
      accessHostname: "api.eia.gov",
      canonicalUrls: ["https://api.eia.gov/series/wind-generation"],
      payloadJson: "{\"kind\":\"Variable\"}",
      primaryText: "wind generation hourly",
      aliasText: "wind output",
      lineageText: "EIA electric power data",
      urlText: "api.eia.gov series wind generation",
      ontologyText: "generation wind power electricity",
      semanticText: "hourly wind generation electricity dataset",
      updatedAt: "2026-04-13T12:34:56.000Z"
    });

    const hit = decodeHit({
      document,
      score: 13.5,
      rank: 1,
      matchKind: "lexical",
      snippet: "wind generation hourly"
    });

    expect(decodeDocument(encodeDocument(document))).toEqual(document);
    expect(decodeHit(encodeHit(hit))).toEqual(hit);
  });

  it("decodes scoped lexical and semantic recall request shapes", () => {
    const datasetId = mintDatasetId();

    const lexical = decodeSearchVariablesInput({
      query: "hourly wind generation",
      exactHostnames: ["api.eia.gov"],
      scope: {
        datasetId,
        statisticType: "actual",
        unitFamily: "power"
      },
      limit: 5
    });

    const semantic = decodeSemanticRecallInput({
      text: "EIA hourly wind generation",
      entityTypes: ["Variable", "Series"],
      scope: {
        datasetId,
        accessHostname: "api.eia.gov"
      },
      limit: 3
    });

    expect(lexical.scope?.datasetId).toBe(datasetId);
    expect(lexical.exactHostnames).toEqual(["api.eia.gov"]);
    expect(semantic.entityTypes).toEqual(["Variable", "Series"]);
    expect(semantic.scope?.accessHostname).toBe("api.eia.gov");
  });
});
