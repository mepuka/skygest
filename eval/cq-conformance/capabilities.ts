/**
 * v1 capability definitions for the CQ conformance harness.
 *
 * A *capability* is one named thing the resolver needs in order to bind a
 * Variable. Each capability has three lanes:
 *
 *   - `vocabulary`     — does the ontology declare the relationship?
 *                        (lifted verbatim from validation-report*.md)
 *   - `runtimeData`    — does the checked-in registry actually populate it?
 *                        (computed from `references/cold-start/`)
 *   - `workerBehavior` — does the kernel actually use it at bind time?
 *                        (static probe over kernel source files)
 *
 * Each capability lists the CQ ids that motivate it. The harness derives the
 * vocabulary-lane cell from those CQ ids + the parsed validation reports —
 * capability authors only write the runtimeData and workerBehavior probes.
 *
 * v1 covers six capabilities, picked specifically because each one explains
 * an observed gold-row failure mode in the current eval. Adding more is
 * cheap; the goal is to keep the matrix narrow enough that a red cell is
 * immediately actionable.
 */

import type {
  PreparedDataLayerRegistry
} from "../../src/resolution/dataLayerRegistry";
import type { FacetVocabularyShape } from "../../src/resolution/facetVocabulary";
import type { Variable } from "../../src/domain/data-layer";
import type { ExpectedKernelOutcome } from "../resolution-kernel/shared";
import type { BundleTrace } from "../resolution-kernel/shared";

// ---------------------------------------------------------------------------
// Lane and cell types
// ---------------------------------------------------------------------------

export type LaneStatus = "pass" | "amber" | "fail" | "n-a";

export type LaneCell = {
  readonly status: LaneStatus;
  readonly summary: string;
  readonly detail?: string;
  readonly metric?: number;
};

export type CapabilityLane = "vocabulary" | "runtimeData" | "workerBehavior";

export type CapabilityVerdict = {
  readonly capabilityId: string;
  readonly label: string;
  readonly description: string;
  readonly dependsOnCqIds: ReadonlyArray<string>;
  readonly lanes: {
    readonly vocabulary: LaneCell;
    readonly runtimeData: LaneCell;
    readonly workerBehavior: LaneCell;
  };
};

export type GoldRowCellState =
  | { readonly kind: "not-required"; readonly reason?: string }
  | {
      readonly kind: "required";
      readonly satisfied: boolean;
      readonly failingLane?: CapabilityLane;
      readonly summary: string;
    };

// ---------------------------------------------------------------------------
// Probe contexts
// ---------------------------------------------------------------------------

export type KernelSourceLookup = {
  readonly contains: (filePath: string, pattern: RegExp) => boolean;
  readonly read: (filePath: string) => string | undefined;
};

export type GlobalProbeContext = {
  readonly prepared: PreparedDataLayerRegistry;
  readonly vocabulary: FacetVocabularyShape;
  readonly kernelSource: KernelSourceLookup;
};

export type GoldRowProbeContext = GlobalProbeContext & {
  readonly expected: ExpectedKernelOutcome;
  readonly trace: BundleTrace;
};

// ---------------------------------------------------------------------------
// Capability definition shape
// ---------------------------------------------------------------------------

export type CapabilityDefinition = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly dependsOnCqIds: ReadonlyArray<string>;
  readonly runtimeData: (ctx: GlobalProbeContext) => LaneCell;
  readonly workerBehavior: (ctx: GlobalProbeContext) => LaneCell;
  readonly goldRowDependency: (ctx: GoldRowProbeContext) => GoldRowCellState;
};

// ---------------------------------------------------------------------------
// Helper utilities for probes
// ---------------------------------------------------------------------------

const REQUIRED_FACETS_FOR_BIND: ReadonlyArray<keyof Variable> = [
  "measuredProperty",
  "statisticType"
];

const variablesIn = (
  prepared: PreparedDataLayerRegistry
): ReadonlyArray<Variable> => prepared.seed.variables;

const findVariableById = (
  prepared: PreparedDataLayerRegistry,
  variableId: string
): Variable | undefined => {
  const entity = prepared.entityById.get(variableId);
  if (entity === undefined || entity._tag !== "Variable") {
    return undefined;
  }
  return entity;
};

