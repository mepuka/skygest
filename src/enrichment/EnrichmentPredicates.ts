import { Predicate } from "effect";
import type { VisionEnrichment } from "../domain/enrichment";
import type {
  EnrichmentPlannerInput,
  EnrichmentPlannerStopReason,
  EnrichmentPlannedAsset,
  EnrichmentPlannedExistingEnrichment,
  EnrichmentPlannedLinkCardContext,
  EnrichmentPlannedQuoteContext
} from "../domain/enrichmentPlan";

type EnrichmentType = EnrichmentPlannerInput["enrichmentType"];

export interface EnrichmentPlanningContext {
  readonly enrichmentType: EnrichmentType;
  readonly assets: ReadonlyArray<EnrichmentPlannedAsset>;
  readonly links: ReadonlyArray<unknown>;
  readonly quote: EnrichmentPlannedQuoteContext | null;
  readonly linkCards: ReadonlyArray<EnrichmentPlannedLinkCardContext>;
  readonly existingEnrichments: ReadonlyArray<EnrichmentPlannedExistingEnrichment>;
  readonly vision: VisionEnrichment | null;
}

export type EnrichmentPlanningDecision =
  | {
      readonly decision: "execute";
    }
  | {
      readonly decision: "skip";
      readonly stopReason: EnrichmentPlannerStopReason;
    };

const isNonEmpty = <A>(values: ReadonlyArray<A>) => values.length > 0;

const isPlanningKind = (kind: EnrichmentType) =>
  Predicate.mapInput(
    (value: EnrichmentType) => value === kind,
    (context: EnrichmentPlanningContext) => context.enrichmentType
  );

const hasQuoteText: Predicate.Predicate<EnrichmentPlannedQuoteContext> =
  Predicate.mapInput(
    (text: string | null) => text !== null,
    (quote) => quote.text
  );

const hasQuoteUri: Predicate.Predicate<EnrichmentPlannedQuoteContext> =
  Predicate.mapInput(
    (uri: string | null) => uri !== null,
    (quote) => quote.uri
  );

const hasQuoteAuthor: Predicate.Predicate<EnrichmentPlannedQuoteContext> =
  Predicate.mapInput(
    (author: string | null) => author !== null,
    (quote) => quote.author
  );

const hasQuoteSignal = Predicate.some([
  hasQuoteText,
  hasQuoteUri,
  hasQuoteAuthor
]);

export const plansVision = isPlanningKind("vision");

export const plansSourceAttribution = isPlanningKind("source-attribution");

export const plansGrounding = isPlanningKind("grounding");

export const hasVisualAssets: Predicate.Predicate<EnrichmentPlanningContext> =
  Predicate.mapInput(isNonEmpty, (context) => context.assets);

export const hasStoredLinks: Predicate.Predicate<EnrichmentPlanningContext> =
  Predicate.mapInput(isNonEmpty, (context) => context.links);

export const hasLinkCards: Predicate.Predicate<EnrichmentPlanningContext> =
  Predicate.mapInput(isNonEmpty, (context) => context.linkCards);

export const hasExistingEnrichments: Predicate.Predicate<
  EnrichmentPlanningContext
> = Predicate.mapInput(isNonEmpty, (context) => context.existingEnrichments);

export const hasDecodedVision: Predicate.Predicate<EnrichmentPlanningContext> =
  Predicate.mapInput(
    (vision: VisionEnrichment | null) => vision !== null,
    (context) => context.vision
  );

export const hasDurableQuoteContext: Predicate.Predicate<
  EnrichmentPlanningContext
> = (context) => context.quote !== null && hasQuoteSignal(context.quote);

export const hasSourceSignals: Predicate.Predicate<EnrichmentPlanningContext> =
  Predicate.some([
    hasVisualAssets,
    hasStoredLinks,
    hasDurableQuoteContext,
    hasLinkCards,
    hasExistingEnrichments
  ]);

export const hasGroundingSignals: Predicate.Predicate<
  EnrichmentPlanningContext
> = Predicate.some([
  hasStoredLinks,
  hasLinkCards,
  hasExistingEnrichments
]);

export const canExecuteEnrichmentPlan: Predicate.Predicate<
  EnrichmentPlanningContext
> = Predicate.some([
  Predicate.and(plansVision, hasVisualAssets),
  Predicate.and(
    plansSourceAttribution,
    Predicate.or(Predicate.not(hasVisualAssets), hasDecodedVision)
  ),
  Predicate.and(plansGrounding, hasGroundingSignals)
]);

export const defaultStopReasonForEnrichmentType = (
  enrichmentType: EnrichmentType,
  context?: EnrichmentPlanningContext
): EnrichmentPlannerStopReason => {
  switch (enrichmentType) {
    case "vision":
      return "no-visual-assets";
    case "source-attribution":
      return context !== undefined &&
        hasVisualAssets(context) &&
        !hasDecodedVision(context)
        ? "awaiting-vision"
        : "no-source-signals";
    case "grounding":
      return "no-grounding-signals";
  }
};

export const evaluateEnrichmentPlanningDecision = (
  context: EnrichmentPlanningContext
): EnrichmentPlanningDecision =>
  canExecuteEnrichmentPlan(context)
    ? { decision: "execute" }
    : {
        decision: "skip",
        stopReason: defaultStopReasonForEnrichmentType(
          context.enrichmentType,
          context
        )
      };

export const isSkippedEnrichmentPlan: Predicate.Predicate<
  { readonly decision: "execute" | "skip" }
> = Predicate.mapInput(
  (decision: "execute" | "skip") => decision === "skip",
  (plan) => plan.decision
);
