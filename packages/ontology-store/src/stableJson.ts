const stableJsonValue = (value: unknown): string => {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonValue(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonValue(entryValue)}`)
    .join(",")}}`;
};

export const stableJson = (value: unknown): string => stableJsonValue(value);
