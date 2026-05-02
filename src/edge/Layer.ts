import { D1Client } from "@effect/sql-d1";
import { Effect, Layer } from "effect";
import {
  AiSearchClient,
  EntityGraphRepoD1,
  EntityProjectionDrainService,
  EntityProjectionRegistry,
  ENTITY_PROJECTION_SPECS,
  EntitySnapshotStoreD1,
  makeAiSearchClient,
  ReindexQueueD1
} from "@skygest/ontology-store";
import { AuthService } from "../auth/AuthService";
import { d1DataLayerRegistryLayer } from "../bootstrap/D1DataLayerRegistry";
import { BlueskyClient, layer as BlueskyClientLayer } from "../bluesky/BlueskyClient";
import { RepoRecordsClient } from "../bluesky/RepoRecordsClient";
import { ExpertPollExecutor } from "../ingest/ExpertPollExecutor";
import { IngestRepairService } from "../ingest/IngestRepairService";
import { IngestWorkflowLauncher } from "../ingest/IngestWorkflowLauncher";
import { AppConfig } from "../platform/Config";
import {
  CloudflareEnv,
  EnvError,
  type EnvBindings,
  makeWorkflowEnrichmentEnvLayer,
  makeWorkflowIngestEnvLayer,
  requireWorkflowEnrichmentEnv,
  type WorkflowIngestEnvBindings
} from "../platform/Env";
import { Logging } from "../platform/Logging";
import { ExpertRegistryService } from "../services/ExpertRegistryService";
import { EntityExpertBackfillService } from "../services/EntityExpertBackfillService";
import { EntityPostBackfillService } from "../services/EntityPostBackfillService";
import { EntityTopicBackfillService } from "../services/EntityTopicBackfillService";
import { CandidatePayloadService } from "../services/CandidatePayloadService";
import { CurationService } from "../services/CurationService";
import { DataRefQueryService } from "../services/DataRefQueryService";
import { PostHydrationService } from "../services/PostHydrationService";
import { CurationRepoD1 } from "../services/d1/CurationRepoD1";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { OntologyCatalog } from "../services/OntologyCatalog";
import { PostImportService } from "../services/PostImportService";
import { StagingOpsService } from "../services/StagingOpsService";
import { CandidatePayloadRepoD1 } from "../services/d1/CandidatePayloadRepoD1";
import { DataRefCandidateReadRepoD1 } from "../services/d1/DataRefCandidateReadRepoD1";
import { DataLayerReposD1 } from "../services/d1/DataLayerReposD1";
import { EnrichmentRunsRepoD1 } from "../services/d1/EnrichmentRunsRepoD1";
import { ExpertSyncStateRepoD1 } from "../services/d1/ExpertSyncStateRepoD1";
import { EditorialPickBundleReadService } from "../services/EditorialPickBundleReadService";
import { EditorialService } from "../services/EditorialService";
import { EditorialRepoD1 } from "../services/d1/EditorialRepoD1";
import { ExpertsRepoD1 } from "../services/d1/ExpertsRepoD1";
import { IngestRunItemsRepoD1 } from "../services/d1/IngestRunItemsRepoD1";
import { IngestRunsRepoD1 } from "../services/d1/IngestRunsRepoD1";
import { KnowledgeRepoD1 } from "../services/d1/KnowledgeRepoD1";
import { PipelineStatusRepoD1 } from "../services/d1/PipelineStatusRepoD1";
import { PostEnrichmentReadRepoD1 } from "../services/d1/PostEnrichmentReadRepoD1";
import { PublicationsRepoD1 } from "../services/d1/PublicationsRepoD1";
import { ProviderRegistry } from "../services/ProviderRegistry";
import { EnrichmentWorkflowLauncher } from "../enrichment/EnrichmentWorkflowLauncher";
import { PipelineStatusService } from "../services/PipelineStatusService";
import { PostEnrichmentReadService } from "../services/PostEnrichmentReadService";

const makeBaseLayer = (env: EnvBindings) =>
  Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["DB"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );

