import alchemy, { type } from "alchemy";
import { CloudflareStateStore } from "alchemy/state";
import {
  AiSearch,
  AiSearchNamespace,
  AnalyticsEngineDataset,
  Assets,
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  R2Bucket,
  VersionMetadata,
  Worker,
  Workflow
} from "alchemy/cloudflare";
import { Effect } from "effect";

import {
  ENTITY_PROJECTION_FIXTURES,
  ENTITY_PROVISIONING,
  assertNoMetadataDrift,
  defineUnifiedEntitySearchProvisioning
} from "@skygest/ontology-store";

import { ensureAiSearchCustomMetadata } from "./alchemy/ai-search-metadata";
import type { EnrichmentRunParams } from "./src/domain/enrichmentRun";
import type { IngestRunParams } from "./src/domain/polling";
import type { ExpertPollCoordinatorDo } from "./src/ingest/ExpertPollCoordinatorDo";
import type { EnrichmentEntrypoint } from "./src/worker/filter";

const ACCOUNT_ID = "af578620f2ff4eae2042c031be82f7e7";
const COMPATIBILITY_DATE = "2026-05-03";
const entitySearchProvisioning =
  defineUnifiedEntitySearchProvisioning(ENTITY_PROVISIONING);

await Effect.runPromise(assertNoMetadataDrift(ENTITY_PROJECTION_FIXTURES));

type DeploymentConfig = {
  readonly workerSuffix: string;
  readonly databaseName: string;
  readonly searchDatabaseName?: string;
  readonly transcriptsBucketName: string;
  readonly requestMetricsDatasetName: string;
  readonly ingestWorkerName: string;
  readonly agentWorkerName: string;
  readonly ingestCrons: ReadonlyArray<string>;
  readonly agentCrons: ReadonlyArray<string>;
  readonly ingestVars: Readonly<Record<string, string>>;
  readonly agentVars: Readonly<Record<string, string>>;
};

const baseVars = {
  PUBLIC_BSKY_API: "https://public.api.bsky.app",
  INGEST_SHARD_COUNT: "1",
  DEFAULT_DOMAIN: "energy",
  MCP_LIMIT_DEFAULT: "20",
  MCP_LIMIT_MAX: "100"
} as const;

const stagingConfig: DeploymentConfig = {
  workerSuffix: "-staging",
  databaseName: "skygest-staging",
  searchDatabaseName: "skygest-search-staging",
  transcriptsBucketName: "skygest-transcripts-staging",
  requestMetricsDatasetName: "skygest_request_metrics_staging",
  ingestWorkerName: "skygest-bi-ingest-staging",
  agentWorkerName: "skygest-bi-agent-staging",
  ingestCrons: [],
  agentCrons: ["*/2 * * * *"],
  ingestVars: {
    ...baseVars,
    ENABLE_STAGING_OPS: "true",
    GEMINI_VISION_MODEL: "gemini-3-flash-preview"
  },
  agentVars: {
    ...baseVars,
    ENABLE_STAGING_OPS: "true"
  }
};

const productionConfig: DeploymentConfig = {
  workerSuffix: "",
  databaseName: "skygest",
  transcriptsBucketName: "skygest-transcripts",
  requestMetricsDatasetName: "skygest_request_metrics",
  ingestWorkerName: "skygest-bi-ingest",
  agentWorkerName: "skygest-bi-agent",
  ingestCrons: ["*/15 * * * *"],
  agentCrons: [],
  ingestVars: {
    ...baseVars,
    GEMINI_VISION_MODEL: "gemini-2.5-flash"
  },
  agentVars: baseVars
};

const resolveConfig = (stage: string): DeploymentConfig => {
  if (stage === "staging") return stagingConfig;
  if (stage === "production" || stage === "prod") return productionConfig;
  throw new Error(
    `Unsupported Alchemy stage "${stage}". Use --stage staging or --stage production so existing Cloudflare resources are adopted intentionally.`
  );
};

const app = await alchemy("skygest-cloudflare", {
  adopt: true,
  ...(process.env.ALCHEMY_PASSWORD === undefined ? {} : { password: process.env.ALCHEMY_PASSWORD }),
  stateStore: (scope) =>
    new CloudflareStateStore(scope, {
      accountId: ACCOUNT_ID
    })
});
const config = resolveConfig(app.stage);
const apiOptions = { accountId: ACCOUNT_ID };

