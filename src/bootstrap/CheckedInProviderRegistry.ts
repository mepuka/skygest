import { Schema } from "effect";
import energyProviderRegistryJson from "../../config/source-registry/energy.json";
import { ProviderRegistryManifest } from "../domain/source";
import {
  assertValidProviderRegistryManifest,
  prepareProviderRegistry
} from "../source/registry";

export const energyProviderRegistryManifest = assertValidProviderRegistryManifest(
  Schema.decodeUnknownSync(ProviderRegistryManifest)(energyProviderRegistryJson)
);

export const energyProviderRegistry = prepareProviderRegistry(
  energyProviderRegistryManifest
);
