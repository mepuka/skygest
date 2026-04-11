import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import type { AccessIdentity } from "../src/auth/AuthService";
import { handleDataLayerRequestWithLayer } from "../src/data-layer/Router";
import { runMigrations } from "../src/db/migrate";
import { Agent as AgentSchema } from "../src/domain/data-layer";
import { encodeJsonString } from "../src/platform/Json";
import { Logging } from "../src/platform/Logging";
import { DataLayerReposD1 } from "../src/services/d1/DataLayerReposD1";
import { makeSqliteLayer, withTempSqliteFile } from "./support/runtime";

const operatorIdentity: AccessIdentity = {
  subject: "did:example:operator",
  email: "operator@example.com",
  scopes: ["ops:read", "ops:refresh"]
};

const decodeAgent = Schema.decodeUnknownSync(AgentSchema);

const firstAgentInput = {
  _tag: "Agent",
  kind: "organization",
  name: "U.S. Energy Information Administration",
  alternateNames: ["Energy Information Administration"],
  homepage: "https://www.eia.gov/",
  aliases: [
    {
      scheme: "url",
      value: "https://www.eia.gov/",
      relation: "exactMatch"
    }
  ]
} as const;

const secondAgentInput = {
  _tag: "Agent",
  kind: "organization",
  name: "GridStatus",
  homepage: "https://www.gridstatus.io/",
  aliases: [
    {
      scheme: "url",
      value: "https://www.gridstatus.io/",
      relation: "exactMatch"
    }
  ]
} as const;

const updatedFirstAgentInput = {
  ...firstAgentInput,
  alternateNames: [
    ...(firstAgentInput.alternateNames ?? []),
    "EIA"
  ]
} as const;

const makeDataLayerTestLayer = (filename: string) => {
  const sqliteLayer = makeSqliteLayer(filename);
  const reposLayer = DataLayerReposD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );

  return Layer.mergeAll(
    sqliteLayer,
    reposLayer,
    Logging.layer
  );
};

const makeRequest = (
  pathname: string,
  init?: RequestInit
) =>
  new Request(`https://skygest.local${pathname}`, init);

const expectJsonResponse = async <A>(
  response: Response,
  expectedStatus = 200
): Promise<A> => {
  const text = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(
      `expected ${String(expectedStatus)} but received ${String(response.status)}: ${text}`
    );
  }

  return JSON.parse(text) as A;
};