const buildSharedWorkerParts = (env: EnvBindings) => {
  const baseLayer = makeBaseLayer(env);
  const configLayer = AppConfig.layer.pipe(Layer.provideMerge(baseLayer));
  const ontologyLayer = OntologyCatalog.layer;
  const providerRegistryLayer = ProviderRegistry.layer;
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const publicationsLayer = PublicationsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const editorialRepoLayer = EditorialRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const candidatePayloadRepoLayer = CandidatePayloadRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const candidatePayloadServiceLayer = CandidatePayloadService.layer.pipe(
    Layer.provideMerge(candidatePayloadRepoLayer)
  );
  const postEnrichmentReadRepoLayer = PostEnrichmentReadRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const pipelineStatusRepoLayer = PipelineStatusRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const enrichmentRunsLayer = env.ENRICHMENT_RUN_WORKFLOW == null
    ? null
    : EnrichmentRunsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const enrichmentWorkflowEnvLayer = env.ENRICHMENT_RUN_WORKFLOW == null
    ? null
    : makeWorkflowEnrichmentEnvLayer(requireWorkflowEnrichmentEnv(env));
  const enrichmentLauncherLayer =
    enrichmentRunsLayer === null || enrichmentWorkflowEnvLayer === null
      ? null
      : EnrichmentWorkflowLauncher.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              baseLayer,
              enrichmentWorkflowEnvLayer,
              enrichmentRunsLayer
            )
          )
        );
  const enrichmentReadServiceLayer =
    enrichmentRunsLayer === null
      ? PostEnrichmentReadService.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              candidatePayloadServiceLayer,
              postEnrichmentReadRepoLayer
            )
          )
        )
      : PostEnrichmentReadService.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              candidatePayloadServiceLayer,
              postEnrichmentReadRepoLayer,
              enrichmentRunsLayer
            )
          )
        );
  const pipelineStatusServiceLayer = PipelineStatusService.layer.pipe(
    Layer.provideMerge(pipelineStatusRepoLayer)
  );
  const entitySnapshotStoreLayer = EntitySnapshotStoreD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const reindexQueueLayer = ReindexQueueD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const entityGraphRepoLayer = EntityGraphRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const entityProjectionRegistryLayer =
    EntityProjectionRegistry.snapshotLayer(ENTITY_PROJECTION_SPECS).pipe(
      Layer.provideMerge(entitySnapshotStoreLayer)
    );
  const aiSearchClientLayer = Layer.effect(
    AiSearchClient,
    CloudflareEnv.use((runtimeEnv) =>
      runtimeEnv.ENERGY_INTEL_SEARCH === undefined
        ? Effect.fail(new EnvError({ missing: "ENERGY_INTEL_SEARCH" }))
        : Effect.succeed(makeAiSearchClient(runtimeEnv.ENERGY_INTEL_SEARCH))
    )
  ).pipe(Layer.provideMerge(baseLayer));
  const entityProjectionDrainLayer =
    EntityProjectionDrainService.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          reindexQueueLayer,
          entityProjectionRegistryLayer,
          aiSearchClientLayer
        )
      )
    );
  const entityExpertBackfillLayer = EntityExpertBackfillService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        expertsLayer,
        entitySnapshotStoreLayer,
        reindexQueueLayer,
        entityGraphRepoLayer
      )
    )
  );
  const entityPostBackfillLayer = EntityPostBackfillService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        baseLayer,
        ontologyLayer,
        expertsLayer,
        entitySnapshotStoreLayer,
        reindexQueueLayer,
        entityGraphRepoLayer
      )
    )
  );
  const entityTopicBackfillLayer = EntityTopicBackfillService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ontologyLayer,
        entitySnapshotStoreLayer,
        reindexQueueLayer
      )
    )
  );
  const curationRepoLayer = CurationRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const dataLayerReposLayer = DataLayerReposD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const dataLayerRegistryLayer = d1DataLayerRegistryLayer().pipe(
    Layer.provideMerge(dataLayerReposLayer)
  );
  const dataRefCandidateReadRepoLayer = DataRefCandidateReadRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const dataRefQueryServiceLayer = DataRefQueryService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(configLayer, dataLayerRegistryLayer, dataRefCandidateReadRepoLayer)
    )
  );
  const queryRepositoriesLayer = Layer.mergeAll(
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
    editorialRepoLayer,
    candidatePayloadRepoLayer,
    dataLayerReposLayer,
    dataRefCandidateReadRepoLayer
  );
  const editorialServiceLayer = EditorialService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(editorialRepoLayer, configLayer, ontologyLayer))
  );
  const editorialPickBundleReadServiceLayer = EditorialPickBundleReadService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        editorialRepoLayer,
        candidatePayloadServiceLayer,
        enrichmentReadServiceLayer,
        expertsLayer
      )
    )
  );
  const blueskyLayer = BlueskyClientLayer.pipe(
    Layer.provideMerge(configLayer)
  );
  const postHydrationLayer = PostHydrationService.layer.pipe(
    Layer.provideMerge(blueskyLayer)
  );
  const curationServiceLayer = CurationService.layer.pipe(
    Layer.provideMerge(
      enrichmentLauncherLayer === null
        ? Layer.mergeAll(
            curationRepoLayer,
            expertsLayer,
            publicationsLayer,
            candidatePayloadServiceLayer,
            blueskyLayer,
            configLayer
          )
        : Layer.mergeAll(
            curationRepoLayer,
            expertsLayer,
            publicationsLayer,
            candidatePayloadServiceLayer,
            blueskyLayer,
            configLayer,
            enrichmentLauncherLayer
          )
    )
  );
  const postImportServiceLayer = PostImportService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        configLayer,
        ontologyLayer,
        expertsLayer,
        knowledgeLayer,
        candidatePayloadServiceLayer,
        curationServiceLayer
      )
    )
  );
  const registryLayer = ExpertRegistryService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(configLayer, expertsLayer, blueskyLayer, ontologyLayer)
    )
  );
  const queryLayer = Layer.mergeAll(
    queryRepositoriesLayer,
    configLayer,
    providerRegistryLayer,
    blueskyLayer,
    postHydrationLayer,
    candidatePayloadServiceLayer,
    enrichmentReadServiceLayer,
    pipelineStatusServiceLayer,
    postImportServiceLayer,
    registryLayer,
    KnowledgeQueryService.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(queryRepositoriesLayer, configLayer))
    ),
    dataRefQueryServiceLayer,
    editorialServiceLayer,
    editorialPickBundleReadServiceLayer,
    curationServiceLayer
  );
  const authLayer = AuthService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(baseLayer, configLayer))
  );
  const stagingOpsLayer = StagingOpsService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        configLayer,
        ontologyLayer,
        providerRegistryLayer,
        expertsLayer,
        knowledgeLayer,
        registryLayer,
        publicationsLayer,
        curationServiceLayer
      )
    )
  );
  const adminLayer = enrichmentLauncherLayer === null
    ? Layer.mergeAll(
        baseLayer,
        configLayer,
        ontologyLayer,
        providerRegistryLayer,
        expertsLayer,
        knowledgeLayer,
        publicationsLayer,
        queryLayer,
        blueskyLayer,
        authLayer,
        registryLayer,
        stagingOpsLayer,
        editorialServiceLayer,
        editorialPickBundleReadServiceLayer,
        candidatePayloadServiceLayer,
        enrichmentReadServiceLayer,
        pipelineStatusServiceLayer,
        curationServiceLayer,
        pipelineStatusServiceLayer,
        postImportServiceLayer,
        dataLayerReposLayer,
        entityExpertBackfillLayer,
        entityPostBackfillLayer,
        entityTopicBackfillLayer,
        entityProjectionDrainLayer
      )
    : Layer.mergeAll(
        baseLayer,
        configLayer,
        ontologyLayer,
        providerRegistryLayer,
        expertsLayer,
        knowledgeLayer,
        publicationsLayer,
        queryLayer,
        blueskyLayer,
        authLayer,
        registryLayer,
        stagingOpsLayer,
        editorialServiceLayer,
        editorialPickBundleReadServiceLayer,
        candidatePayloadServiceLayer,
        enrichmentReadServiceLayer,
        pipelineStatusServiceLayer,
        curationServiceLayer,
        postImportServiceLayer,
        dataLayerReposLayer,
        entityExpertBackfillLayer,
        entityPostBackfillLayer,
        entityTopicBackfillLayer,
        entityProjectionDrainLayer,
        enrichmentLauncherLayer
      );

  return {
    baseLayer,
    configLayer,
    ontologyLayer,
    providerRegistryLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
    candidatePayloadRepoLayer,
    candidatePayloadServiceLayer,
    postEnrichmentReadRepoLayer,
    enrichmentReadServiceLayer,
    pipelineStatusRepoLayer,
    pipelineStatusServiceLayer,
    entitySnapshotStoreLayer,
    reindexQueueLayer,
    entityGraphRepoLayer,
    entityProjectionRegistryLayer,
    aiSearchClientLayer,
    entityProjectionDrainLayer,
    entityExpertBackfillLayer,
    entityPostBackfillLayer,
    entityTopicBackfillLayer,
    postImportServiceLayer,
    curationRepoLayer,
    dataLayerReposLayer,
    dataRefCandidateReadRepoLayer,
    dataRefQueryServiceLayer,
    curationServiceLayer,
    queryLayer,
    blueskyLayer,
    authLayer,
    registryLayer,
    stagingOpsLayer,
    adminLayer
  };
};

