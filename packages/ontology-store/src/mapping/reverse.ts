import { DateTime, Effect, Schema } from "effect";
import type {
  Agent as AgentEntity,
  Catalog as CatalogEntity,
  CatalogRecord as CatalogRecordEntity,
  DataLayerRegistryEntity,
  DataService as DataServiceEntity,
  Dataset as DatasetEntity,
  DatasetSeries as DatasetSeriesEntity,
  Distribution as DistributionEntity,
  Series as SeriesEntity,
  Variable as VariableEntity
} from "../../../../src/domain/data-layer";
import {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  DatasetSeries,
  Distribution,
  Series,
  Variable
} from "../../../../src/domain/data-layer";
import { stringifyUnknown } from "../../../../src/platform/Json";
import emitSpecJson from "../../generated/emit-spec.json";
import {
  EmitSpec as EmitSpecSchema,
  type EmitSpecClassKey,
  type ForwardField,
  type ReverseField
} from "../Domain/EmitSpec";
import { type IRI, IRI as IriSchema, RdfError } from "../Domain/Rdf";
import { type RdfStore, RdfStoreService } from "../Service/RdfStore";

const asIri = Schema.decodeUnknownSync(IriSchema);
const emitSpec = Schema.decodeUnknownSync(EmitSpecSchema)(emitSpecJson);

const RDF_TYPE = asIri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const FOAF_PRIMARY_TOPIC = asIri("http://xmlns.com/foaf/0.1/primaryTopic");

type DistilledEntity =
  | AgentEntity
  | CatalogEntity
  | CatalogRecordEntity
  | DataServiceEntity
  | DatasetEntity
  | DatasetSeriesEntity
  | DistributionEntity
  | VariableEntity
  | SeriesEntity;

const mapRdfError = (operation: string) => (cause: unknown) => {
  const detail = stringifyUnknown(cause);
  return new RdfError({
    operation,
    message: detail,
    cause: detail
  });
};

const decodeByClass: {
  readonly [K in EmitSpecClassKey]: (input: unknown) => DistilledEntity;
} = {
  Agent: Schema.decodeUnknownSync(Agent) as (input: unknown) => DistilledEntity,
  Catalog: Schema.decodeUnknownSync(Catalog) as (input: unknown) => DistilledEntity,
  CatalogRecord: Schema.decodeUnknownSync(CatalogRecord) as (
    input: unknown
  ) => DistilledEntity,
  DataService: Schema.decodeUnknownSync(DataService) as (
    input: unknown
  ) => DistilledEntity,
  Dataset: Schema.decodeUnknownSync(Dataset) as (input: unknown) => DistilledEntity,
  DatasetSeries: Schema.decodeUnknownSync(DatasetSeries) as (
    input: unknown
  ) => DistilledEntity,
  Distribution: Schema.decodeUnknownSync(Distribution) as (
    input: unknown
  ) => DistilledEntity,
  Variable: Schema.decodeUnknownSync(Variable) as (
    input: unknown
  ) => DistilledEntity,
  Series: Schema.decodeUnknownSync(Series) as (input: unknown) => DistilledEntity
};

const forwardFieldByClass: {
  readonly [K in EmitSpecClassKey]: ReadonlyMap<string, ForwardField>;
} = Object.fromEntries(
  (Object.keys(emitSpec.classes) as ReadonlyArray<EmitSpecClassKey>).map((classKey) => [
    classKey,
    new Map(
      emitSpec.classes[classKey].forward.fields.map((field) => [
        field.runtimeName,
        field
      ])
    )
  ])
) as unknown as {
  readonly [K in EmitSpecClassKey]: ReadonlyMap<string, ForwardField>;
};

const ensureUnique = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => {
  const seen = new Set<string>();
  const deduped: Array<A> = [];

  for (const value of values) {
    const key =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(value);
    }
  }

  return deduped;
};

const collapseValues = (
  field: ReverseField,
  values: ReadonlyArray<unknown>
): unknown => {
  if (field.cardinality === "many") {
    return [...ensureUnique(values)].sort((left: unknown, right: unknown) =>
      String(left).localeCompare(String(right))
    );
  }

  return values[0];
};

