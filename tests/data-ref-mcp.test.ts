/** @effect-diagnostics preferSchemaOverJson:skip-file */
import { SqlClient } from "effect/unstable/sql";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  Agent as AgentSchema,
  Dataset as DatasetSchema,
  Variable as VariableSchema
} from "../src/domain/data-layer";
import { DataRefEntityId } from "../src/domain/data-layer/query";
import { runMigrations } from "../src/db/migrate";
import { decodeCallToolResultWith } from "../src/mcp/Client";
import {
  FindCandidatesByDataRefMcpOutput,
  ResolveDataRefMcpOutput
} from "../src/mcp/OutputSchemas";
import { AgentsRepo } from "../src/services/AgentsRepo";
import { DatasetsRepo } from "../src/services/DatasetsRepo";
import { VariablesRepo } from "../src/services/VariablesRepo";
import {
  createMcpClient,
  makeBiLayer,
  sampleDid,
  withTempSqliteFile
} from "./support/runtime";

const decodeAgent = Schema.decodeUnknownSync(AgentSchema);
const decodeDataset = Schema.decodeUnknownSync(DatasetSchema);
const decodeVariable = Schema.decodeUnknownSync(VariableSchema);
const decodeEntityId = Schema.decodeUnknownSync(DataRefEntityId);
const decodeResolveResponse = decodeCallToolResultWith(ResolveDataRefMcpOutput);
const decodeFindCandidatesResponse = decodeCallToolResultWith(
  FindCandidatesByDataRefMcpOutput
);

const createdAt = "2026-04-13T12:00:00.000Z";
const updatedAt = "2026-04-13T12:30:00.000Z";
const updatedBy = "test-operator";

const registryAgent = decodeAgent({
  _tag: "Agent",
  id: "https://id.skygest.io/agent/ag_TESTMCP0001",
  kind: "organization",
  name: "U.S. Energy Information Administration",
  aliases: [],
  createdAt,
  updatedAt
});