let cachedSharedWorkerParts: {
  readonly env: EnvBindings;
  readonly parts: ReturnType<typeof buildSharedWorkerParts>;
} | null = null;

const getSharedWorkerParts = (env: EnvBindings) => {
  if (cachedSharedWorkerParts !== null && cachedSharedWorkerParts.env === env) {
    return cachedSharedWorkerParts.parts;
  }

  const parts = buildSharedWorkerParts(env);
  cachedSharedWorkerParts = { env, parts };
  return parts;
};

const buildWorkflowWorkerParts = (env: WorkflowIngestEnvBindings) => {
  const shared = getSharedWorkerParts(env);
  const workflowEnvLayer = makeWorkflowIngestEnvLayer(env);
  const syncStateLayer = ExpertSyncStateRepoD1.layer.pipe(
    Layer.provideMerge(shared.baseLayer)
  );
  const runsLayer = IngestRunsRepoD1.layer.pipe(
    Layer.provideMerge(shared.baseLayer)
  );
  const runItemsLayer = IngestRunItemsRepoD1.layer.pipe(
    Layer.provideMerge(shared.baseLayer)
  );
  const repoRecordsLayer = RepoRecordsClient.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(shared.blueskyLayer, syncStateLayer)
    )
  );
  const expertPollExecutorLayer = ExpertPollExecutor.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        shared.baseLayer,
        shared.ontologyLayer,
        shared.expertsLayer,
        shared.knowledgeLayer,
        shared.curationServiceLayer,
        repoRecordsLayer,
        syncStateLayer
      )
    )
  );
  const workflowLauncherLayer = IngestWorkflowLauncher.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(shared.baseLayer, workflowEnvLayer, runsLayer)
    )
  );
  const ingestRepairLayer = IngestRepairService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(runsLayer, runItemsLayer)
    )
  );
  const ingestLayer = Layer.mergeAll(
    shared.baseLayer,
    shared.configLayer,
    shared.ontologyLayer,
    shared.expertsLayer,
    shared.knowledgeLayer,
    shared.queryLayer,
    workflowEnvLayer,
    syncStateLayer,
    runsLayer,
    runItemsLayer,
    shared.blueskyLayer,
    repoRecordsLayer,
    expertPollExecutorLayer,
    workflowLauncherLayer,
    ingestRepairLayer
  );

  return {
    ...shared,
    workflowEnvLayer,
    syncStateLayer,
    runsLayer,
    runItemsLayer,
    repoRecordsLayer,
    expertPollExecutorLayer,
    workflowLauncherLayer,
    ingestRepairLayer,
    ingestLayer
  };
};

let cachedWorkflowWorkerParts: {
  readonly env: WorkflowIngestEnvBindings;
  readonly parts: ReturnType<typeof buildWorkflowWorkerParts>;
} | null = null;

const getWorkflowWorkerParts = (env: WorkflowIngestEnvBindings) => {
  if (
    cachedWorkflowWorkerParts !== null &&
    cachedWorkflowWorkerParts.env === env
  ) {
    return cachedWorkflowWorkerParts.parts;
  }

  const parts = buildWorkflowWorkerParts(env);
  cachedWorkflowWorkerParts = { env, parts };
  return parts;
};

export const makeQueryLayer = (env: EnvBindings) =>
  getSharedWorkerParts(env).queryLayer;

export const makeAuthLayer = (env: EnvBindings) =>
  getSharedWorkerParts(env).authLayer;

export const makeAdminWorkerLayer = (env: EnvBindings) =>
  getSharedWorkerParts(env).adminLayer;

export const makeIngestWorkerLayer = (env: WorkflowIngestEnvBindings) =>
  getWorkflowWorkerParts(env).ingestLayer;
