import { Effect, Layer, Option, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type {
  FindCandidatesByDataRefCursor,
  FindCandidatesByDataRefInput,
  FindCandidatesByDataRefOutput,
  ResolveDataRefInput,
  ResolveDataRefOutput
} from "../domain/data-layer/query";
import type { DbError } from "../domain/errors";
import { AppConfig } from "../platform/Config";
import { DataRefCandidateReadRepo } from "./DataRefCandidateReadRepo";
import { DataLayerRegistry } from "./DataLayerRegistry";

export class DataRefQueryService extends ServiceMap.Service<
  DataRefQueryService,
  {
    readonly resolveDataRef: (
      input: ResolveDataRefInput
    ) => Effect.Effect<ResolveDataRefOutput, SqlError | DbError>;
    readonly findCandidatesByDataRef: (
      input: FindCandidatesByDataRefInput
    ) => Effect.Effect<FindCandidatesByDataRefOutput, SqlError | DbError>;
  }
>()("@skygest/DataRefQueryService") {
  static readonly layer = Layer.effect(
    DataRefQueryService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const readRepo = yield* DataRefCandidateReadRepo;
      const registry = yield* DataLayerRegistry;

      const clampLimit = (limit: number | undefined) =>
        Math.max(
          1,
          Math.min(
            limit ?? config.mcpLimitDefault,
            config.mcpLimitMax
          )
        );

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
        const limit = clampLimit(input.limit);
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