const registryVariable = decodeVariable({
  _tag: "Variable",
  id: "https://id.skygest.io/variable/var_TESTMCP0001",
  label: "Retail electricity price",
  measuredProperty: "price",
  domainObject: "electricity",
  statisticType: "price",
  aggregation: "average",
  unitFamily: "currency_per_energy",
  aliases: [
    {
      scheme: "eia-series",
      value: "ELEC.PRICE.US-ALL.M",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const registryDataset = decodeDataset({
  _tag: "Dataset",
  id: "https://id.skygest.io/dataset/ds_TESTMCP0001",
  title: "Average Retail Price of Electricity",
  creatorAgentId: registryAgent.id,
  publisherAgentId: registryAgent.id,
  variableIds: [registryVariable.id],
  aliases: [
    {
      scheme: "eia-route",
      value: "/electricity/retail-sales",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const reverseLookupEntityId = decodeEntityId(
  "https://id.skygest.io/variable/var_TESTMCPLOOKUP01"
);

const getTextContent = (result: {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
}) => {
  const textContent = result.content.find(
    (content): content is { type: "text"; text: string } =>
      content.type === "text" && typeof content.text === "string"
  );

  if (textContent === undefined) {
    throw new Error("missing text content");
  }

  return textContent.text;
};

const seedRegistryEntities = () =>
  Effect.gen(function* () {
    const agents = yield* AgentsRepo;
    const datasets = yield* DatasetsRepo;
    const variables = yield* VariablesRepo;

    yield* agents.insert(registryAgent, { updatedBy });
    yield* variables.insert(registryVariable, { updatedBy });
    yield* datasets.insert(registryDataset, { updatedBy });
  });

const seedExpertAndPosts = (
  posts: ReadonlyArray<{
    readonly uri: string;
    readonly createdAt: number;
  }>
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      INSERT INTO experts (
        did,
        handle,
        display_name,
        description,
        avatar,
        domain,
        source,
        source_ref,
        shard,
        active,
        tier,
        added_at,
        last_synced_at
      ) VALUES (
        ${sampleDid},
        ${"seed.example.com"},
        ${"Seed Example"},
        ${"Energy analyst"},
        NULL,
        ${"energy"},
        ${"manual"},
        NULL,
        0,
        1,
        ${"energy-focused"},
        ${posts[0]?.createdAt ?? 0},
        NULL
      )
      ON CONFLICT(did) DO NOTHING
    `;

    yield* Effect.forEach(
      posts,
      (post, index) =>
        sql`
          INSERT INTO posts (
            uri,
            did,
            cid,
            text,
            created_at,
            indexed_at,
            has_links,
            status,
            ingest_id,
            embed_type
          ) VALUES (
            ${post.uri},
            ${sampleDid},
            ${`cid-${index}`},
            ${`Post ${index + 1}`},
            ${post.createdAt},
            ${post.createdAt},
            0,
            ${"active"},
            ${`ingest-${index}`},
            NULL
          )
        `.pipe(Effect.asVoid),
      { discard: true }
    );
  });

const insertCitation = (input: {
  readonly sourcePostUri: string;
  readonly entityId: string;
  readonly citationSource?: "kernel" | "stage1";
  readonly citationKey?: string;
  readonly resolutionState: "source_only" | "partially_resolved" | "resolved";
  readonly assertedValueJson?: string | null;
  readonly assertedUnit?: string | null;
  readonly observationStart?: string | null;
  readonly observationEnd?: string | null;
  readonly observationSortKey?: string;
  readonly hasObservationTime?: boolean;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      INSERT INTO data_ref_candidate_citations (
        source_post_uri,
        entity_id,
        citation_source,
        citation_key,
        resolution_state,
        asserted_value_json,
        asserted_unit,
        observation_start,
        observation_end,
        observation_label,
        normalized_observation_start,
        normalized_observation_end,
        observation_sort_key,
        has_observation_time,
        updated_at
      ) VALUES (
        ${input.sourcePostUri},
        ${input.entityId},
        ${input.citationSource ?? "kernel"},
        ${input.citationKey ??
          [
            input.citationSource ?? "kernel",
            input.resolutionState,
            input.entityId,
            input.observationStart ?? input.observationEnd ?? "",
            input.observationEnd ?? input.observationStart ?? "",
            ""
          ].join("\u0000")},
        ${input.resolutionState},
        ${input.assertedValueJson ?? null},
        ${input.assertedUnit ?? null},
        ${input.observationStart ?? null},
        ${input.observationEnd ?? null},
        NULL,
        ${input.observationStart ?? input.observationEnd ?? ""},
        ${input.observationEnd ?? input.observationStart ?? ""},
        ${input.observationSortKey ?? input.observationEnd ?? input.observationStart ?? ""},
        ${input.hasObservationTime === true ? 1 : 0},
        ${1_710_000_000_000}
      )
    `.pipe(Effect.asVoid);
  });

describe("data-ref MCP tools", () => {
  it.live("resolve_data_ref performs exact canonical and alias lookup end to end", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));
        await Effect.runPromise(seedRegistryEntities().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer);

        try {
          const canonicalResult = await client.callTool({
            name: "resolve_data_ref",
            arguments: { canonicalUri: registryVariable.id }
          });
          const aliasResult = await client.callTool({
            name: "resolve_data_ref",
            arguments: {
              alias: {
                scheme: "eia-route",
                value: "/electricity/retail-sales"
              }
            }
          });
          const missResult = await client.callTool({
            name: "resolve_data_ref",
            arguments: {
              alias: {
                scheme: "url",
                value: "https://example.com/no-match"
              }
            }
          });

          const canonical = decodeResolveResponse(canonicalResult);
          const alias = decodeResolveResponse(aliasResult);
          const miss = decodeResolveResponse(missResult);

          expect(canonical.entity?.id).toBe(registryVariable.id);
          expect(alias.entity?.id).toBe(registryDataset.id);
          expect(miss.entity).toBeNull();
          expect(canonical._display).toContain("Retail electricity price");
          expect(alias._display).toContain("Average Retail Price of Electricity");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("find_candidates_by_data_ref paginates, filters by observation time, and rejects invalid cursors", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        const latePostUri = `at://${sampleDid}/app.bsky.feed.post/mcp-obs-late`;
        const earlyPostUri = `at://${sampleDid}/app.bsky.feed.post/mcp-obs-early`;
        const untimedPostUri = `at://${sampleDid}/app.bsky.feed.post/mcp-obs-untimed`;

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));
        await Effect.runPromise(
          seedExpertAndPosts([
            { uri: latePostUri, createdAt: 10 },
            { uri: earlyPostUri, createdAt: 30 },
            { uri: untimedPostUri, createdAt: 20 }
          ]).pipe(Effect.provide(layer))
        );
        await Effect.runPromise(
          Effect.all(
            [
              insertCitation({
                sourcePostUri: latePostUri,
                entityId: reverseLookupEntityId,
                resolutionState: "resolved",
                assertedValueJson: JSON.stringify(57.2),
                assertedUnit: "USD/MWh",
                observationStart: "2024-03",
                observationEnd: "2024-03",
                observationSortKey: "2024-03",
                hasObservationTime: true
              }),
              insertCitation({
                sourcePostUri: earlyPostUri,
                entityId: reverseLookupEntityId,
                resolutionState: "resolved",
                assertedValueJson: JSON.stringify(48.1),
                assertedUnit: "USD/MWh",
                observationStart: "2024-01",
                observationEnd: "2024-01",
                observationSortKey: "2024-01",
                hasObservationTime: true
              }),
              insertCitation({
                sourcePostUri: untimedPostUri,
                entityId: reverseLookupEntityId,
                resolutionState: "source_only"
              })
            ],
            { concurrency: "unbounded" }
          ).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(layer);

        try {
          const firstPageResult = await client.callTool({
            name: "find_candidates_by_data_ref",
            arguments: {
              entityId: reverseLookupEntityId,
              limit: 2
            }
          });
          const firstPage = decodeFindCandidatesResponse(firstPageResult);
          expect(firstPage.items.map((item) => item.sourcePostUri)).toEqual([
            latePostUri,
            earlyPostUri
          ]);
          expect(firstPage.nextCursor).not.toBeNull();
          expect(firstPage._display).toContain("More results are available.");

          const secondPageResult = await client.callTool({
            name: "find_candidates_by_data_ref",
            arguments: {
              entityId: reverseLookupEntityId,
              cursor: firstPage.nextCursor
            }
          });
          const secondPage = decodeFindCandidatesResponse(secondPageResult);
          expect(secondPage.items.map((item) => item.sourcePostUri)).toEqual([
            untimedPostUri
          ]);
          expect(secondPage.nextCursor).toBeNull();

          const filteredResult = await client.callTool({
            name: "find_candidates_by_data_ref",
            arguments: {
              entityId: reverseLookupEntityId,
              observedSince: "2024-02",
              observedUntil: "2024-04"
            }
          });
          const filtered = decodeFindCandidatesResponse(filteredResult);
          expect(filtered.items.map((item) => item.sourcePostUri)).toEqual([
            latePostUri
          ]);
          expect(filtered.items.every((item) => item.observationTime !== null)).toBe(true);

          const invalidCursor = await client.callTool({
            name: "find_candidates_by_data_ref",
            arguments: {
              entityId: reverseLookupEntityId,
              cursor: "not-json"
            }
          });
          expect(invalidCursor.isError).toBe(true);
          expect(getTextContent(invalidCursor)).toContain(
            "Invalid data-ref candidate cursor"
          );
        } finally {
          await close();
        }
      })
    )
  );
});
