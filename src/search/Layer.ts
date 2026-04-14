import { D1Client } from "@effect/sql-d1";
import { Effect, Layer, ServiceMap } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  CloudflareEnv,
  type SearchRuntimeEnvBindings
} from "../platform/Env";

export class EntitySearchSql extends ServiceMap.Service<
  EntitySearchSql,
  SqlClient.SqlClient
>()("@skygest/EntitySearchSql") {}

export const entitySearchSqlLayer = <E, R>(
  sqlLayer: Layer.Layer<SqlClient.SqlClient, E, R>
) =>
  Layer.effect(
    EntitySearchSql,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return EntitySearchSql.of(sql);
    })
  ).pipe(
    Layer.provideMerge(sqlLayer)
  );

export const makeEntitySearchBaseLayer = (
  env: SearchRuntimeEnvBindings
) => {
  const envLayer = CloudflareEnv.layer(env, { required: ["SEARCH_DB"] });
  const sqlLayer = entitySearchSqlLayer(D1Client.layer({ db: env.SEARCH_DB }));

  return Layer.mergeAll(envLayer, sqlLayer);
};