const matchedFacetCount = (
  variable: Variable,
  bundleText: ReadonlyArray<string>,
  vocabulary: FacetVocabularyShape
): number => {
  // For each facet on the variable, ask whether any bundle text witnesses
  // a canonical for that facet. We intentionally avoid relying on the
  // already-built kernel partial — this measures direct text→facet witness.
  const witnesses = (matcher: (text: string) => string | undefined) =>
    bundleText.some((line) => matcher(line) !== undefined);

  let count = 0;

  if (variable.measuredProperty !== undefined) {
    if (
      witnesses((line) => {
        const matched = vocabulary.matchMeasuredProperty(line);
        return matched._tag === "Some" &&
          matched.value.canonical === variable.measuredProperty
          ? variable.measuredProperty
          : undefined;
      })
    ) {
      count++;
    }
  }

  if (variable.domainObject !== undefined) {
    if (
      witnesses((line) => {
        const matched = vocabulary.matchDomainObject(line);
        return matched._tag === "Some" &&
          matched.value.canonical === variable.domainObject
          ? variable.domainObject
          : undefined;
      })
    ) {
      count++;
    }
  }

  if (variable.technologyOrFuel !== undefined) {
    if (
      witnesses((line) => {
        const matched = vocabulary.matchTechnologyOrFuel(line);
        return matched._tag === "Some" &&
          matched.value.canonical === variable.technologyOrFuel
          ? variable.technologyOrFuel
          : undefined;
      })
    ) {
      count++;
    }
  }

  return count;
};

const collectBundleText = (trace: BundleTrace): ReadonlyArray<string> => {
  const lines: Array<string> = [];
  const push = (value: string | null | undefined) => {
    if (value !== null && value !== undefined && value.trim().length > 0) {
      lines.push(value);
    }
  };

  push(trace.bundle.chartTitle);
  push(trace.bundle.xAxis?.label);
  push(trace.bundle.xAxis?.unit);
  push(trace.bundle.yAxis?.label);
  push(trace.bundle.yAxis?.unit);
  for (const series of trace.bundle.series) {
    push(series.legendLabel);
    push(series.unit);
  }
  return lines;
};

// ---------------------------------------------------------------------------
// Capability 1: surface-form coverage for the required facets
// ---------------------------------------------------------------------------

const C1_surfaceFormCoverage: CapabilityDefinition = {
  id: "surface-form-coverage",
  label: "Surface-form coverage for required facets",
  description:
    "The vocabulary contains canonical surface forms for measuredProperty and " +
    "statisticType such that chart text witnesses both required facets.",
  dependsOnCqIds: ["CQ-031", "CQ-032", "CQ-033", "CQ-036", "CQ-037", "CQ-038"],

  runtimeData: ({ prepared, vocabulary }) => {
    // Probe: every measuredProperty value used by a registry Variable should
    // have at least one surface form in the lexicon (via matchMeasuredProperty
    // round-trip on the canonical itself).
    const measuredPropertyValues = new Set<string>();
    for (const variable of variablesIn(prepared)) {
      if (variable.measuredProperty !== undefined) {
        measuredPropertyValues.add(variable.measuredProperty);
      }
    }

    const uncovered: Array<string> = [];
    for (const canonical of measuredPropertyValues) {
      const match = vocabulary.matchMeasuredProperty(canonical);
      if (match._tag === "None" || match.value.canonical !== canonical) {
        uncovered.push(canonical);
      }
    }

    if (uncovered.length === 0) {
      return {
        status: "pass",
        summary: `${measuredPropertyValues.size} measuredProperty canonicals all witnessed by lexicon`,
        metric: measuredPropertyValues.size
      };
    }

    return {
      status: "fail",
      summary: `${uncovered.length} measuredProperty canonicals lack a self-matching surface form`,
      detail: `uncovered: ${uncovered.join(", ")}`,
      metric: uncovered.length
    };
  },

  workerBehavior: ({ kernelSource }) => {
    // The Interpret stage runs per-facet matchers in matchSite. As long as
    // matchMeasuredProperty/matchDomainObject/etc. are invoked from
    // Interpret.ts, the worker is wired to use surface-form coverage.
    const interpretsRunMatchers =
      kernelSource.contains(
        "src/resolution/kernel/Interpret.ts",
        /matchMeasuredProperty/u
      ) &&
      kernelSource.contains(
        "src/resolution/kernel/Interpret.ts",
        /matchTechnologyOrFuel/u
      );

    return interpretsRunMatchers
      ? {
          status: "pass",
          summary: "Interpret stage invokes per-facet matchers in matchSite"
        }
      : {
          status: "fail",
          summary: "Interpret.ts no longer calls per-facet matchers — wiring missing"
        };
  },

  goldRowDependency: ({ trace }) => {
    // Every annotated bundle depends on surface-form coverage. The lane is
    // satisfied if at least one required facet was witnessed in the bundle's
    // hypothesis partial. NoMatch / empty partial means the bundle's text just
    // didn't contain canonical surface forms — that's a per-bundle data issue,
    // not a worker codepath issue.
    if (trace.interpreted._tag !== "Hypothesis") {
      return {
        kind: "required",
        satisfied: false,
        failingLane: "runtimeData",
        summary: `Interpret stage produced ${trace.interpreted._tag}, not Hypothesis (bundle text witnessed nothing)`
      };
    }

    const sharedKeys = Object.keys(trace.interpreted.hypothesis.sharedPartial);
    if (sharedKeys.length === 0) {
      return {
        kind: "required",
        satisfied: false,
        failingLane: "runtimeData",
        summary: "Hypothesis shared partial has zero matched facets — bundle text witnessed nothing"
      };
    }

    return {
      kind: "required",
      satisfied: true,
      summary: `Shared partial witnesses ${sharedKeys.length} facets: ${sharedKeys.join(", ")}`
    };
  }
};

