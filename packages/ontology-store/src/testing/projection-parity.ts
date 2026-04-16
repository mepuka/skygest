import type { DataLayerRegistryEntity } from "../../../../src/domain/data-layer";
import { type EmitSpecClassKey } from "../Domain/EmitSpec";
import { loadedEmitSpec as emitSpec } from "../loadedEmitSpec";
import { stableJson } from "../stableJson";

export type ProjectionParityDiff = {
  readonly field: string;
  readonly source: unknown;
  readonly distilled: unknown;
};

export type ProjectionParityResult = {
  readonly ok: boolean;
  readonly diffs: ReadonlyArray<ProjectionParityDiff>;
};

const normalizeMany = (value: unknown): ReadonlyArray<unknown> =>
  (Array.isArray(value) ? [...value] : []).sort((left, right) =>
    stableJson(left).localeCompare(stableJson(right))
  );

export const compareProjectionParity = (
  source: DataLayerRegistryEntity,
  distilled: DataLayerRegistryEntity
): ProjectionParityResult => {
  if (source._tag !== distilled._tag) {
    return {
      ok: false,
      diffs: [
        {
          field: "_tag",
          source: source._tag,
          distilled: distilled._tag
        }
      ]
    };
  }

  const classKey = source._tag as EmitSpecClassKey;
  const relevantFields = emitSpec.classes[classKey].reverse.fields.filter(
    (field) => !("lossy" in field)
  );

  const sourceRecord = source as Record<string, unknown>;
  const distilledRecord = distilled as Record<string, unknown>;
  const diffs: Array<ProjectionParityDiff> = [];

  for (const field of relevantFields) {
    const sourceValue = sourceRecord[field.runtimeName];
    const distilledValue = distilledRecord[field.runtimeName];

    if (field.cardinality === "many") {
      const normalizedSource = normalizeMany(sourceValue);
      const normalizedDistilled = normalizeMany(distilledValue);

      if (stableJson(normalizedSource) !== stableJson(normalizedDistilled)) {
        diffs.push({
          field: field.runtimeName,
          source: normalizedSource,
          distilled: normalizedDistilled
        });
      }
      continue;
    }

    if (stableJson(sourceValue) !== stableJson(distilledValue)) {
      diffs.push({
        field: field.runtimeName,
        source: sourceValue,
        distilled: distilledValue
      });
    }
  }

  return {
    ok: diffs.length === 0,
    diffs
  };
};
