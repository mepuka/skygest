import { Schema } from "effect";
import { DesignDecision, SkosMapping } from "./annotations";

export const aliasSchemes = [
  "oeo", "ires-siec", "iea-shortname", "ipcc",
  "entsoe-psr", "entsoe-eic",
  "eia-route", "eia-series", "eia-bulk-id", "energy-charts-endpoint",
  "ember-route", "gridstatus-dataset-id", "odre-dataset-id",
  "eurostat-code",
  "ror", "wikidata", "doi",
  "iso3166", "url", "other"
 ] as const;

export const AliasSchemeValues = {
  emberRoute: "ember-route",
  eiaBulkId: "eia-bulk-id",
  eiaRoute: "eia-route",
  energyChartsEndpoint: "energy-charts-endpoint",
  gridstatusDatasetId: "gridstatus-dataset-id",
  odreDatasetId: "odre-dataset-id",
  url: "url"
} as const;

export const AliasScheme = Schema.Literals(aliasSchemes).annotate({
  description: "External identifier namespace"
});
export type AliasScheme = Schema.Schema.Type<typeof AliasScheme>;

export const aliasRelations = [
  "exactMatch", "closeMatch", "broadMatch", "narrowMatch", "methodologyVariant"
 ] as const;

export const AliasRelation = Schema.Literals(aliasRelations).annotate({
  description: "SKOS-aligned mapping relation strength. First four from W3C SKOS; methodologyVariant is Skygest's extension for gross-vs-net / sectoral-vs-reference / location-vs-market relations.",
  [SkosMapping]: "http://www.w3.org/2004/02/skos/core#mappingRelation",
  [DesignDecision]: "D4"
});
export type AliasRelation = Schema.Schema.Type<typeof AliasRelation>;

export const ExternalIdentifier = Schema.Struct({
  scheme: AliasScheme,
  value: Schema.String,
  uri: Schema.optionalKey(Schema.String),
  relation: AliasRelation
}).annotate({
  description: "Typed external identifier with SKOS-aligned relation strength (D3, D4)",
  [DesignDecision]: "D3, D4"
});
export type ExternalIdentifier = Schema.Schema.Type<typeof ExternalIdentifier>;

const validateUniqueSchemeValue = (aliases: ReadonlyArray<ExternalIdentifier>) => {
  const seen = new Set<string>();
  for (const alias of aliases) {
    const key = `${alias.scheme}\0${alias.value}`;
    if (seen.has(key)) {
      return `duplicate alias: (${alias.scheme}, ${alias.value}) appears more than once`;
    }
    seen.add(key);
  }
  return undefined;
};

export const Aliases = Schema.Array(ExternalIdentifier).pipe(
  Schema.check(Schema.makeFilter(validateUniqueSchemeValue))
).annotate({
  description: "External identifiers with enforced (scheme, value) uniqueness per entity (D3)"
});
export type Aliases = Schema.Schema.Type<typeof Aliases>;
