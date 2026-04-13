import { SqlClient } from "effect/unstable/sql";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  Agent as AgentSchema,
  Dataset as DatasetSchema,
  Variable as VariableSchema
} from "../src/domain/data-layer";
import {
  DataRefEntityId,
  FindCandidatesByDataRefCursor,
  FindCandidatesByDataRefInput,
  FindCandidatesByDataRefOutput,
  ResolveDataRefInput,
  ResolveDataRefOutput
} from "../src/domain/data-layer/query";
import { runMigrations } from "../src/db/migrate";
import { AgentsRepo } from "../src/services/AgentsRepo";
import { DataRefQueryService } from "../src/services/DataRefQueryService";
import { DatasetsRepo } from "../src/services/DatasetsRepo";
import { VariablesRepo } from "../src/services/VariablesRepo";
import {
  makeBiLayer,
  sampleDid,
  withDataRefQueryService,
  withTempSqliteFile
} from "./support/runtime";

const decodeAgent = Schema.decodeUnknownSync(AgentSchema);
const decodeDataset = Schema.decodeUnknownSync(DatasetSchema);
const decodeVariable = Schema.decodeUnknownSync(VariableSchema);
const decodeResolveInput = Schema.decodeUnknownSync(ResolveDataRefInput);
const encodeResolveInput = Schema.encodeSync(ResolveDataRefInput);
const decodeResolveOutput = Schema.decodeUnknownSync(ResolveDataRefOutput);
const encodeResolveOutput = Schema.encodeSync(ResolveDataRefOutput);
const decodeFindInput = Schema.decodeUnknownSync(FindCandidatesByDataRefInput);
const encodeFindInput = Schema.encodeSync(FindCandidatesByDataRefInput);
const decodeFindOutput = Schema.decodeUnknownSync(FindCandidatesByDataRefOutput);
const encodeFindOutput = Schema.encodeSync(FindCandidatesByDataRefOutput);
const decodeCursor = Schema.decodeUnknownSync(FindCandidatesByDataRefCursor);
const encodeCursor = Schema.encodeSync(FindCandidatesByDataRefCursor);
const decodeEntityId = Schema.decodeUnknownSync(DataRefEntityId);

const createdAt = "2026-04-13T12:00:00.000Z";
const updatedAt = "2026-04-13T12:30:00.000Z";
const updatedBy = "test-operator";

