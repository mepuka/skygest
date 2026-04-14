import { Effect, Layer, Result, ServiceMap } from "effect";
import type { DataLayerRegistrySeed } from "../domain/data-layer";
import { DataLayerRegistryLoadError } from "../domain/errors";
import {
  formatDataLayerRegistryDiagnostic,
  prepareDataLayerRegistry,
  toDataLayerRegistryLookup,
  toPreparedDataLayerRegistryCore,
  type PreparedDataLayerRegistry,
  type PreparedDataLayerRegistryInternal
} from "../resolution/dataLayerRegistry";

export type PreparedDataLayerRegistryInput = {
  readonly seed: DataLayerRegistrySeed;
  readonly root?: string;
  readonly pathById?: ReadonlyMap<string, string>;
};

export const loadPreparedDataLayerRegistry = <E, R>(
  makeInput: Effect.Effect<PreparedDataLayerRegistryInput, E, R>
) =>
  Effect.gen(function* () {
    const input = yield* makeInput;
    const prepared = prepareDataLayerRegistry(input.seed, {
      ...(input.root === undefined ? {} : { root: input.root }),
      ...(input.pathById === undefined ? {} : { pathById: input.pathById })
    });

    if (Result.isFailure(prepared)) {
      return yield* new DataLayerRegistryLoadError({
        root: prepared.failure.root,
        diagnostic: prepared.failure,
        message: formatDataLayerRegistryDiagnostic(prepared.failure)
      });
    }

    return prepared.success;
  });

export class DataLayerRegistry extends ServiceMap.Service<
  DataLayerRegistry,
  {
    readonly prepared: PreparedDataLayerRegistry;
    readonly lookup: ReturnType<typeof toDataLayerRegistryLookup>;
  }
>()("@skygest/DataLayerRegistry") {
  static readonly layerFromPrepared = (
    prepared: PreparedDataLayerRegistryInternal
  ) =>
    Layer.succeed(
      DataLayerRegistry,
      DataLayerRegistry.of({
        prepared: toPreparedDataLayerRegistryCore(prepared),
        lookup: toDataLayerRegistryLookup(prepared)
      })
    );

  static readonly layerFromEffect = <E, R>(
    makePrepared: Effect.Effect<PreparedDataLayerRegistryInternal, E, R>
  ) =>
    Layer.effect(
      DataLayerRegistry,
      Effect.map(makePrepared, (prepared) =>
        DataLayerRegistry.of({
          prepared: toPreparedDataLayerRegistryCore(prepared),
          lookup: toDataLayerRegistryLookup(prepared)
        })
      )
    );
}
