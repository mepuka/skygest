export const stableSlug = (
  existingSlug: string | undefined,
  computeFresh: () => string
): string => existingSlug ?? computeFresh();
