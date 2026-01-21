import { Effect } from "effect";
import * as HttpApp from "@effect/platform/HttpApp";
import { app as feedApp } from "../feed/FeedRouter";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { D1Client } from "@effect/sql-d1";
import { JetstreamIngestorDo } from "../ingest/IngestorDo";

export { JetstreamIngestorDo };

export const fetch = (request: Request, env: EnvBindings, _ctx: ExecutionContext) => {
  const url = new URL(request.url);
  if (url.pathname === "/internal/ingest/start") {
    const id = env.JETSTREAM_INGESTOR.idFromName("main");
    const stub = env.JETSTREAM_INGESTOR.get(id);
    return stub.fetch("https://ingest/start");
  }

  return HttpApp.toWebHandler(
    feedApp.pipe(
      Effect.provide(CloudflareEnv.layer(env)),
      Effect.provide(AppConfig.layer),
      Effect.provide(PostsRepoD1.layer),
      Effect.provide(D1Client.layer({ db: env.DB }))
    )
  )(request);
};
