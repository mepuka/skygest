import { Effect, Layer } from "effect";
import * as HttpApp from "@effect/platform/HttpApp";
import * as HttpRouter from "@effect/platform/HttpRouter";
import { app as feedApp } from "../feed/FeedRouter";
import { app as mcpApp } from "../mcp/Router";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { FeedCacheKv } from "../services/kv/FeedCacheKv";
import { AuthService } from "../auth/AuthService";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { InteractionsRepoD1 } from "../services/d1/InteractionsRepoD1";
import { AccessRepoD1 } from "../services/d1/AccessRepoD1";
import { D1Client } from "@effect/sql-d1";
import { JetstreamIngestorDo } from "../ingest/IngestorDo";

export { JetstreamIngestorDo };

const app = feedApp.pipe(HttpRouter.mount("/mcp", mcpApp));

export const fetch = (request: Request, env: EnvBindings, _ctx: ExecutionContext) => {
  const url = new URL(request.url);
  if (url.pathname === "/internal/ingest/start") {
    const id = env.JETSTREAM_INGESTOR.idFromName("main");
    const stub = env.JETSTREAM_INGESTOR.get(id);
    return stub.fetch("https://ingest/start");
  }

  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env),
    D1Client.layer({ db: env.DB })
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
