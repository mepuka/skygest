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

const createdAt = "2026-04-11T01:00:00.000Z";
const updatedAt = "2026-04-11T01:30:00.000Z";
const updatedAt2 = "2026-04-11T02:00:00.000Z";

const firstAgent = decodeAgent({
  _tag: "Agent",
  id: "https://id.skygest.io/agent/ag_ADMINROUTE01",
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
  ],
  createdAt,
  updatedAt
});

const secondAgent = decodeAgent({
  _tag: "Agent",
  id: "https://id.skygest.io/agent/ag_ADMINROUTE02",
  kind: "organization",
  name: "GridStatus",
  homepage: "https://www.gridstatus.io/",
  aliases: [
    {
      scheme: "url",
      value: "https://www.gridstatus.io/",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const updatedFirstAgent = decodeAgent({
  ...firstAgent,
  alternateNames: [
    ...(firstAgent.alternateNames ?? []),
    "EIA"
  ],
  updatedAt: updatedAt2
});

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
  it.live("creates, lists, updates, deletes, and audits entities", () =>
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
            body: encodeJsonString(firstAgent)
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
            body: encodeJsonString(secondAgent)
          }),
          operatorIdentity,
          layer
        );

        const listPage = await handleDataLayerRequestWithLayer(
          makeRequest("/admin/data-layer/agents?limit=1&offset=0"),
          operatorIdentity,
          layer
        );

        const getFirst = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/agents/${encodeURIComponent(firstAgent.id)}`
          ),
          operatorIdentity,
          layer
        );

        const updateFirst = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/agents/${encodeURIComponent(firstAgent.id)}`,
            {
              method: "PATCH",
              headers: {
                "content-type": "application/json"
              },
              body: encodeJsonString(updatedFirstAgent)
            }
          ),
          operatorIdentity,
          layer
        );

        const deleteFirst = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/agents/${encodeURIComponent(firstAgent.id)}`,
            {
              method: "DELETE"
            }
          ),
          operatorIdentity,
          layer
        );

        const deletedGet = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/agents/${encodeURIComponent(firstAgent.id)}`
          ),
          operatorIdentity,
          layer
        );

        const auditLog = await handleDataLayerRequestWithLayer(
          makeRequest(
            `/admin/data-layer/audit/${encodeURIComponent(firstAgent.id)}`,
            {
              method: "POST"
            }
          ),
          operatorIdentity,
          layer
        );

        const finalList = await handleDataLayerRequestWithLayer(
          makeRequest("/admin/data-layer/agents?limit=10&offset=0"),
          operatorIdentity,
          layer
        );

        const createdFirstBody = await expectJsonResponse<{
          readonly id: string;
          readonly _tag: string;
        }>(createFirst, 201);
        const createdSecondBody = await expectJsonResponse<{
          readonly id: string;
        }>(createSecond, 201);
        const listBody = await expectJsonResponse<{
          readonly items: ReadonlyArray<{ readonly id: string }>;
          readonly page: {
            readonly offset: number;
            readonly limit: number;
            readonly total: number;
          };
        }>(listPage);
        const getBody = await expectJsonResponse<{
          readonly id: string;
          readonly name: string;
        }>(getFirst);
        const updatedBody = await expectJsonResponse<{
          readonly alternateNames?: ReadonlyArray<string>;
        }>(updateFirst);
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
            readonly beforeRow: null | { readonly alternateNames?: ReadonlyArray<string> };
            readonly afterRow: null | { readonly alternateNames?: ReadonlyArray<string> };
          }>;
        }>(auditLog);
        const finalListBody = await expectJsonResponse<{
          readonly items: ReadonlyArray<{ readonly id: string }>;
          readonly page: { readonly total: number };
        }>(finalList);

        expect(createdFirstBody.id).toBe(firstAgent.id);
        expect(createdFirstBody._tag).toBe("Agent");
        expect(createdSecondBody.id).toBe(secondAgent.id);
        expect(listBody.items).toHaveLength(1);
        expect(listBody.items[0]?.id).toBe(firstAgent.id);
        expect(listBody.page).toEqual({
          offset: 0,
          limit: 1,
          total: 2
        });
        expect(getBody.id).toBe(firstAgent.id);
        expect(getBody.name).toBe(firstAgent.name);
        expect(updatedBody.alternateNames).toContain("EIA");
        expect(deleteBody.ok).toBe(true);
        expect(deletedGetBody.error).toBe("NotFound");
        expect(deletedGetBody.message).toContain(firstAgent.id);
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
          firstAgent.alternateNames
        );
        expect(auditBody.items[1]?.afterRow?.alternateNames).toContain("EIA");
        expect(finalListBody.items).toHaveLength(1);
        expect(finalListBody.items[0]?.id).toBe(secondAgent.id);
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
            body: encodeJsonString(firstAgent)
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
});
