import { D1Client } from "@effect/sql-d1";
import { Layer } from "effect";
import { d1DataLayerRegistryLayer } from "../bootstrap/D1DataLayerRegistry";
import { EnrichmentPlanner } from "../enrichment/EnrichmentPlanner";
import { CloudflareEnv, type ResolverWorkerEnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";
import { ResolutionKernel } from "../resolution/ResolutionKernel";
import { FacetVocabulary } from "../resolution/facetVocabulary";
import { Stage1Resolver } from "../resolution/Stage1Resolver";
import { makeEntitySearchBaseLayer } from "../search/Layer";
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
  const facetVocabularyLayer = FacetVocabulary.layer;
  const resolutionKernelLayer = ResolutionKernel.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(registryLayer, facetVocabularyLayer))
  );
  const entitySearchBaseLayer = makeEntitySearchBaseLayer(env);
  const entitySearchRepoLayer = EntitySearchRepoD1.layer.pipe(
    Layer.provideMerge(entitySearchBaseLayer)
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
        resolutionKernelLayer,
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
    facetVocabularyLayer,
    stage1ResolverLayer,
    resolutionKernelLayer,
    entitySearchBaseLayer,
    entitySearchRepoLayer,
    entitySearchSemanticRecallLayer,
    entitySearchServiceLayer,
    resolverServiceLayer
  );
};
