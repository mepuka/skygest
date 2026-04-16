import { Effect } from "effect";
import { DataFactory, type Quad } from "n3";

import {
  type ExternalIdentifier,
  uriResolvableAliasSchemes
} from "../../../src/domain/data-layer/alias";
import { type IRI, asIri } from "./Domain/Rdf";

const SKOS_ALT_LABEL = asIri("http://www.w3.org/2004/02/skos/core#altLabel");
const SKOS_EXACT_MATCH = asIri("http://www.w3.org/2004/02/skos/core#exactMatch");
const SKOS_CLOSE_MATCH = asIri("http://www.w3.org/2004/02/skos/core#closeMatch");
const SKOS_BROAD_MATCH = asIri("http://www.w3.org/2004/02/skos/core#broadMatch");
const SKOS_NARROW_MATCH = asIri("http://www.w3.org/2004/02/skos/core#narrowMatch");

export type AliasQuad = Quad;

const isAbsoluteIri = (value: string) =>
  value.startsWith("http://") || value.startsWith("https://");

const isUriResolvableAliasScheme = (
  scheme: ExternalIdentifier["scheme"]
): scheme is (typeof uriResolvableAliasSchemes)[number] =>
  (uriResolvableAliasSchemes as ReadonlyArray<string>).includes(scheme);

const toMappingPredicate = (
  relation: ExternalIdentifier["relation"]
): IRI | undefined => {
  switch (relation) {
    case "exactMatch":
      return SKOS_EXACT_MATCH;
    case "closeMatch":
      return SKOS_CLOSE_MATCH;
    case "broadMatch":
      return SKOS_BROAD_MATCH;
    case "narrowMatch":
      return SKOS_NARROW_MATCH;
    case "methodologyVariant":
      return undefined;
  }
};

const toObjectIri = (alias: ExternalIdentifier): IRI | undefined => {
  if (alias.uri !== undefined) {
    return asIri(alias.uri);
  }

  if (!isUriResolvableAliasScheme(alias.scheme)) {
    return undefined;
  }

  switch (alias.scheme) {
    case "wikidata":
      return asIri(
        isAbsoluteIri(alias.value)
          ? alias.value
          : `https://www.wikidata.org/entity/${alias.value}`
      );
    case "doi":
      return asIri(
        isAbsoluteIri(alias.value) ? alias.value : `https://doi.org/${alias.value}`
      );
    case "ror":
      return asIri(
        isAbsoluteIri(alias.value) ? alias.value : `https://ror.org/${alias.value}`
      );
    case "url":
      return asIri(alias.value);
  }
};

const logSkippedAlias = (
  subject: IRI,
  alias: ExternalIdentifier,
  reason: "unsupportedRelation" | "unsupportedScheme"
) =>
  Effect.logWarning("alias omitted from RDF emit").pipe(
    Effect.annotateLogs({
      subject,
      scheme: alias.scheme,
      value: alias.value,
      relation: alias.relation,
      reason
    })
  );

const emitAlias = (
  subject: IRI,
  alias: ExternalIdentifier
): Effect.Effect<ReadonlyArray<AliasQuad>> => {
  const subjectNode = DataFactory.namedNode(subject);
  const predicate = toMappingPredicate(alias.relation);

  if (predicate === undefined) {
    return logSkippedAlias(subject, alias, "unsupportedRelation").pipe(
      Effect.as([])
    );
  }

  if (alias.scheme === "display-alias") {
    return Effect.succeed([
      DataFactory.quad(
        subjectNode,
        DataFactory.namedNode(SKOS_ALT_LABEL),
        DataFactory.literal(alias.value, "en")
      )
    ]);
  }

  const objectIri = toObjectIri(alias);
  if (objectIri === undefined) {
    return logSkippedAlias(subject, alias, "unsupportedScheme").pipe(
      Effect.as([])
    );
  }

  return Effect.succeed([
    DataFactory.quad(
      subjectNode,
      DataFactory.namedNode(predicate),
      DataFactory.namedNode(objectIri)
    )
  ]);
};

export const emitAliases = Effect.fn("aliasEmitter.emitAliases")(function* (
  subject: IRI,
  aliases: ReadonlyArray<ExternalIdentifier>
) {
  const emitted = yield* Effect.forEach(aliases, (alias) => emitAlias(subject, alias));
  return emitted.flat();
});
