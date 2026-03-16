import { D1Client } from "@effect/sql-d1";
import { Layer } from "effect";
import { AuthService } from "../auth/AuthService";
import { BlueskyClient, layer as BlueskyClientLayer } from "../bluesky/BlueskyClient";
import { RepoRecordsClient } from "../bluesky/RepoRecordsClient";
import { ExpertPollExecutor } from "../ingest/ExpertPollExecutor";
import { IngestRepairService } from "../ingest/IngestRepairService";
import { IngestWorkflowLauncher } from "../ingest/IngestWorkflowLauncher";
import { AppConfig } from "../platform/Config";
import {
  CloudflareEnv,
  type EnvBindings,
  makeWorkflowIngestEnvLayer,
  type WorkflowIngestEnvBindings
} from "../platform/Env";
import { Logging } from "../platform/Logging";
import { ExpertRegistryService } from "../services/ExpertRegistryService";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { OntologyCatalog } from "../services/OntologyCatalog";
import { StagingOpsService } from "../services/StagingOpsService";
import { ExpertSyncStateRepoD1 } from "../services/d1/ExpertSyncStateRepoD1";
import { EditorialService } from "../services/EditorialService";
import { EditorialRepoD1 } from "../services/d1/EditorialRepoD1";
import { ExpertsRepoD1 } from "../services/d1/ExpertsRepoD1";
import { IngestRunItemsRepoD1 } from "../services/d1/IngestRunItemsRepoD1";
import { IngestRunsRepoD1 } from "../services/d1/IngestRunsRepoD1";
import { KnowledgeRepoD1 } from "../services/d1/KnowledgeRepoD1";
import { PublicationsRepoD1 } from "../services/d1/PublicationsRepoD1";

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
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const publicationsLayer = PublicationsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const editorialRepoLayer = EditorialRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const queryRepositoriesLayer = Layer.mergeAll(
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
    editorialRepoLayer
  );
  const editorialServiceLayer = EditorialService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(editorialRepoLayer, configLayer, ontologyLayer))
  );
  const queryLayer = Layer.mergeAll(
    queryRepositoriesLayer,
    configLayer,
    KnowledgeQueryService.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(queryRepositoriesLayer, configLayer))
    ),
    editorialServiceLayer
  );
  const blueskyLayer = BlueskyClientLayer.pipe(
    Layer.provideMerge(configLayer)
  );
  const authLayer = AuthService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(baseLayer, configLayer))
  );
  const registryLayer = ExpertRegistryService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(configLayer, expertsLayer, blueskyLayer, ontologyLayer)
    )
  );
  const stagingOpsLayer = StagingOpsService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        configLayer,
        ontologyLayer,
        expertsLayer,
        knowledgeLayer,
        registryLayer,
        publicationsLayer
      )
    )
  );
  const adminLayer = Layer.mergeAll(
    baseLayer,
    configLayer,
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
    queryLayer,
    blueskyLayer,
    authLayer,
    registryLayer,
    stagingOpsLayer,
    editorialServiceLayer
  );

  return {
    baseLayer,
    configLayer,
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
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
