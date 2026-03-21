import { Schema } from "effect";
import { normalizeDomain } from "../domain/normalize";
import shortenerJson from "../../config/source-registry/brand-shorteners.json";
import { BrandShortenerManifest } from "../domain/source";

export const brandShortenerManifest = Schema.decodeUnknownSync(
  BrandShortenerManifest
)(shortenerJson);

export const brandShortenerMap = new Map(
  brandShortenerManifest.entries.map((entry) => [
    normalizeDomain(entry.shortDomain),
    normalizeDomain(entry.resolvedDomain)
  ])
);