const readTermValue = (
  classKey: EmitSpecClassKey,
  field: ReverseField,
  term: { readonly termType: string; readonly value: string }
): unknown => {
  const forwardField = forwardFieldByClass[classKey].get(field.runtimeName);
  const valueKind = forwardField?.valueKind;

  if (valueKind === undefined) {
    return term.value;
  }

  switch (valueKind._tag) {
    case "Iri":
      return term.value;
    case "EnumLiteral":
      return term.value;
    case "Literal":
      switch (valueKind.primitive) {
        case "string":
          return term.value;
        case "number":
          return Number(term.value);
        case "boolean":
          return term.value === "true";
      }
  }
};

const querySubjectsByType = Effect.fn("reverse.querySubjectsByType")(function* (
  store: RdfStore,
  classIri: IRI
) {
  const rdf = yield* RdfStoreService;
  const quads = yield* rdf.query(store, {
    predicate: RDF_TYPE,
    object: classIri
  });

  return ensureUnique(
    quads
      .filter((quad) => quad.subject.termType === "NamedNode")
      .map((quad) => quad.subject.value)
  ).slice().sort((left: string, right: string) => left.localeCompare(right));
});

const queryPredicateValues = Effect.fn("reverse.queryPredicateValues")(function* (
  store: RdfStore,
  subject: IRI,
  field: ReverseField,
  classKey: EmitSpecClassKey
) {
  const rdf = yield* RdfStoreService;
  const distillFrom = field.distillFrom;

  if (distillFrom._tag !== "Predicate" && distillFrom._tag !== "PredicateWithPrecedence") {
    return [];
  }

  const quads = yield* rdf.query(store, {
    subject,
    predicate: distillFrom.predicate
  });

  return quads.map((quad) => readTermValue(classKey, field, quad.object));
});

const queryInverseEdgeValues = Effect.fn("reverse.queryInverseEdgeValues")(function* (
  store: RdfStore,
  subject: IRI,
  field: ReverseField
) {
  const rdf = yield* RdfStoreService;
  const distillFrom = field.distillFrom;

  if (distillFrom._tag !== "InverseEdge") {
    return [];
  }

  const incoming = yield* rdf.query(store, {
    predicate: distillFrom.forwardPredicate,
    object: subject
  });

  const matchingSubjects: Array<string> = [];
  for (const quad of incoming) {
    if (quad.subject.termType !== "NamedNode") {
      continue;
    }

    const typeQuads = yield* rdf.query(store, {
      subject: asIri(quad.subject.value),
      predicate: RDF_TYPE,
      object: distillFrom.forwardOwnerClassIri
    });

    if (typeQuads.length > 0) {
      matchingSubjects.push(quad.subject.value);
    }
  }

  return ensureUnique(matchingSubjects)
    .slice()
    .sort((left: string, right: string) => left.localeCompare(right));
});

const derivePrimaryTopicType = Effect.fn("reverse.derivePrimaryTopicType")(function* (
  store: RdfStore,
  subject: IRI
) {
  const rdf = yield* RdfStoreService;
  const topicQuads = yield* rdf.query(store, {
    subject,
    predicate: FOAF_PRIMARY_TOPIC
  });
  const topic = topicQuads.find((quad) => quad.object.termType === "NamedNode");

  if (topic?.object.termType !== "NamedNode") {
    return undefined;
  }

  const topicIri = asIri(topic.object.value);
  const datasetType = yield* rdf.query(store, {
    subject: topicIri,
    predicate: RDF_TYPE,
    object: emitSpec.classes.Dataset.primaryClassIri
  });
  if (datasetType.length > 0) {
    return "dataset";
  }

  const dataServiceType = yield* rdf.query(store, {
    subject: topicIri,
    predicate: RDF_TYPE,
    object: emitSpec.classes.DataService.primaryClassIri
  });
  if (dataServiceType.length > 0) {
    return "dataService";
  }

  return topic.object.value.includes("/data-service/") ? "dataService" : "dataset";
});

