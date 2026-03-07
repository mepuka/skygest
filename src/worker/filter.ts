import { Effect } from "effect";
import { PollerBusyError } from "../domain/errors";
import { handleIngestRequest, makeIngestLayer } from "../ingest/Router";
import { PollCoordinator } from "../ingest/PollCoordinator";
import type { EnvBindings } from "../platform/Env";
import {
  authorizeOperator,
  logDeniedAdminMutation,
  requiredAdminScopes,
  toAuthErrorResponse
} from "./operatorAuth";

export const fetch = async (request: Request, env: EnvBindings) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  if (url.pathname.startsWith("/admin/ingest/")) {
    let identity;

    try {
      identity = await Effect.runPromise(
        authorizeOperator(request, env, requiredAdminScopes(request))
      );
    } catch (error) {
      await logDeniedAdminMutation(request, error);
      return toAuthErrorResponse(error);
    }

    return handleIngestRequest(request, env, identity);
  }

  return new Response("not found", { status: 404 });
};

export const scheduled = async (
  _controller: ScheduledController,
  env: EnvBindings,
  _ctx: ExecutionContext
) => {
  const layer = makeIngestLayer(env);

  await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(PollCoordinator, (coordinator) =>
        coordinator.run({ mode: "head" })
      ).pipe(
        Effect.provide(layer),
        Effect.catchTag("PollerBusyError", (error: PollerBusyError) =>
          Effect.logInfo("scheduled poll skipped").pipe(
            Effect.annotateLogs({
              lease: error.lease,
              reason: error.message
            })
          )
        )
      )
    )
  );
};

export default {
  fetch,
  scheduled
};
