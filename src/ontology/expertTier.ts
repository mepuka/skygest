import type { ExpertTier, OntologyAuthorTiers } from "../domain/bi";

/**
 * Resolves the expert tier for a given handle based on the ontology's author
 * tier lists. Returns "energy-focused" if the handle appears in the
 * energyFocused list, "general-outlet" if it appears in the generalOutlets
 * list, or "independent" otherwise (including when the handle is null).
 */
export const resolveExpertTier = (
  handle: string | null,
  authorTiers: OntologyAuthorTiers
): ExpertTier => {
  if (handle === null) {
    return "independent";
  }

  const normalized = handle.trim().toLowerCase();

  if (normalized.length === 0) {
    return "independent";
  }

  for (const entry of authorTiers.energyFocused) {
    if (entry.trim().toLowerCase() === normalized) {
      return "energy-focused";
    }
  }

  for (const entry of authorTiers.generalOutlets) {
    if (entry.trim().toLowerCase() === normalized) {
      return "general-outlet";
    }
  }

  return "independent";
};
