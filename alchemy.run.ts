import alchemy, { type } from "alchemy";
import {
  AiSearch,
  AiSearchNamespace,
  Assets,
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  R2Bucket,
  Worker,
  Workflow
} from "alchemy/cloudflare";

import {
  ENERGY_INTEL_SEARCH_BINDING,
  ENERGY_INTEL_SEARCH_INSTANCE,
  ENERGY_INTEL_SEARCH_NAMESPACE,
  ENTITY_SEARCH_CUSTOM_METADATA
} from "@skygest/ontology-store";

import { ensureAiSearchCustomMetadata } from "./alchemy/ai-search-metadata";
import type { EnrichmentRunParams } from "./src/domain/enrichmentRun";
import type { IngestRunParams } from "./src/domain/polling";
import type { ExpertPollCoordinatorDo } from "./src/ingest/ExpertPollCoordinatorDo";
import type { ResolverEntrypoint } from "./src/resolver-worker";
import type { EnrichmentEntrypoint } from "./src/worker/filter";

const ACCOUNT_ID = "af578620f2ff4eae2042c031be82f7e7";
const COMPATIBILITY_DATE = "2026-04-28";

type DeploymentConfig = {
  readonly workerSuffix: string;
  readonly databaseName: string;
  readonly searchDatabaseName?: string;
  readonly transcriptsBucketName: string;
  readonly resolverWorkerName: string;
  readonly ingestWorkerName: string;
  readonly agentWorkerName: string;
  readonly ingestCrons: ReadonlyArray<string>;
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
  resolverWorkerName: "skygest-resolver-staging",
  ingestWorkerName: "skygest-bi-ingest-staging",
  agentWorkerName: "skygest-bi-agent-staging",
  ingestCrons: [],
  ingestVars: {
    ...baseVars,
    ENABLE_STAGING_OPS: "true",
    ENABLE_DATA_REF_RESOLUTION: "true",
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
  resolverWorkerName: "skygest-resolver",
  ingestWorkerName: "skygest-bi-ingest",
  agentWorkerName: "skygest-bi-agent",
  ingestCrons: ["*/15 * * * *"],
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
  adopt: true
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
      name: ENERGY_INTEL_SEARCH_NAMESPACE,
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

export const entitySearch = await AiSearch("entity-search", {
  ...apiOptions,
  name: ENERGY_INTEL_SEARCH_INSTANCE,
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
  namespace: ENERGY_INTEL_SEARCH_NAMESPACE,
  instanceName: entitySearch.name,
  customMetadata: ENTITY_SEARCH_CUSTOM_METADATA
});

const searchDbBinding = searchDb === undefined ? {} : { SEARCH_DB: searchDb };

export const resolverWorker = await Worker("resolver", {
  ...apiOptions,
  name: config.resolverWorkerName,
  entrypoint: "src/resolver-worker/index.ts",
  adopt: true,
  delete: false,
  rpc: type<ResolverEntrypoint>,
  compatibilityDate: COMPATIBILITY_DATE,
  observability: { enabled: true },
  bindings: {
    DB: db,
    ...searchDbBinding
  },
  bundle: {
    format: "esm",
    target: "es2022"
  }
});

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
    RESOLVER: resolverWorker,
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
    RESOLVER: resolverWorker,
    [ENERGY_INTEL_SEARCH_BINDING]: energyIntelSearch,
    ASSETS: await Assets({ path: "./dist" }),
    ...config.agentVars
  },
  bundle: {
    format: "esm",
    target: "es2022"
  }
});

export type ResolverEnv = typeof resolverWorker.Env;
export type IngestEnv = typeof ingestWorker.Env;
export type AgentEnv = typeof agentWorker.Env;

await app.finalize();
