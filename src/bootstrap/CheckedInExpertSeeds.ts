import { Schema } from "effect";
import energySeedManifestJson from "../../config/expert-seeds/energy.json";
import { assertValidExpertSeedManifest } from "./ExpertSeeds";
import { ExpertSeedManifest } from "../domain/bi";

export const energySeedManifest = assertValidExpertSeedManifest(
  Schema.decodeUnknownSync(ExpertSeedManifest)(energySeedManifestJson)
);

const firstEnergyExpert = energySeedManifest.experts[0];

if (!firstEnergyExpert) {
  throw new Error("expected at least one checked-in expert seed");
}

export const energySeedDid = firstEnergyExpert.did;
