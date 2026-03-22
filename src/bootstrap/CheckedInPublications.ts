import { Schema } from "effect";
import publicationsSeedJson from "../../config/ontology/publications-seed.json";
import { PublicationSeedManifest } from "../domain/bi";

export const publicationsSeedManifest = Schema.decodeUnknownSync(
  PublicationSeedManifest
)(publicationsSeedJson);
