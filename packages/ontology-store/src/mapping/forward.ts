import { Effect } from "effect";
import { DataFactory, type Quad } from "n3";

import type { DataLayerRegistryEntity } from "../../../../src/domain/data-layer";
import {
  type EmitSpecClassKey,
  type ForwardField,
  type ValueKind
} from "../Domain/EmitSpec";
import { type IRI, asIri } from "../Domain/Rdf";
import { emitAliases } from "../aliasEmitter";
import { loadedEmitSpec as emitSpec } from "../loadedEmitSpec";

const RDF_TYPE = asIri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");

const xsdDatatypeIri = {
  "xsd:string": asIri("http://www.w3.org/2001/XMLSchema#string"),
  "xsd:dateTime": asIri("http://www.w3.org/2001/XMLSchema#dateTime"),
  "xsd:date": asIri("http://www.w3.org/2001/XMLSchema#date"),
  "xsd:integer": asIri("http://www.w3.org/2001/XMLSchema#integer"),
  "xsd:decimal": asIri("http://www.w3.org/2001/XMLSchema#decimal"),
  "xsd:boolean": asIri("http://www.w3.org/2001/XMLSchema#boolean")
} as const;

export type ForwardQuad = Quad;

const toSubjectIri = (entity: DataLayerRegistryEntity): IRI =>
  asIri(String(entity.id));

const subjectQuad = (subject: IRI, predicate: IRI, object: Quad["object"]): ForwardQuad =>
  DataFactory.quad(
    DataFactory.namedNode(subject),
    DataFactory.namedNode(predicate),
    object
  );

const toLiteralLexicalForm = (primitive: ValueKind & { readonly _tag: "Literal" }, value: unknown) => {
  switch (primitive.primitive) {
    case "string":
      return String(value);
    case "number":
      return String(value);
    case "boolean":
      return value === true ? "true" : "false";
  }
};

const encodeObject = (valueKind: ValueKind, value: unknown): Quad["object"] => {
  switch (valueKind._tag) {
    case "Iri":
      return DataFactory.namedNode(String(value));
    case "EnumLiteral":
      return DataFactory.literal(
        String(value),
        DataFactory.namedNode(xsdDatatypeIri["xsd:string"])
      );
    case "Literal":
      return DataFactory.literal(
        toLiteralLexicalForm(valueKind, value),
        DataFactory.namedNode(xsdDatatypeIri[valueKind.xsdDatatype])
      );
  }
};

const toValues = (field: ForwardField, value: unknown): ReadonlyArray<unknown> => {
  if (value === undefined || value === null) {
    return [];
  }

  if (field.cardinality === "many") {
    return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
  }

  return [value];
};

const emitFieldQuads = (
  subject: IRI,
  field: ForwardField,
  value: unknown
): ReadonlyArray<ForwardQuad> => {
  const predicate = field.predicate;
  const valueKind = field.valueKind;

  if (field.skipEmit === true || predicate === null || valueKind === undefined) {
    return [];
  }

  return toValues(field, value).map((item) =>
    subjectQuad(subject, predicate, encodeObject(valueKind, item))
  );
};

const emitTypeQuads = (
  subject: IRI,
  classKey: EmitSpecClassKey
): ReadonlyArray<ForwardQuad> => {
  const classSpec = emitSpec.classes[classKey];
  return [
    subjectQuad(
      subject,
      RDF_TYPE,
      DataFactory.namedNode(classSpec.primaryClassIri)
    ),
    ...classSpec.additionalClassIris.map((classIri) =>
      subjectQuad(subject, RDF_TYPE, DataFactory.namedNode(classIri))
    )
  ];
};

export const emitEntityQuads = Effect.fn("forward.emitEntityQuads")(function* (
  entity: DataLayerRegistryEntity
) {
  const subject = toSubjectIri(entity);
  const classKey = entity._tag as EmitSpecClassKey;
  const classSpec = emitSpec.classes[classKey];
  const record = entity as Record<string, unknown>;
  const aliases = "aliases" in entity ? entity.aliases : [];

  const fieldQuads = classSpec.forward.fields.flatMap((field) =>
    emitFieldQuads(subject, field, record[field.runtimeName])
  );

  const aliasQuads = yield* emitAliases(subject, aliases);

  return [
    ...emitTypeQuads(subject, classKey),
    ...fieldQuads,
    ...aliasQuads
  ];
});