const registryAgent = decodeAgent({
  _tag: "Agent",
  id: "https://id.skygest.io/agent/ag_TESTQUERY01",
  kind: "organization",
  name: "U.S. Energy Information Administration",
  alternateNames: ["EIA"],
  homepage: "https://www.eia.gov/",
  aliases: [
    {
      scheme: "url",
      value: "https://www.eia.gov/",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const registryVariable = decodeVariable({
  _tag: "Variable",
  id: "https://id.skygest.io/variable/var_TESTQUERY01",
  label: "Retail electricity price",
  definition: "Average retail electricity price.",
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
  id: "https://id.skygest.io/dataset/ds_TESTQUERY01",
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

const supportedEntityIds = {
  agent: decodeEntityId("https://id.skygest.io/agent/ag_TESTLOOKUP01"),
  dataset: decodeEntityId("https://id.skygest.io/dataset/ds_TESTLOOKUP01"),
  distribution: decodeEntityId("https://id.skygest.io/distribution/dist_TESTLOOKUP01"),
  variable: decodeEntityId("https://id.skygest.io/variable/var_TESTLOOKUP01")
} as const;

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
  readonly observationLabel?: string | null;
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
        ${input.observationLabel ?? null},
        ${input.observationStart ?? input.observationEnd ?? ""},
        ${input.observationEnd ?? input.observationStart ?? ""},
        ${input.observationSortKey ?? input.observationEnd ?? input.observationStart ?? ""},
        ${input.hasObservationTime === true ? 1 : 0},
        ${1_710_000_000_000}
      )
    `.pipe(Effect.asVoid);
  });

describe("data-ref query schemas", () => {
  it("round-trip the shared lookup and reverse-lookup contracts", () => {
    const typedResolveInput = decodeResolveInput({
      alias: {
        scheme: "eia-route",
        value: "/electricity/retail-sales"
      }
    });
    const roundTripResolveInput = decodeResolveInput(
      encodeResolveInput(typedResolveInput)
    );

    const typedResolveOutput = decodeResolveOutput({
      entity: registryDataset
    });
    const roundTripResolveOutput = decodeResolveOutput(
      encodeResolveOutput(typedResolveOutput)
    );

    const typedCursor = decodeCursor({
      hasObservationTime: true,
      observationSortKey: "2024-03",
      sourcePostUri: `at://${sampleDid}/app.bsky.feed.post/round-trip`,
      citationKey:
        `kernel\u0000resolved\u0000${supportedEntityIds.variable}\u00002024-01\u00002024-03\u0000`
    });
    const roundTripCursor = decodeCursor(encodeCursor(typedCursor));

    const typedFindInput = decodeFindInput({
      entityId: supportedEntityIds.variable,
      observedSince: "2024-01",
      observedUntil: "2024-03",
      cursor: typedCursor,
      limit: 5
    });
    const roundTripFindInput = decodeFindInput(encodeFindInput(typedFindInput));

    const typedFindOutput = decodeFindOutput({
      items: [
        {
          sourcePostUri: `at://${sampleDid}/app.bsky.feed.post/round-trip`,
          expert: {
            did: sampleDid,
            handle: "seed.example.com",
            displayName: "Seed Example"
          },
          citationSource: "kernel",
          resolutionState: "resolved",
          assertedValue: 42,
          assertedUnit: "USD/MWh",
          observationTime: {
            start: "2024-01",
            end: "2024-03"
          }
        }
      ],
      nextCursor: typedCursor
    });
    const roundTripFindOutput = decodeFindOutput(
      encodeFindOutput(typedFindOutput)
    );

    expect(roundTripResolveInput).toEqual(typedResolveInput);
    expect(roundTripResolveOutput).toEqual(typedResolveOutput);
    expect(roundTripCursor).toEqual(typedCursor);
    expect(roundTripFindInput).toEqual(typedFindInput);
    expect(roundTripFindOutput).toEqual(typedFindOutput);
  });
});

describe("DataRefQueryService.resolveDataRef", () => {
  it.live("returns canonical hits, alias hits, and null misses from the shared registry", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        const queryLayer = withDataRefQueryService(layer);

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));
        await Effect.runPromise(seedRegistryEntities().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* DataRefQueryService;

            const canonical = yield* service.resolveDataRef({
              canonicalUri: registryVariable.id
            });
            const variableAlias = yield* service.resolveDataRef({
              alias: {
                scheme: "eia-series",
                value: "ELEC.PRICE.US-ALL.M"
              }
            });
            const datasetAlias = yield* service.resolveDataRef({
              alias: {
                scheme: "eia-route",
                value: "/electricity/retail-sales"
              }
            });
            const miss = yield* service.resolveDataRef({
              alias: {
                scheme: "url",
                value: "https://example.com/no-match"
              }
            });

            expect(canonical.entity).toEqual(registryVariable);
            expect(variableAlias.entity).toEqual(registryVariable);
            expect(datasetAlias.entity).toEqual(registryDataset);
            expect(miss.entity).toBeNull();
          }).pipe(Effect.provide(queryLayer))
        );
      })
    )
  );
});

