import {
  normalizeDistributionHostname,
  normalizeDistributionUrl,
  normalizeLookupText
} from "../platform/Normalize";

const pushUniqueText = (
  seen: Set<string>,
  values: Array<string>,
  raw: string | undefined | null
) => {
  if (typeof raw !== "string") {
    return;
  }

  const value = raw.trim();
  if (value.length === 0) {
    return;
  }

  const key = normalizeLookupText(value);
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  values.push(value);
};

export const collectUniqueSearchText = (
  ...inputs: ReadonlyArray<unknown>
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const values: Array<string> = [];

  const visit = (input: unknown): void => {
    if (input == null) {
      return;
    }

    if (typeof input === "string") {
      pushUniqueText(seen, values, input);
      return;
    }

    if (Array.isArray(input)) {
      for (const value of input) {
        visit(value);
      }
      return;
    }

    if (typeof input === "object") {
      for (const value of Object.values(input)) {
        visit(value);
      }
    }
  };

  for (const input of inputs) {
    visit(input);
  }

  return values;
};

export const joinSearchText = (
  fallback: string,
  ...inputs: ReadonlyArray<unknown>
): string => {
  const values = collectUniqueSearchText(...inputs);
  return values.length === 0 ? fallback : values.join("\n");
};

export const collectNormalizedSearchUrls = (
  ...inputs: ReadonlyArray<string | null | undefined>
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const values: Array<string> = [];

  for (const input of inputs) {
    if (input == null) {
      continue;
    }

    const normalized = normalizeDistributionUrl(input);
    if (normalized === null || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    values.push(normalized);
  }

  return values;
};

export const collectNormalizedSearchHostnames = (
  ...inputs: ReadonlyArray<string | null | undefined>
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const values: Array<string> = [];

  for (const input of inputs) {
    if (input == null) {
      continue;
    }

    const normalized = normalizeDistributionHostname(input);
    if (normalized === null || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    values.push(normalized);
  }

  return values;
};