const [db, ontologyKv, transcriptsBucket, energyIntelSearch] =
  await Promise.all([
    D1Database("skygest-db", {
      ...apiOptions,
      name: config.databaseName,
      adopt: true,
      delete: false,
      dev: { remote: true }
    }),
    KVNamespace("ontology-kv", {
      ...apiOptions,
      title: "ONTOLOGY_KV",
      adopt: true,
      delete: false,
      dev: { remote: true }
    }),
    R2Bucket("transcripts", {
      ...apiOptions,
      name: config.transcriptsBucketName,
      adopt: true,
      delete: false,
      dev: { remote: true }
    }),
    AiSearchNamespace("energy-intel-search", {
      ...apiOptions,
      name: entitySearchProvisioning.namespace,
      description: "Skygest energy intelligence entity search",
      adopt: true,
      delete: false
    })
  ]);

const searchDb =
  config.searchDatabaseName === undefined
    ? undefined
    : await D1Database("search-db", {
        ...apiOptions,
        name: config.searchDatabaseName,
        adopt: true,
        delete: false,
        dev: { remote: true }
      });

const ENTITY_SEARCH_RESOURCE_ID = "entity-search";

export const entitySearch = await AiSearch(ENTITY_SEARCH_RESOURCE_ID, {
  ...apiOptions,
  name: entitySearchProvisioning.instance,
  namespace: energyIntelSearch,
  adopt: true,
  delete: false,
  cache: false,
  chunk: true,
  indexMethod: { vector: true, keyword: true },
  fusionMethod: "rrf"
});

await ensureAiSearchCustomMetadata({
  apiOptions,
  resourceId: ENTITY_SEARCH_RESOURCE_ID,
  namespace: entitySearchProvisioning.namespace,
  instanceName: entitySearch.name,
  customMetadata: entitySearchProvisioning.customMetadata
});

const searchDbBinding = searchDb === undefined ? {} : { SEARCH_DB: searchDb };
const requestMetrics = AnalyticsEngineDataset("request-metrics", {
  dataset: config.requestMetricsDatasetName
});
const versionMetadata = VersionMetadata();

const expertPollCoordinator =
  DurableObjectNamespace<ExpertPollCoordinatorDo>("ExpertPollCoordinatorDo", {
    className: "ExpertPollCoordinatorDo",
    sqlite: true
  });

export const ingestWorker = await Worker("ingest", {
  ...apiOptions,
  name: config.ingestWorkerName,
  entrypoint: "src/worker/filter.ts",
  adopt: true,
  delete: false,
  rpc: type<EnrichmentEntrypoint>,
  compatibilityDate: COMPATIBILITY_DATE,
  observability: { enabled: true },
  crons: [...config.ingestCrons],
  bindings: {
    DB: db,
    ONTOLOGY_KV: ontologyKv,
    TRANSCRIPTS_BUCKET: transcriptsBucket,
    REQUEST_METRICS: requestMetrics,
    CF_VERSION_METADATA: versionMetadata,
    [entitySearchProvisioning.binding]: energyIntelSearch,
    INGEST_RUN_WORKFLOW: Workflow<IngestRunParams>("ingest-run", {
      workflowName: "ingest-run",
      className: "IngestRunWorkflow"
    }),
    ENRICHMENT_RUN_WORKFLOW: Workflow<EnrichmentRunParams>("enrichment-run", {
      workflowName: "enrichment-run",
      className: "EnrichmentRunWorkflow"
    }),
    EXPERT_POLL_COORDINATOR: expertPollCoordinator,
    ...config.ingestVars
  },
  bundle: {
    format: "esm",
    target: "es2022"
  }
});

export const agentWorker = await Worker("agent", {
  ...apiOptions,
  name: config.agentWorkerName,
  entrypoint: "src/worker/feed.ts",
  adopt: true,
  delete: false,
  compatibilityDate: COMPATIBILITY_DATE,
  observability: { enabled: true },
  crons: [...config.agentCrons],
  assets: {
    not_found_handling: "single-page-application",
    run_worker_first: ["/api/*", "/admin/*", "/mcp", "/health"]
  },
  bindings: {
    DB: db,
    ...searchDbBinding,
    ONTOLOGY_KV: ontologyKv,
    TRANSCRIPTS_BUCKET: transcriptsBucket,
    INGEST_SERVICE: ingestWorker,
    REQUEST_METRICS: requestMetrics,
    CF_VERSION_METADATA: versionMetadata,
    [entitySearchProvisioning.binding]: energyIntelSearch,
    ASSETS: await Assets({ path: "./dist" }),
    ...config.agentVars
  },
  bundle: {
    format: "esm",
    target: "es2022"
  }
});

export type IngestEnv = typeof ingestWorker.Env;
export type AgentEnv = typeof agentWorker.Env;

await app.finalize();