// ---------------------------------------------------------------------------
// Capability 2: agent resolution from stage 1 input
// ---------------------------------------------------------------------------

const C2_agentResolution: CapabilityDefinition = {
  id: "agent-resolution",
  label: "Agent resolution from stage-1 input",
  description:
    "Given a bundle's source attribution, the kernel pins a publishing Agent " +
    "via label, alternate name, or homepage domain.",
  dependsOnCqIds: ["CQ-058"],

  runtimeData: ({ prepared }) => {
    const agentCount = prepared.seed.agents.length;
    const withHomepage = prepared.seed.agents.filter(
      (agent) => agent.homepage !== undefined
    ).length;

    return {
      status: agentCount > 0 ? "pass" : "fail",
      summary: `${agentCount} agents in registry, ${withHomepage} with homepage domain`,
      metric: agentCount
    };
  },

  workerBehavior: ({ kernelSource }) => {
    const present = kernelSource.contains(
      "src/resolution/ResolutionKernel.ts",
      /resolveAgentIdFromStage1Input/u
    );
    return present
      ? {
          status: "pass",
          summary: "ResolutionKernel.resolve calls resolveAgentIdFromStage1Input"
        }
      : {
          status: "fail",
          summary: "ResolutionKernel.ts no longer wires the agent resolver"
        };
  },

  goldRowDependency: ({ trace }) => {
    const agentResolved = trace.agentId !== null;
    return {
      kind: "required",
      satisfied: agentResolved,
      // When the worker ran but the bundle's source attribution didn't carry a
      // matchable label/homepage, the failure is in the per-bundle input data,
      // not the kernel codepath. We tag this `runtimeData` so it bins with
      // other "the data was insufficient" failures rather than blaming the
      // worker for doing exactly what it should.
      failingLane: agentResolved ? undefined : "runtimeData",
      summary: agentResolved
        ? `agent ${trace.agentId} resolved`
        : "agent unresolved — bundle source attribution had no hit on any registry Agent"
    };
  }
};

// ---------------------------------------------------------------------------
// Capability 3: agent → variable shelf (the DCAT chain at runtime)
// ---------------------------------------------------------------------------

