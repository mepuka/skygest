import { Effect, Layer, Schema, ServiceMap } from "effect";
import type { AgentId, DatasetId } from "../domain/data-layer/ids";
import type { VisionAssetEnrichment } from "../domain/enrichment";
import { type ResolutionOutcome } from "../domain/resolutionKernel";
import { EnrichmentSchemaDecodeError } from "../domain/errors";
import { Stage1Input, type Stage1Input as Stage1InputValue } from "../domain/stage1Resolution";
import { formatSchemaParseError } from "../platform/Json";
import { DataLayerRegistry } from "../services/DataLayerRegistry";
import type { DataLayerRegistryLookup } from "./dataLayerRegistry";
import {
  findDatasetMatchesForName,
  listPreferredDatasetAgentIds
} from "./datasetNameMatch";
import { FacetVocabulary } from "./facetVocabulary";
import { buildResolutionEvidenceBundles } from "./kernel/BundleAdapter";
import { resolveBundle } from "./kernel/ResolutionKernel";

type ResolutionScopeOptions = {
  agentId?: AgentId;
  datasetIds?: ReadonlyArray<DatasetId>;
};

const decodeStage1Input = (input: unknown) =>
  Schema.decodeUnknownEffect(Stage1Input)(input).pipe(
    Effect.mapError((error) =>
      new EnrichmentSchemaDecodeError({
        message: formatSchemaParseError(error),
        operation: "ResolutionKernel.resolve"
      })
    )
  );

export const resolveAgentIdFromStage1Input = (
  input: typeof Stage1Input.Type,
  lookup: DataLayerRegistryLookup
) => {
  const providerHints = [
    input.sourceAttribution?.provider?.providerId,
    input.sourceAttribution?.provider?.providerLabel,
    input.sourceAttribution?.contentSource?.publication
  ];

  for (const providerHint of providerHints) {
    if (providerHint === null || providerHint === undefined) {
      continue;
    }

    const agentByLabel = lookup.findAgentByLabel(providerHint);
    if (agentByLabel._tag === "Some") {
      return agentByLabel.value.id;
    }
  }

  const homepageHints = [
    input.sourceAttribution?.contentSource?.domain,
    input.sourceAttribution?.contentSource?.url
  ];

  for (const homepageHint of homepageHints) {
    if (homepageHint === null || homepageHint === undefined) {
      continue;
    }

    const homepageAgent = lookup.findAgentByHomepageDomain(homepageHint);
    if (homepageAgent._tag === "Some") {
      return homepageAgent.value.id;
    }
  }

  return undefined;
};

const resolveDatasetIdsForAsset = (
  input: Stage1InputValue,
  asset: VisionAssetEnrichment,
  lookup: DataLayerRegistryLookup
): ReadonlyArray<DatasetId> => {
  const datasetIds = new Set<DatasetId>();
  const preferredAgentIds = listPreferredDatasetAgentIds(input, asset, lookup);

  for (const sourceLine of asset.analysis.sourceLines) {
    if (sourceLine.datasetName === null) {
      continue;
    }

    for (const match of findDatasetMatchesForName(sourceLine.datasetName, lookup, {
      preferredAgentIds
    })) {
      datasetIds.add(match.dataset.id);
    }
  }

  return [...datasetIds];
};

const resolveDatasetIdsByAssetKey = (
  input: Stage1InputValue,
  lookup: DataLayerRegistryLookup
): ReadonlyMap<string, ReadonlyArray<DatasetId>> => {
  const datasetIdsByAssetKey = new Map<string, ReadonlyArray<DatasetId>>();

  if (input.vision === null) {
    return datasetIdsByAssetKey;
  }

  for (const asset of input.vision.assets) {
    const datasetIds = resolveDatasetIdsForAsset(input, asset, lookup);
    if (datasetIds.length > 0) {
      datasetIdsByAssetKey.set(asset.assetKey, datasetIds);
    }
  }

  return datasetIdsByAssetKey;
};

export class ResolutionKernel extends ServiceMap.Service<
  ResolutionKernel,
  {
    readonly resolve: (
      input: Schema.Codec.Encoded<typeof Stage1Input>
    ) => Effect.Effect<
      ReadonlyArray<ResolutionOutcome>,
      EnrichmentSchemaDecodeError
    >;
  }
>()("@skygest/ResolutionKernel") {
  static readonly layer = Layer.effect(
    ResolutionKernel,
    Effect.gen(function* () {
      const registry = yield* DataLayerRegistry;
      const vocabulary = yield* FacetVocabulary;

      const resolve = Effect.fn("ResolutionKernel.resolve")(function* (
        input: Schema.Codec.Encoded<typeof Stage1Input>
      ) {
        const decoded = yield* decodeStage1Input(input);
        const bundles = buildResolutionEvidenceBundles(decoded);
        const agentId = resolveAgentIdFromStage1Input(decoded, registry.lookup);
        const datasetIdsByAssetKey = resolveDatasetIdsByAssetKey(
          decoded,
          registry.lookup
        );

        return bundles.map((bundle) => {
          const datasetIds =
            bundle.assetKey === undefined
              ? undefined
              : datasetIdsByAssetKey.get(bundle.assetKey);
          const resolutionOptions: ResolutionScopeOptions = {};
          if (agentId !== undefined) {
            resolutionOptions.agentId = agentId;
          }
          if (datasetIds !== undefined) {
            resolutionOptions.datasetIds = datasetIds;
          }

          return resolveBundle(
            bundle,
            registry.lookup,
            vocabulary,
            resolutionOptions
          );
        });
      });

      return ResolutionKernel.of({ resolve });
    })
  );
}