describe("data-layer admin routes", () => {
  it.live("creates, lists, replaces, deletes, and audits entities with server-owned ids and timestamps", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeDataLayerTestLayer(filename);

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const createFirst = await handleDataLayerRequestWithLayer(
          makeRequest("/admin/data-layer/agents", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: encodeJsonString(firstAgentInput)
          }),
          operatorIdentity,
          layer
        );

        const createSecond = await handleDataLayerRequestWithLayer(
          makeRequest("/admin/data-layer/agents", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: encodeJsonString(secondAgentInput)
          }),
          operatorIdentity,
          layer
        );

        const createdFirstBody = decodeAgent(
          await expectJsonResponse<unknown>(createFirst, 201)
        );
        const createdSecondBody = decodeAgent(
          await expectJsonResponse<unknown>(createSecond, 201)
        );

        const listPage = await handleDataLayerRequestWithLayer(
          makeRequest("/admin/data-layer/agents?limit=1&offset=0"),
          operatorIdentity,
          layer
        );

        const getFirst = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/agents/${encodeURIComponent(createdFirstBody.id)}`
          ),
          operatorIdentity,
          layer
        );

        const updateFirst = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/agents/${encodeURIComponent(createdFirstBody.id)}`,
            {
              method: "PUT",
              headers: {
                "content-type": "application/json"
              },
              body: encodeJsonString(updatedFirstAgentInput)
            }
          ),
          operatorIdentity,
          layer
        );

        const deleteFirst = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/agents/${encodeURIComponent(createdFirstBody.id)}`,
            {
              method: "DELETE"
            }
          ),
          operatorIdentity,
          layer
        );

        const deletedGet = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/agents/${encodeURIComponent(createdFirstBody.id)}`
          ),
          operatorIdentity,
          layer
        );

        const auditLog = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/audit/${encodeURIComponent(createdFirstBody.id)}`
          ),
          operatorIdentity,
          layer
        );

        const finalList = await handleDataLayerRequestWithLayer(
          makeRequest("/admin/data-layer/agents?limit=10&offset=0"),
          operatorIdentity,
          layer
        );

        const listBody = await expectJsonResponse<{
          readonly items: ReadonlyArray<{ readonly id: string }>;
          readonly page: {
            readonly offset: number;
            readonly limit: number;
            readonly total: number;
          };
        }>(listPage);
        const getBody = decodeAgent(await expectJsonResponse<unknown>(getFirst));
        const updatedBody = decodeAgent(
          await expectJsonResponse<unknown>(updateFirst)
        );
        const deleteBody = await expectJsonResponse<{ readonly ok: boolean }>(
          deleteFirst
        );
        const deletedGetBody = await expectJsonResponse<{
          readonly error: string;
          readonly message: string;
        }>(deletedGet, 404);
        const auditBody = await expectJsonResponse<{
          readonly items: ReadonlyArray<{
            readonly operation: "insert" | "update" | "delete";
            readonly operator: string;
            readonly beforeRow: null | {
              readonly id: string;
              readonly alternateNames?: ReadonlyArray<string>;
            };
            readonly afterRow: null | {
              readonly id: string;
              readonly alternateNames?: ReadonlyArray<string>;
            };
            readonly timestamp: string;
          }>;
        }>(auditLog);
        const finalListBody = await expectJsonResponse<{
          readonly items: ReadonlyArray<{ readonly id: string }>;
          readonly page: { readonly total: number };
        }>(finalList);

        expect(createdFirstBody.id).toMatch(
          /^https:\/\/id\.skygest\.io\/agent\/ag_[A-Za-z0-9]{10,}$/u
        );
        expect(createdFirstBody._tag).toBe("Agent");
        expect(createdFirstBody.createdAt).toBe(createdFirstBody.updatedAt);
        expect(createdSecondBody.id).not.toBe(createdFirstBody.id);
        expect(listBody.items).toHaveLength(1);
        expect(listBody.items[0]?.id).toBe(createdFirstBody.id);
        expect(listBody.page).toEqual({
          offset: 0,
          limit: 1,
          total: 2
        });
        expect(getBody.id).toBe(createdFirstBody.id);
        expect(getBody.name).toBe(firstAgentInput.name);
        expect(updatedBody.id).toBe(createdFirstBody.id);
        expect(updatedBody.createdAt).toBe(createdFirstBody.createdAt);
        expect(updatedBody.updatedAt >= createdFirstBody.updatedAt).toBe(true);
        expect(updatedBody.alternateNames).toContain("EIA");
        expect(deleteBody.ok).toBe(true);
        expect(deletedGetBody.error).toBe("NotFound");
        expect(deletedGetBody.message).toContain(createdFirstBody.id);
        expect(auditBody.items.map((item) => item.operation)).toEqual([
          "delete",
          "update",
          "insert"
        ]);
        expect(
          auditBody.items.every(
            (item) => item.operator === operatorIdentity.email
          )
        ).toBe(true);
        expect(auditBody.items[0]?.afterRow).toBeNull();
        expect(auditBody.items[1]?.beforeRow?.alternateNames).toEqual(
          firstAgentInput.alternateNames
        );
        expect(auditBody.items[1]?.afterRow?.id).toBe(createdFirstBody.id);
        expect(auditBody.items[1]?.afterRow?.alternateNames).toContain("EIA");
        expect(auditBody.items[2]?.afterRow?.id).toBe(createdFirstBody.id);
        expect(finalListBody.items).toHaveLength(1);
        expect(finalListBody.items[0]?.id).toBe(createdSecondBody.id);
        expect(finalListBody.page.total).toBe(1);
      })
    )
  );

  it.live("rejects path and payload kind mismatches", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeDataLayerTestLayer(filename);

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const response = await handleDataLayerRequestWithLayer(
          makeRequest("/admin/data-layer/catalogs", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: encodeJsonString(firstAgentInput)
          }),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{
          readonly error: string;
          readonly message: string;
        }>(response, 400);

        expect(body.error).toBe("BadRequest");
        expect(body.message).toContain("does not match kind catalogs");
      })
    )
  );

  it.live("rejects ids whose kind does not match the route kind", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeDataLayerTestLayer(filename);

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const response = await handleDataLayerRequestWithLayer(
          makeRequest(
            "/admin/data-layer/agents/https%3A%2F%2Fid.skygest.io%2Fdataset%2Fds_ADMINROUTE01"
          ),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{
          readonly error: string;
          readonly message: string;
        }>(response, 400);

        expect(body.error).toBe("BadRequest");
        expect(body.message).toContain("invalid agents entity id");
      })
    )
  );
});
