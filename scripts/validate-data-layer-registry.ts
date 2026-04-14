/**
 * On-demand validator for the checked-in data layer registry.
 *
 * Loads `references/cold-start/` end-to-end via the same loader the runtime
 * uses, then runs invariant checks that used to live in
 * `tests/data-layer-registry.test.ts`. Those checks scaled with the catalog
 * (now ~7000 files) and were no longer appropriate for the test runner.
 *
 * Usage:
 *   bun scripts/validate-data-layer-registry.ts
 *
 * Exits non-zero on any failed invariant. Designed to be run manually before
 * merging catalog changes, or as a separate CI job that does not block the
 * unit-test run.
 */

import { Chunk, Effect } from "effect";
import { loadCheckedInDataLayerRegistry } from "../src/bootstrap/CheckedInDataLayerRegistry";
import type { Agent } from "../src/domain/data-layer";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

interface PublisherSpec {
  readonly label: string;
  readonly minVariables: number;
}

const BACKFILLED_PUBLISHERS: ReadonlyArray<PublisherSpec> = [
  { label: "International Renewable Energy Agency", minVariables: 1 },
  { label: "California Independent System Operator", minVariables: 1 },
  { label: "U.S. Energy Information Administration", minVariables: 1 },
  { label: "PJM Interconnection", minVariables: 1 },
  { label: "Electric Reliability Council of Texas", minVariables: 1 }
];

interface CheckFailure {
  readonly check: string;
  readonly message: string;
}

const buildAgentIdByLabel = (
  agents: ReadonlyArray<Agent>
): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const agent of agents) {
    map.set(agent.name, agent.id);
    for (const alt of agent.alternateNames ?? []) {
      map.set(alt, agent.id);
    }
  }
  return map;
};

const validateBackfilledPublishers = (
  prepared: Awaited<ReturnType<typeof loadCheckedInDataLayerRegistry>> extends Effect.Effect<infer R, any, any>
    ? R
    : never
): ReadonlyArray<CheckFailure> => {
  const failures: Array<CheckFailure> = [];
  const agentIdByLabel = buildAgentIdByLabel(prepared.seed.agents);

  for (const publisher of BACKFILLED_PUBLISHERS) {
    const agentId = agentIdByLabel.get(publisher.label);
    if (agentId === undefined) {
      failures.push({
        check: "backfilled-publisher-present",
        message: `publisher "${publisher.label}" missing from agents`
      });
      continue;
    }
    const shelf = prepared.variablesByAgentId.get(agentId);
    const size = shelf === undefined ? 0 : Chunk.size(shelf);
    if (size < publisher.minVariables) {
      failures.push({
        check: "backfilled-publisher-shelf",
        message: `publisher "${publisher.label}" has ${size} variable(s); expected at least ${publisher.minVariables}`
      });
    }
  }

  return failures;
};

const validateNoDuplicateVariablesPerAgent = (
  prepared: Awaited<ReturnType<typeof loadCheckedInDataLayerRegistry>> extends Effect.Effect<infer R, any, any>
    ? R
    : never
): ReadonlyArray<CheckFailure> => {
  const failures: Array<CheckFailure> = [];
  for (const agent of prepared.seed.agents) {
    const shelf = prepared.variablesByAgentId.get(agent.id);
    if (shelf === undefined) continue;
    const ids = Array.from(shelf, (v) => v.id);
    const unique = new Set(ids);
    if (ids.length !== unique.size) {
      failures.push({
        check: "agent-shelf-unique",
        message: `agent "${agent.name}" has ${ids.length - unique.size} duplicate variable(s) in shelf`
      });
    }
  }
  return failures;
};

const main = Effect.fn("ValidateDataLayerRegistry.main")(function* () {
  yield* Logging.logSummary("loading checked-in data layer registry");
  const prepared = yield* loadCheckedInDataLayerRegistry();

  yield* Logging.logSummary("registry loaded", {
    agents: prepared.seed.agents.length,
    catalogs: prepared.seed.catalogs.length,
    catalogRecords: prepared.seed.catalogRecords.length,
    datasets: prepared.seed.datasets.length,
    distributions: prepared.seed.distributions.length,
    dataServices: prepared.seed.dataServices.length,
    datasetSeries: prepared.seed.datasetSeries.length,
    variables: prepared.seed.variables.length,
    series: prepared.seed.series.length
  });

  const failures: Array<CheckFailure> = [
    ...validateBackfilledPublishers(prepared),
    ...validateNoDuplicateVariablesPerAgent(prepared)
  ];

  if (failures.length === 0) {
    yield* Logging.logSummary("all data layer registry invariants passed");
    return;
  }

  yield* Logging.logWarning("data layer registry invariants failed", {
    failureCount: failures.length,
    failures
  });
  yield* Effect.fail(
    new Error(`data layer registry validation failed (${failures.length} invariant(s))`)
  );
});

if (import.meta.main) {
  runScriptMain(
    "ValidateDataLayerRegistry",
    main().pipe(Effect.provide(scriptPlatformLayer))
  );
}
