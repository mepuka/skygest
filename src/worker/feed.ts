import { Effect, Layer } from "effect";
import * as HttpApp from "@effect/platform/HttpApp";
import * as HttpRouter from "@effect/platform/HttpRouter";
import { app as feedApp } from "../feed/FeedRouter";
import { app as mcpApp } from "../mcp/Router";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { Logging } from "../platform/Logging";
import { FeedCacheKv } from "../services/kv/FeedCacheKv";
import { AuthService } from "../auth/AuthService";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { InteractionsRepoD1 } from "../services/d1/InteractionsRepoD1";
import { AccessRepoD1 } from "../services/d1/AccessRepoD1";
import { D1Client } from "@effect/sql-d1";
import { JetstreamIngestorDoV2 } from "../ingest/IngestorDo";

export { JetstreamIngestorDoV2 };

const app = feedApp.pipe(HttpRouter.mount("/mcp", mcpApp));

export const fetch = async (request: Request, env: EnvBindings, _ctx: ExecutionContext) => {
  const url = new URL(request.url);
  if (url.pathname === "/internal/ingest/start") {
    const id = env.JETSTREAM_INGESTOR.idFromName("main");
    const stub = env.JETSTREAM_INGESTOR.get(id);
    return stub.fetch("https://ingest/start");
  }

  if (url.pathname === "/internal/dispatch/trigger") {
    const did = url.searchParams.get("did");
    if (!did) {
      return new Response("Missing did parameter", { status: 400 });
    }
    const message = { users: [did], batchId: Date.now(), generateAgg: false };
    await env.FEED_GEN.send(message, { contentType: "json" });
    return new Response(`Triggered feed generation for ${did}`);
  }

  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const appLayer = Layer.mergeAll(
    AppConfig.layer,
    FeedCacheKv.layer,
    AuthService.layer,
    PostsRepoD1.layer,
    UsersRepoD1.layer,
    InteractionsRepoD1.layer,
    AccessRepoD1.layer
  );

  return HttpApp.toWebHandler(
    app.pipe(Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer))))
  )(request);
};

export default { fetch };
