import { normalizeLookupText } from "./normalize";

export const FUZZY_CANDIDATE_THRESHOLD = 0.6;
export const FUZZY_CONFIDENT_THRESHOLD = 0.85;

const tokenize = (value: string) =>
  normalizeLookupText(value)
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

export const jaccardTokenSet = (left: string, right: string): number => {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
};
