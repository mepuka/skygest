import { Schema } from "effect";
import energySeedManifestJson from "../../config/expert-seeds/energy.json";
import { ExpertSeedManifest } from "../domain/bi";

export const energySeedManifest = Schema.decodeUnknownSync(ExpertSeedManifest)(
  energySeedManifestJson
);

const firstEnergyExpert = energySeedManifest.experts[0];

if (!firstEnergyExpert) {
  throw new Error("expected at least one checked-in expert seed");
}

export const energySeedDid = firstEnergyExpert.did;
