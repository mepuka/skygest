/**
 * Class table → JSON Schema 2020-12 builder.
 *
 * Stage 2 of the TTL → Effect Schema codegen pipeline. Consumes the
 * `ClassTable` produced by Task 6's `parseTtl.ts` and emits a JSON Schema
 * 2020-12 document where each class becomes a `$defs` entry. Task 8 hands
 * this document to Effect's `SchemaRepresentation.fromJsonSchemaDocument` to
 * build an AST; Task 9 wires it all together.
 *
 * Scope discipline:
 * - No AST manipulation here (Task 8).
 * - No file IO (Task 9).
 * - `equivalentClassRestrictions` from `ClassRecord` are NOT consumed; Task 8
 *   folds them at the AST level. This builder simply ignores them.
 * - Cardinality is read straight off `ClassProperty.optional` / `.list`. Per
 *   Task 6's defaults every property starts optional + single, so `required`
 *   is omitted from output until upstream cardinality lands.
 *
 * Key sanitization choice: property keys use the IRI's last path segment or
 * fragment verbatim (alphanumeric + `_`), so `bfo:0000053` → `BFO_0000053`.
 * Task 8's AST post-processor can rename to friendlier names (`bearerOf`)
 * after the fact.
 */
import type { ClassProperty, ClassTable } from "./parseTtl.ts";

export interface JsonSchemaPrimitive {
  readonly type: "string" | "number" | "integer" | "boolean";
  readonly format?: string;
}

export interface JsonSchemaArray {
  readonly type: "array";
  readonly items: JsonSchemaProperty;
}

export interface JsonSchemaRef {
  readonly $ref: string;
}

export type JsonSchemaProperty =
  | JsonSchemaPrimitive
  | JsonSchemaArray
  | JsonSchemaRef;

export interface JsonSchemaObject {
  readonly type: "object";
  readonly properties: Record<string, JsonSchemaProperty>;
  readonly required?: ReadonlyArray<string>;
  readonly description?: string;
}

export interface JsonSchemaDocument {
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly $id?: string;
  readonly $defs: Record<string, JsonSchemaObject>;
}

const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/**
 * XSD datatype IRI → JSON Schema primitive shape.
 *
 * Covers the slice's expected datatypes; any IRI not present here either
 * resolves to a class `$ref` or falls through to a `string` default with a
 * `console.warn` (see `mapRange`).
 */
const XSD_TYPE_MAP: Readonly<Record<string, JsonSchemaPrimitive>> = {
  "http://www.w3.org/2001/XMLSchema#string": { type: "string" },
  "http://www.w3.org/2001/XMLSchema#integer": { type: "integer" },
  "http://www.w3.org/2001/XMLSchema#decimal": { type: "number" },
  "http://www.w3.org/2001/XMLSchema#double": { type: "number" },
  "http://www.w3.org/2001/XMLSchema#float": { type: "number" },
  "http://www.w3.org/2001/XMLSchema#boolean": { type: "boolean" },
  "http://www.w3.org/2001/XMLSchema#dateTime": {
    type: "string",
    format: "date-time"
  },
  "http://www.w3.org/2001/XMLSchema#date": {
    type: "string",
    format: "date"
  }
};

/**
 * Last URL path segment / fragment, with non-alphanumeric chars (other than
 * underscore) collapsed. Drives both `$defs` keys and property keys.
 *
 *  https://w3id.org/energy-intel/Expert    -> Expert
 *  http://xmlns.com/foaf/0.1/name          -> name
 *  http://purl.obolibrary.org/obo/BFO_0000053 -> BFO_0000053
 *  https://w3id.org/energy-intel/age#hash  -> hash
 */
const localName = (iri: string): string => {
  const hashIdx = iri.lastIndexOf("#");
  const tail =
    hashIdx >= 0 ? iri.slice(hashIdx + 1) : iri.slice(iri.lastIndexOf("/") + 1);
  // JSON Schema property keys must be JSON strings (no constraint at spec
  // level), but downstream Effect code generation prefers identifier-safe
  // keys. Replace runs of non-(alnum|underscore) with underscore.
  const sanitized = tail.replace(/[^A-Za-z0-9_]+/g, "_");
  return sanitized.length === 0 ? "_" : sanitized;
};

const mapRange = (
  range: string | undefined,
  classDefKeys: ReadonlyMap<string, string>
): JsonSchemaProperty => {
  if (range === undefined) {
    // TODO: surface as a structured diagnostic once Task 9 wires logging.
    return { type: "string" };
  }
  const xsd = XSD_TYPE_MAP[range];
  if (xsd !== undefined) return xsd;
  const defKey = classDefKeys.get(range);
  if (defKey !== undefined) return { $ref: `#/$defs/${defKey}` };
  console.warn(
    `[buildJsonSchema] Unknown range IRI ${range}; defaulting to "string".`
  );
  return { type: "string" };
};

const propertyShape = (
  prop: ClassProperty,
  classDefKeys: ReadonlyMap<string, string>
): JsonSchemaProperty => {
  const base = mapRange(prop.range, classDefKeys);
  return prop.list ? { type: "array", items: base } : base;
};

export const buildJsonSchema = (table: ClassTable): JsonSchemaDocument => {
  // Pre-build IRI → $defs key map so cross-class $ref resolution is O(1)
  // and order-independent (a property's range may resolve to a class that
  // appears later in `table.classes`).
  const classDefKeys = new Map<string, string>();
  for (const cls of table.classes) {
    classDefKeys.set(cls.iri, localName(cls.iri));
  }

  const $defs: Record<string, JsonSchemaObject> = {};
  for (const cls of table.classes) {
    const defKey = classDefKeys.get(cls.iri)!;
    const properties: Record<string, JsonSchemaProperty> = {};
    for (const prop of cls.properties) {
      const key = localName(prop.iri);
      properties[key] = propertyShape(prop, classDefKeys);
    }
    // TODO: emit `required: [...]` once parseTtl wires owl:Restriction
    // cardinality off blank-node restrictions; today every property is
    // optional per parseTtl.ts default.
    $defs[defKey] = {
      type: "object",
      properties
    };
  }

  return {
    $schema: JSON_SCHEMA_2020_12,
    $defs
  };
};