describe("DataRefQueryService.findCandidatesByDataRef", () => {
  it.live("returns stored citations for every supported entity kind", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        const queryLayer = withDataRefQueryService(layer);
        const postUris = [
          `at://${sampleDid}/app.bsky.feed.post/entity-agent`,
          `at://${sampleDid}/app.bsky.feed.post/entity-dataset`,
          `at://${sampleDid}/app.bsky.feed.post/entity-distribution`,
          `at://${sampleDid}/app.bsky.feed.post/entity-variable`
        ] as const;

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));
        await Effect.runPromise(
          seedExpertAndPosts([
            { uri: postUris[0], createdAt: 10 },
            { uri: postUris[1], createdAt: 11 },
            { uri: postUris[2], createdAt: 12 },
            { uri: postUris[3], createdAt: 13 }
          ]).pipe(Effect.provide(layer))
        );
        await Effect.runPromise(
          Effect.all(
            [
              insertCitation({
                sourcePostUri: postUris[0],
                entityId: supportedEntityIds.agent,
                resolutionState: "resolved"
              }),
              insertCitation({
                sourcePostUri: postUris[1],
                entityId: supportedEntityIds.dataset,
                citationSource: "stage1",
                resolutionState: "source_only"
              }),
              insertCitation({
                sourcePostUri: postUris[2],
                entityId: supportedEntityIds.distribution,
                citationSource: "stage1",
                resolutionState: "source_only"
              }),
              insertCitation({
                sourcePostUri: postUris[3],
                entityId: supportedEntityIds.variable,
                resolutionState: "resolved"
              })
            ],
            { concurrency: "unbounded" }
          ).pipe(Effect.provide(layer))
        );

        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* DataRefQueryService;

            const agentRows = yield* service.findCandidatesByDataRef({
              entityId: supportedEntityIds.agent
            });
            const datasetRows = yield* service.findCandidatesByDataRef({
              entityId: supportedEntityIds.dataset
            });
            const distributionRows = yield* service.findCandidatesByDataRef({
              entityId: supportedEntityIds.distribution
            });
            const variableRows = yield* service.findCandidatesByDataRef({
              entityId: supportedEntityIds.variable
            });

            expect(agentRows.items[0]?.sourcePostUri).toBe(postUris[0]);
            expect(agentRows.items[0]?.citationSource).toBe("kernel");
            expect(datasetRows.items[0]?.sourcePostUri).toBe(postUris[1]);
            expect(datasetRows.items[0]?.citationSource).toBe("stage1");
            expect(distributionRows.items[0]?.sourcePostUri).toBe(postUris[2]);
            expect(distributionRows.items[0]?.citationSource).toBe("stage1");
            expect(variableRows.items[0]?.sourcePostUri).toBe(postUris[3]);
            expect(variableRows.items[0]?.citationSource).toBe("kernel");
          }).pipe(Effect.provide(queryLayer))
        );
      })
    )
  );

  it.live("paginates by observation time and excludes untimed rows when filters are present", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        const queryLayer = withDataRefQueryService(layer);
        const latePostUri = `at://${sampleDid}/app.bsky.feed.post/obs-late`;
        const earlyPostUri = `at://${sampleDid}/app.bsky.feed.post/obs-early`;
        const untimedPostUri = `at://${sampleDid}/app.bsky.feed.post/obs-untimed`;

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
                entityId: supportedEntityIds.variable,
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
                entityId: supportedEntityIds.variable,
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
                entityId: supportedEntityIds.variable,
                resolutionState: "source_only"
              })
            ],
            { concurrency: "unbounded" }
          ).pipe(Effect.provide(layer))
        );

        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* DataRefQueryService;

            const firstPage = yield* service.findCandidatesByDataRef({
              entityId: supportedEntityIds.variable,
              limit: 2
            });
            expect(firstPage.items.map((item) => item.sourcePostUri)).toEqual([
              latePostUri,
              earlyPostUri
            ]);
            expect(firstPage.nextCursor).not.toBeNull();

            const secondPageCursor = firstPage.nextCursor;
            if (secondPageCursor === null) {
              throw new Error("expected next cursor for second page");
            }

            const secondPage = yield* service.findCandidatesByDataRef({
              entityId: supportedEntityIds.variable,
              limit: 2,
              cursor: secondPageCursor
            });
            expect(secondPage.items.map((item) => item.sourcePostUri)).toEqual([
              untimedPostUri
            ]);
            expect(secondPage.nextCursor).toBeNull();

            const filtered = yield* service.findCandidatesByDataRef({
              entityId: supportedEntityIds.variable,
              observedSince: "2024-02",
              observedUntil: "2024-04"
            });
            expect(filtered.items.map((item) => item.sourcePostUri)).toEqual([
              latePostUri
            ]);
            expect(filtered.items.every((item) => item.observationTime !== null)).toBe(true);
            expect(filtered.nextCursor).toBeNull();
          }).pipe(Effect.provide(queryLayer))
        );
      })
    )
  );
});
