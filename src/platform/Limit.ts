export const clampLimit = (limit: number | undefined, fallback: number, max: number) =>
  Math.min(max, Math.max(1, limit ?? fallback));