const C3_agentVariableShelf: CapabilityDefinition = {
  id: "agent-variable-shelf",
  label: "Agent → variable shelf",
  description:
    "Given a resolved Agent, the registry exposes the small set of Variables " +
    "that Agent publishes via Dataset.variableIds.",
  dependsOnCqIds: ["CQ-058", "CQ-059", "CQ-060", "CQ-067"],

  runtimeData: ({ prepared }) => {
    const totalDatasets = prepared.seed.datasets.length;
    // Series-backed shelf is the single source of truth: a dataset contributes
    // to an agent's variable shelf iff either Dataset.variableIds is populated
    // or a Series.datasetId points at it and its variableId resolves. The
    // registry already union-merges both sources into variablesByDatasetId.
    let datasetsWithShelf = 0;
    for (const dataset of prepared.seed.datasets) {
      const shelf = prepared.variablesByDatasetId.get(dataset.id);
      if (shelf !== undefined && Array.from(shelf).length > 0) {
        datasetsWithShelf++;
      }
    }

    if (datasetsWithShelf === 0) {
      return {
        status: "fail",
        summary: `0 of ${totalDatasets} datasets have a variable shelf — Dataset → Variable edge is empty`,
        detail:
          "Every Agent's variable shelf is empty in the runtime registry. " +
          "narrowCandidatesByAgent in Bind.ts is structurally a no-op until " +
          "the series→dataset backfill (SKY-317) or Dataset.variableIds is populated.",
        metric: 0
      };
    }

    return {
      status: datasetsWithShelf === totalDatasets ? "pass" : "amber",
      summary: `${datasetsWithShelf} / ${totalDatasets} datasets carry a variable shelf (series-backed or Dataset.variableIds)`,
      metric: datasetsWithShelf
    };
  },

  workerBehavior: ({ kernelSource }) => {
    const present = kernelSource.contains(
      "src/resolution/kernel/Bind.ts",
      /narrowCandidatesByAgent/u
    );
    return present
      ? {
          status: "pass",
          summary: "Bind.ts calls narrowCandidatesByAgent when options.agentId is set"
        }
      : {
          status: "fail",
          summary: "Bind.ts no longer narrows by agent"
        };
  },

  goldRowDependency: ({ prepared, trace }) => {
    if (trace.agentId === null) {
      return {
        kind: "not-required",
        reason: "no agent resolved for this bundle"
      };
    }

    const shelf = prepared.variablesByAgentId.get(trace.agentId);
    const shelfSize = shelf === undefined ? 0 : Array.from(shelf).length;

    if (shelfSize === 0) {
      return {
        kind: "required",
        satisfied: false,
        failingLane: "runtimeData",
        summary: `agent ${trace.agentId} has 0 variables in shelf (Dataset.variableIds empty)`
      };
    }

    return {
      kind: "required",
      satisfied: true,
      summary: `agent shelf has ${shelfSize} variables`
    };
  }
};

// ---------------------------------------------------------------------------
// Capability 4: facet-narrowing reach (does subsumes still admit the gold variable?)
// ---------------------------------------------------------------------------

