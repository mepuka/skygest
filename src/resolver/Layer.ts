import { D1Client } from "@effect/sql-d1";
import { Layer } from "effect";
import { d1DataLayerRegistryLayer } from "../bootstrap/D1DataLayerRegistry";
import { EnrichmentPlanner } from "../enrichment/EnrichmentPlanner";
import {
  CloudflareEnv,
  type ResolverWorkerEnvBindings,
  type SearchRuntimeEnvBindings
} from "../platform/Env";
import { Logging } from "../platform/Logging";
import { Stage1Resolver } from "../resolution/Stage1Resolver";
import { makeEntitySearchBaseLayer } from "../search/Layer";
import {
  emptyEntitySearchRepoLayer
} from "../services/EntitySearchRepo";
import { CandidatePayloadRepoD1 } from "../services/d1/CandidatePayloadRepoD1";
import { DataLayerReposD1 } from "../services/d1/DataLayerReposD1";
import { EntitySearchRepoD1 } from "../services/d1/EntitySearchRepoD1";
import { EntitySearchService } from "../services/EntitySearchService";
import { EntitySemanticRecall } from "../services/EntitySemanticRecall";
import { ResolverService } from "./ResolverService";

export const makeResolverLayer = (env: ResolverWorkerEnvBindings) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["DB", "OPERATOR_SECRET"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const payloadsLayer = CandidatePayloadRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const plannerLayer = EnrichmentPlanner.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(baseLayer, payloadsLayer))
  );
  const dataLayerReposLayer = DataLayerReposD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const registryLayer = d1DataLayerRegistryLayer().pipe(
    Layer.provideMerge(Layer.mergeAll(baseLayer, dataLayerReposLayer))
  );
  const stage1ResolverLayer = Stage1Resolver.layer.pipe(
    Layer.provideMerge(registryLayer)
  );
  const entitySearchRepoLayer =
    env.SEARCH_DB === undefined
      ? emptyEntitySearchRepoLayer
      : EntitySearchRepoD1.layer.pipe(
          Layer.provideMerge(
            makeEntitySearchBaseLayer({
              ...env,
              SEARCH_DB: env.SEARCH_DB
            } satisfies SearchRuntimeEnvBindings)
          )
        );
  const entitySearchSemanticRecallLayer = EntitySemanticRecall.noneLayer;
  const entitySearchServiceLayer = EntitySearchService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        registryLayer,
        entitySearchRepoLayer,
        entitySearchSemanticRecallLayer
      )
    )
  );
  const resolverServiceLayer = ResolverService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        baseLayer,
        plannerLayer,
        stage1ResolverLayer,
        entitySearchServiceLayer
      )
    )
  );

  return Layer.mergeAll(
    baseLayer,
    payloadsLayer,
    plannerLayer,
    dataLayerReposLayer,
    registryLayer,
    stage1ResolverLayer,
    entitySearchRepoLayer,
    entitySearchSemanticRecallLayer,
    entitySearchServiceLayer,
    resolverServiceLayer
  );
};