const deriveVariableIds = Effect.fn("reverse.deriveVariableIds")(function* (
  store: RdfStore,
  subject: IRI
) {
  const rdf = yield* RdfStoreService;
  const seriesDatasetField = forwardFieldByClass.Series.get("datasetId");
  const seriesVariableField = forwardFieldByClass.Series.get("variableId");

  if (
    seriesDatasetField?.predicate === null ||
    seriesDatasetField?.predicate === undefined ||
    seriesVariableField?.predicate === null ||
    seriesVariableField?.predicate === undefined
  ) {
    return [];
  }

  const incoming = yield* rdf.query(store, {
    predicate: seriesDatasetField.predicate,
    object: subject
  });

  const variableIds: Array<string> = [];

  for (const quad of incoming) {
    if (quad.subject.termType !== "NamedNode") {
      continue;
    }

    const typeQuads = yield* rdf.query(store, {
      subject: asIri(quad.subject.value),
      predicate: RDF_TYPE,
      object: emitSpec.classes.Series.primaryClassIri
    });
    if (typeQuads.length === 0) {
      continue;
    }

    const variableQuads = yield* rdf.query(store, {
      subject: asIri(quad.subject.value),
      predicate: seriesVariableField.predicate
    });
    for (const variableQuad of variableQuads) {
      if (variableQuad.object.termType === "NamedNode") {
        variableIds.push(variableQuad.object.value);
      }
    }
  }

  return ensureUnique(variableIds)
    .slice()
    .sort((left: string, right: string) => left.localeCompare(right));
});

const resolveDefaultValue = Effect.fn("reverse.resolveDefaultValue")(function* (
  store: RdfStore,
  classKey: EmitSpecClassKey,
  field: ReverseField,
  subject: IRI,
  distilledAt: string
) {
  const defaultValue =
    field.distillFrom._tag === "Default" ? field.distillFrom.defaultValue : undefined;

  if (defaultValue === "<inject>") {
    return distilledAt;
  }

  if (defaultValue === "<derive-from-primary-topic-class>") {
    return yield* derivePrimaryTopicType(store, subject);
  }

  if (defaultValue === "<derive-from-series>") {
    return yield* deriveVariableIds(store, subject);
  }

  if (defaultValue === null) {
    if (classKey === "Agent" && field.runtimeName === "kind") {
      return "organization";
    }
    if (classKey === "Distribution" && field.runtimeName === "kind") {
      return "other";
    }
    return undefined;
  }

  return defaultValue;
});

const distillField = Effect.fn("reverse.distillField")(function* (
  store: RdfStore,
  classKey: EmitSpecClassKey,
  field: ReverseField,
  subject: IRI,
  distilledAt: string
) {
  switch (field.distillFrom._tag) {
    case "SubjectIri":
      return subject;
    case "Predicate":
    case "PredicateWithPrecedence": {
      const values = yield* queryPredicateValues(store, subject, field, classKey);
      return collapseValues(field, values);
    }
    case "InverseEdge": {
      const values = yield* queryInverseEdgeValues(store, subject, field);
      return collapseValues(field, values);
    }
    case "Default":
      return yield* resolveDefaultValue(store, classKey, field, subject, distilledAt);
  }
});

const distillClassEntities = Effect.fn("reverse.distillClassEntities")(function* (
  store: RdfStore,
  classKey: EmitSpecClassKey,
  distilledAt: string
) {
  const classSpec = emitSpec.classes[classKey];
  const subjects = yield* querySubjectsByType(
    store,
    classSpec.reverse.subjectSelector.classIri
  );

  return yield* Effect.forEach(subjects, (subjectValue) =>
    Effect.gen(function* () {
      const subject = asIri(subjectValue);
      const raw: Record<string, unknown> = {};

      for (const field of classSpec.reverse.fields) {
        const value = yield* distillField(store, classKey, field, subject, distilledAt);
        if (value !== undefined) {
          raw[field.runtimeName] = value;
        }
      }

      return yield* Effect.try({
        try: () => decodeByClass[classKey](raw),
        catch: mapRdfError(`distill:${classKey}`)
      });
    })
  );
});

export const distillEntities = Effect.fn("reverse.distillEntities")(function* (
  store: RdfStore
) {
  const distilledAt = DateTime.formatIso(yield* DateTime.now);
  const entities = yield* Effect.forEach(
    Object.keys(emitSpec.classes) as ReadonlyArray<EmitSpecClassKey>,
    (classKey) => distillClassEntities(store, classKey, distilledAt)
  );

  return entities.flat();
});
