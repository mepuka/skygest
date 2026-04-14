import { WorkerEntrypoint } from "cloudflare:workers";
import {
  internalServerError,
  type HttpErrorEnvelope
} from "../domain/api";
import {
  httpErrorStatus,
  isHttpEnvelope
} from "../http/ErrorMapping";
import type { ResolverWorkerEnvBindings } from "../platform/Env";
import { makeEffectRpc } from "../platform/Rpc";
import { makeResolverLayer } from "../resolver/Layer";
import {
  resolveBulkEffect,
  resolvePostEffect,
  searchCandidatesEffect
} from "../resolver/Router";
import {
  handleFetchWithBoundary,
  handleResolverWorkerRequest
} from "./fetchHandler";

const resolverRpc = makeEffectRpc(makeResolverLayer);

const toRpcHttpError = (error: unknown): HttpErrorEnvelope =>
  isHttpEnvelope(error)
    ? error
    : internalServerError("internal error");

const toResolverRpcError = (
  error: unknown,
  fallbackPostUri: Parameters<typeof resolvePostEffect>[0]["postUri"] | undefined,
  operation: string
) => {
  const envelope = toRpcHttpError(error);
  return {
    message: envelope.message,
    status: httpErrorStatus(envelope),
    ...(fallbackPostUri === undefined ? {} : { postUri: fallbackPostUri }),
    operation
  };
};

export class ResolverEntrypoint extends WorkerEntrypoint<ResolverWorkerEnvBindings> {
  resolvePost(
    input: Parameters<typeof resolvePostEffect>[0],
    _options?: { readonly requestId?: string }
  ) {
    return resolverRpc.run(
      this.env,
      resolvePostEffect(input),
      (error) =>
        toResolverRpcError(
          error,
          input.postUri,
          "ResolverEntrypoint.resolvePost"
        )
    );
  }

  resolveBulk(
    input: Parameters<typeof resolveBulkEffect>[0],
    _options?: { readonly requestId?: string }
  ) {
    return resolverRpc.run(
      this.env,
      resolveBulkEffect(input),
      (error) =>
        toResolverRpcError(
          error,
          input.posts[0]?.postUri,
          "ResolverEntrypoint.resolveBulk"
        )
    );
  }

  searchCandidates(
    input: Parameters<typeof searchCandidatesEffect>[0],
    _options?: { readonly requestId?: string }
  ) {
    return resolverRpc.run(
      this.env,
      searchCandidatesEffect(input),
      (error) =>
        toResolverRpcError(
          error,
          input.postUri,
          "ResolverEntrypoint.searchCandidates"
        )
    );
  }
}

export const fetch = (
  request: Request,
  env: ResolverWorkerEnvBindings,
  ctx?: ExecutionContext
): Promise<Response> =>
  handleFetchWithBoundary(request, env, ctx, handleResolverWorkerRequest);

export default {
  fetch
};
