import { describe, expect, it } from "@effect/vitest";
import type { ResolverWorkerEnvBindings } from "../src/platform/Env";
import { handleFetchWithBoundary } from "../src/resolver-worker/fetchHandler";

const emptyEnv = {} as ResolverWorkerEnvBindings;

const makeRequest = (path = "/v1/resolve/health") =>
  new Request(`http://localhost${path}`);

describe("resolver-worker top-level error boundary", () => {
  it("sanitizes raw Error throws into a scrubbed 500 envelope", async () => {
    const sensitive = "sensitive-internal-detail-token-xyzzy";
    const response = await handleFetchWithBoundary(
      makeRequest(),
      emptyEnv,
      () => {
        throw new Error(sensitive);
      }
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/json");

    const bodyText = await response.text();
    expect(bodyText).not.toContain(sensitive);

    const body = JSON.parse(bodyText) as {
      readonly error: string;
      readonly message: string;
    };
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toBe("internal error");
  });

  it("sanitizes non-Error thrown values into a scrubbed 500 envelope", async () => {
    const sensitiveKey = "super-secret-value-2f9a";
    const response = await handleFetchWithBoundary(
      makeRequest(),
      emptyEnv,
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      () => {
        throw { secret: sensitiveKey };
      }
    );

    expect(response.status).toBe(500);
    const bodyText = await response.text();
    expect(bodyText).not.toContain(sensitiveKey);

    const body = JSON.parse(bodyText) as {
      readonly error: string;
      readonly message: string;
    };
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toBe("internal error");
  });

  it("returns the handler's response unchanged on the happy path", async () => {
    const expected = new Response(
      JSON.stringify({ status: "ok" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

    const response = await handleFetchWithBoundary(
      makeRequest(),
      emptyEnv,
      async () => expected
    );

    expect(response).toBe(expected);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { readonly status: string };
    expect(body.status).toBe("ok");
  });
});
