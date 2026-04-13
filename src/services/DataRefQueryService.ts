import { Effect, Layer, Option, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type {
  FindCandidatesByDataRefCursor,
  FindCandidatesByDataRefInput,
  FindCandidatesByDataRefOutput,
  ResolveDataRefInput,
  ResolveDataRefOutput
} from "../domain/data-layer/query";
import {
  InvalidObservationWindowError,
  type DbError
} from "../domain/errors";
import { AppConfig } from "../platform/Config";
import { clampLimit } from "../platform/Limit";
import { DataRefCandidateReadRepo } from "./DataRefCandidateReadRepo";
import { DataLayerRegistry } from "./DataLayerRegistry";

const YEAR_PATTERN = /^\d{4}$/u;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const padNumber = (value: number) => String(value).padStart(2, "0");

const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const normalizeDateLikeLowerBound = (value: string): string => {
  if (YEAR_PATTERN.test(value)) {
    return `${value}-01-01T00:00:00.000Z`;
  }

  if (YEAR_MONTH_PATTERN.test(value)) {
    return `${value}-01T00:00:00.000Z`;
  }

  if (DATE_PATTERN.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  return new Date(value).toISOString();
};

const normalizeDateLikeUpperBound = (value: string): string => {
  if (YEAR_PATTERN.test(value)) {
    return `${value}-12-31T23:59:59.999Z`;
  }

  if (YEAR_MONTH_PATTERN.test(value)) {
    const [yearPart, monthPart] = value.split("-");
    const year = Number(yearPart);
    const month = Number(monthPart);
    return `${value}-${padNumber(lastDayOfMonth(year, month))}T23:59:59.999Z`;
  }

  if (DATE_PATTERN.test(value)) {
    return `${value}T23:59:59.999Z`;
  }

  return new Date(value).toISOString();
};

export class DataRefQueryService extends ServiceMap.Service<
  DataRefQueryService,
  {
    readonly resolveDataRef: (
      input: ResolveDataRefInput
    ) => Effect.Effect<ResolveDataRefOutput, SqlError | DbError>;
    readonly findCandidatesByDataRef: (
      input: FindCandidatesByDataRefInput
    ) => Effect.Effect<
      FindCandidatesByDataRefOutput,
      SqlError | DbError | InvalidObservationWindowError
    >;
  }
>()("@skygest/DataRefQueryService") {
  static readonly layer = Layer.effect(
    DataRefQueryService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const readRepo = yield* DataRefCandidateReadRepo;
      const registry = yield* DataLayerRegistry;

      const resolveDataRef = Effect.fn("DataRefQueryService.resolveDataRef")(
        function* (input: ResolveDataRefInput) {
          const lookup = registry.lookup;

          const entity = Option.getOrNull(
            "canonicalUri" in input
              ? lookup.findByCanonicalUri(input.canonicalUri)
              : Option.firstSomeOf([
                  lookup.findVariableByAlias(input.alias.scheme, input.alias.value),
                  lookup.findDatasetByAlias(input.alias.scheme, input.alias.value)
                ])
          );

          return { entity };
        }
      );

      const findCandidatesByDataRef = Effect.fn(
        "DataRefQueryService.findCandidatesByDataRef"
      )(function* (input: FindCandidatesByDataRefInput) {
        if (
          input.observedSince !== undefined &&
          input.observedUntil !== undefined &&
          normalizeDateLikeLowerBound(input.observedSince) >
            normalizeDateLikeUpperBound(input.observedUntil)
        ) {
          return yield* new InvalidObservationWindowError({
            message: "observedSince must be on or before observedUntil.",
            observedSince: input.observedSince,
            observedUntil: input.observedUntil
          });
        }

        const limit = clampLimit(
          input.limit,
          config.mcpLimitDefault,
          config.mcpLimitMax
        );
        const rows = yield* readRepo.listByEntityId({
          entityId: input.entityId,
          ...(input.observedSince === undefined
            ? {}
            : { observedSince: input.observedSince }),
          ...(input.observedUntil === undefined
            ? {}
            : { observedUntil: input.observedUntil }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          limit: limit + 1
        });
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastRow = pageRows[pageRows.length - 1];

        const nextCursor: FindCandidatesByDataRefCursor | null =
          hasMore && lastRow !== undefined
            ? lastRow.cursor
            : null;

        return {
          items: pageRows.map((row) => row.hit),
          nextCursor
        };
      });

      return {
        resolveDataRef,
        findCandidatesByDataRef
      };
    })
  );
}
