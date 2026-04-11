import { describe, expect, it } from "@effect/vitest";
import { beforeEach, vi } from "vitest";
import {
  MissingOperatorScopeError,
  MissingOperatorSecretError
} from "../src/auth/AuthService";
import type { ResolverWorkerEnvBindings } from "../src/platform/Env";

const authorizeOperator = vi.fn();
const logDeniedOperatorRequest = vi.fn(async () => {});
const handleResolverRequest = vi.fn(async () =>
  new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  })
);

vi.mock("../src/worker/operatorAuth", async () => {
  const actual = await vi.importActual<typeof import("../src/worker/operatorAuth")>(
    "../src/worker/operatorAuth"
  );

  return {
    ...actual,
    authorizeOperator,
    logDeniedOperatorRequest
  };
});

vi.mock("../src/resolver/Router", () => ({
  handleResolverRequest
}));

describe("resolver worker fetch handler", () => {
  beforeEach(() => {
    authorizeOperator.mockReset();
    logDeniedOperatorRequest.mockReset();
    handleResolverRequest.mockReset();
    handleResolverRequest.mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );
  });

  it("lets /health bypass auth entirely", async () => {
    const { handleResolverWorkerRequest } = await import(
      "../src/resolver-worker/fetchHandler"
    );

    const response = await handleResolverWorkerRequest(
      new Request("https://skygest.local/health"),
      {} as ResolverWorkerEnvBindings
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(authorizeOperator).not.toHaveBeenCalled();
    expect(handleResolverRequest).not.toHaveBeenCalled();
  });

  it("lets /v1/resolve/health bypass auth and delegate to the router", async () => {
    const { handleResolverWorkerRequest } = await import(
      "../src/resolver-worker/fetchHandler"
    );

    const response = await handleResolverWorkerRequest(
      new Request("https://skygest.local/v1/resolve/health"),
      {} as ResolverWorkerEnvBindings
    );

    expect(response.status).toBe(200);
    expect(authorizeOperator).not.toHaveBeenCalled();
    expect(handleResolverRequest).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when operator auth fails", async () => {
    authorizeOperator.mockRejectedValueOnce(new MissingOperatorSecretError());
    const { handleResolverWorkerRequest } = await import(
      "../src/resolver-worker/fetchHandler"
    );

    const response = await handleResolverWorkerRequest(
      new Request("https://skygest.local/v1/resolve/post"),
      {} as ResolverWorkerEnvBindings
    );

    expect(response.status).toBe(401);
    expect(logDeniedOperatorRequest).toHaveBeenCalledTimes(1);
    expect(handleResolverRequest).not.toHaveBeenCalled();
  });

  it("returns 403 when operator scope is missing", async () => {
    authorizeOperator.mockRejectedValueOnce(
      new MissingOperatorScopeError({
        missingScopes: ["ops:refresh"]
      })
    );
    const { handleResolverWorkerRequest } = await import(
      "../src/resolver-worker/fetchHandler"
    );

    const response = await handleResolverWorkerRequest(
      new Request("https://skygest.local/v1/resolve/post"),
      {} as ResolverWorkerEnvBindings
    );

    expect(response.status).toBe(403);
    expect(logDeniedOperatorRequest).toHaveBeenCalledTimes(1);
    expect(handleResolverRequest).not.toHaveBeenCalled();
  });
});
