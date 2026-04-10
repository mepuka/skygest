import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { fetchRoute } from "../scripts/cold-start-ingest-eia";

const jsonResponse = (
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  body: unknown
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );

const makeHttpLayer = (
  handler: Parameters<typeof HttpClient.make>[0]
) => Layer.succeed(HttpClient.HttpClient, HttpClient.make(handler));

describe("fetchRoute", () => {
  it.effect("decodes a leaf route response into EiaApiResponse", () =>
    Effect.gen(function* () {
      const result = yield* fetchRoute(
        "electricity/retail-sales",
        "fake-key"
      );
      expect(result.response.id).toBe("retail-sales");
      expect(result.response.routes).toBeUndefined();
      expect(result.response.facets).toEqual([]);
    }).pipe(
      Effect.provide(
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            // The fetcher must hit the EIA v2 base + the route path with
            // a trailing slash, and pass api_key as a urlParam.
            expect(url.host).toBe("api.eia.gov");
            expect(url.pathname).toBe("/v2/electricity/retail-sales/");
            expect(url.searchParams.get("api_key")).toBe("fake-key");
            return jsonResponse(request, {
              response: {
                id: "retail-sales",
                name: "Electricity Sales",
                facets: []
              }
            });
          })
        )
      )
    )
  );

  it.effect("decodes a parent route response carrying child routes", () =>
    Effect.gen(function* () {
      const result = yield* fetchRoute("electricity", "fake-key");
      expect(result.response.id).toBe("electricity");
      expect(result.response.routes).toEqual([
        { id: "retail-sales", name: "Retail Sales" },
        { id: "rto", name: "Real-Time Operations" }
      ]);
    }).pipe(
      Effect.provide(
        makeHttpLayer((request) =>
          Effect.succeed(
            jsonResponse(request, {
              response: {
                id: "electricity",
                name: "Electricity",
                routes: [
                  { id: "retail-sales", name: "Retail Sales" },
                  { id: "rto", name: "Real-Time Operations" }
                ]
              }
            })
          )
        )
      )
    )
  );

  it.effect("decodes the empty root route (path = '')", () =>
    Effect.gen(function* () {
      const result = yield* fetchRoute("", "fake-key");
      expect(result.response.id).toBe("root");
    }).pipe(
      Effect.provide(
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            // Empty route should hit the bare /v2/ endpoint, no extra slashes.
            expect(url.pathname).toBe("/v2/");
            return jsonResponse(request, {
              response: { id: "root", name: "EIA API" }
            });
          })
        )
      )
    )
  );
});