const C4_facetNarrowingReach: CapabilityDefinition = {
  id: "facet-narrowing-reach",
  label: "Facet-narrowing reach (gold variable structurally reachable)",
  description:
    "Given the bundle's interpret-stage partial, the gold Variable still passes " +
    "the kernel's subsumption filter (i.e., no required facet has been pinned " +
    "to a value that contradicts the gold).",
  dependsOnCqIds: ["CQ-034"],

  runtimeData: ({ prepared }) => {
    // Live measurement of CQ-034: how many registry variables match
    // measuredProperty=generation right now?
    const matches = variablesIn(prepared).filter(
      (variable) => variable.measuredProperty === "generation"
    );
    return {
      status: matches.length > 0 ? "pass" : "fail",
      summary: `${matches.length} registry variables have measuredProperty=generation`,
      detail: matches.map((variable) => variable.label).join(", "),
      metric: matches.length
    };
  },

  workerBehavior: ({ kernelSource }) => {
    const usesSubsumes = kernelSource.contains(
      "src/resolution/kernel/Bind.ts",
      /subsumes\(partial/u
    );
    return usesSubsumes
      ? {
          status: "amber",
          summary:
            "Bind.ts uses subsumes as a hard filter — one wrong facet eliminates the gold variable"
        }
      : {
          status: "pass",
          summary: "Bind.ts no longer uses subsumes as a hard filter"
        };
  },

  goldRowDependency: ({ prepared, trace, expected }) => {
    if (expected.outcomeTag !== "Resolved" || expected.expectedVariableIds === undefined) {
      return { kind: "not-required", reason: "gold row is not a Resolved outcome" };
    }

    if (trace.interpreted._tag !== "Hypothesis") {
      return {
        kind: "required",
        satisfied: false,
        failingLane: "vocabulary",
        summary: `Interpret produced ${trace.interpreted._tag}; no partial to narrow with`
      };
    }

    const sharedPartial = trace.interpreted.hypothesis.sharedPartial;
    const sharedKeys = Object.keys(sharedPartial) as Array<keyof typeof sharedPartial>;

    for (const goldVariableId of expected.expectedVariableIds) {
      const goldVariable = findVariableById(prepared, goldVariableId);
      if (goldVariable === undefined) {
        continue;
      }

      // Check whether the partial subsumes the gold variable's facets:
      // every defined facet in the partial must equal the gold's value.
      let blockingFacet: string | undefined;
      for (const key of sharedKeys) {
        const partialValue = sharedPartial[key];
        const goldValue = (goldVariable as Record<string, unknown>)[key];
        if (
          partialValue !== undefined &&
          goldValue !== undefined &&
          partialValue !== goldValue
        ) {
          blockingFacet = `${key}: partial=${String(partialValue)} vs gold=${String(goldValue)}`;
          break;
        }
      }

      if (blockingFacet === undefined) {
        return {
          kind: "required",
          satisfied: true,
          summary: `gold ${goldVariable.label} subsumed by partial`
        };
      }

      return {
        kind: "required",
        satisfied: false,
        failingLane: "vocabulary",
        summary: `partial blocks gold ${goldVariable.label} on ${blockingFacet}`
      };
    }

    return {
      kind: "required",
      satisfied: false,
      failingLane: "runtimeData",
      summary: "expected variable ids not found in registry"
    };
  }
};

// ---------------------------------------------------------------------------
// Capability 5: unique binding on a three-facet input
// ---------------------------------------------------------------------------

const C5_uniqueBindingOnThreeFacets: CapabilityDefinition = {
  id: "unique-binding-on-three-facets",
  label: "Unique binding on a three-facet input",
  description:
    "CQ-035 promise: given (measuredProperty=generation, domainObject=electricity, " +
    "technologyOrFuel=solar PV), exactly one Variable resolves.",
  dependsOnCqIds: ["CQ-035"],

  runtimeData: ({ prepared }) => {
    const matches = variablesIn(prepared).filter(
      (variable) =>
        variable.measuredProperty === "generation" &&
        variable.domainObject === "electricity" &&
        variable.technologyOrFuel === "solar PV"
    );

    if (matches.length === 1) {
      return {
        status: "pass",
        summary: `exactly 1 variable matches (generation, electricity, solar PV): ${matches[0]!.label}`,
        metric: 1
      };
    }

    return {
      status: matches.length === 0 ? "fail" : "amber",
      summary: `${matches.length} variables match (generation, electricity, solar PV)`,
      detail: matches.map((variable) => variable.label).join(", "),
      metric: matches.length
    };
  },

  workerBehavior: () => ({
    status: "n-a",
    summary: "pure data probe — no worker codepath required"
  }),

  goldRowDependency: () => ({
    kind: "not-required",
    reason: "global capability — measured live, not per-row"
  })
};

// ---------------------------------------------------------------------------
// Capability 6: unit-family → statisticType inference (CQ-008)
// ---------------------------------------------------------------------------

const C6_unitFamilyInference: CapabilityDefinition = {
  id: "unit-family-inference",
  label: "Unit-family → statisticType inference",
  description:
    "CQ-008 promise: knowing the unit family discriminates stock from flow " +
    "(power → stock/capacity, energy → flow/generation, dimensionless → presentation).",
  dependsOnCqIds: ["CQ-008"],

  runtimeData: ({ prepared, vocabulary }) => {
    // CQ-008 itself: does 'GW' resolve to a unitFamily concept that implies
    // a particular statisticType? At minimum the surface form must round-trip
    // to a unitFamily canonical.
    const matched = vocabulary.matchUnitFamily("GW");
    if (matched._tag === "None") {
      return {
        status: "fail",
        summary: "'GW' does not resolve to any unitFamily canonical"
      };
    }

    // Bonus: confirm at least one Variable in the registry uses unitFamily=power
    // (so the inference would have somewhere to land if implemented).
    const powerVariables = variablesIn(prepared).filter(
      (variable) => variable.unitFamily === "power"
    );

    return {
      status: "pass",
      summary: `'GW' → unitFamily=${matched.value.canonical}; ${powerVariables.length} power-typed variables in registry`,
      metric: powerVariables.length
    };
  },

  workerBehavior: ({ kernelSource }) => {
    // Look for any code in Interpret.ts that derives statisticType from
    // unitFamily (or vice versa). Currently no such code exists.
    const interpret = kernelSource.read("src/resolution/kernel/Interpret.ts") ?? "";
    const hasInferenceRule =
      /unitFamily.*statisticType/u.test(interpret) ||
      /statisticType.*unitFamily/u.test(interpret);

    return hasInferenceRule
      ? {
          status: "pass",
          summary: "Interpret.ts contains a unitFamily ↔ statisticType inference rule"
        }
      : {
          status: "fail",
          summary:
            "Interpret.ts has no unitFamily ↔ statisticType inference — share/flow ambiguity goes unresolved"
        };
  },

  goldRowDependency: ({ trace }) => {
    // The capability is only required for bundles where the chart unit is
    // dimensionless (a share-or-percent display) AND the yAxis text contains
    // a measuredProperty surface form like generation/capacity/demand. Those
    // are the cases where unit→stat inference would distinguish "presentation
    // share" from "underlying property".
    const yAxisUnit = trace.bundle.yAxis?.unit ?? "";
    const yAxisLabel = (trace.bundle.yAxis?.label ?? "").toLowerCase();
    const isDimensionless = /^%$|^percent|share|ratio/u.test(yAxisUnit.toLowerCase());
    const mentionsUnderlyingProperty =
      /generation|capacity|demand|consumption|production/u.test(yAxisLabel);

    if (!isDimensionless || !mentionsUnderlyingProperty) {
      return { kind: "not-required" };
    }

    return {
      kind: "required",
      satisfied: false,
      failingLane: "workerBehavior",
      summary: `% display over '${yAxisLabel}' — needs unit→stat inference to keep underlying property`
    };
  }
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CAPABILITY_DEFINITIONS: ReadonlyArray<CapabilityDefinition> = [
  C1_surfaceFormCoverage,
  C2_agentResolution,
  C3_agentVariableShelf,
  C4_facetNarrowingReach,
  C5_uniqueBindingOnThreeFacets,
  C6_unitFamilyInference
];

// ---------------------------------------------------------------------------
// Vocabulary lane derivation (shared logic)
// ---------------------------------------------------------------------------

import type { VocabVerdictIndex } from "./shared/consumeValidationReports";

export const deriveVocabularyLane = (
  capability: CapabilityDefinition,
  vocabVerdicts: VocabVerdictIndex
): LaneCell => {
  if (capability.dependsOnCqIds.length === 0) {
    return {
      status: "n-a",
      summary: "capability declares no vocabulary CQ dependency"
    };
  }

  const verdicts = capability.dependsOnCqIds.map((cqId) => ({
    cqId,
    verdict: vocabVerdicts.get(cqId)
  }));

  const missing = verdicts.filter((entry) => entry.verdict === undefined);
  if (missing.length === capability.dependsOnCqIds.length) {
    return {
      status: "n-a",
      summary: `none of ${capability.dependsOnCqIds.join(", ")} found in validation reports`
    };
  }

  const failed = verdicts.filter(
    (entry) => entry.verdict !== undefined && entry.verdict.status === "fail"
  );

  if (failed.length > 0) {
    return {
      status: "fail",
      summary: `${failed.length}/${capability.dependsOnCqIds.length} dependent CQs failing in vocabulary`,
      detail: failed
        .map((entry) => `${entry.cqId}: ${entry.verdict?.reason ?? "no reason"}`)
        .join("; ")
    };
  }

  if (missing.length > 0) {
    return {
      status: "amber",
      summary: `${missing.length}/${capability.dependsOnCqIds.length} dependent CQs not found in vocabulary reports`,
      detail: `missing: ${missing.map((entry) => entry.cqId).join(", ")}`
    };
  }

  return {
    status: "pass",
    summary: `${capability.dependsOnCqIds.length}/${capability.dependsOnCqIds.length} dependent CQs passing in vocabulary`
  };
};

// Re-export utilities used by the run harness for traces it constructs
export { collectBundleText, matchedFacetCount };
