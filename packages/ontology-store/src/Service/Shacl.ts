import rdfDataModel from "@rdfjs/data-model";
import rdfDataset from "@rdfjs/dataset";
import { Effect, Layer, Scope, Schema, ServiceMap } from "effect";
import { Validator } from "shacl-engine";

import { type RdfStore, RdfStoreService } from "./RdfStore";
import {
  type ShaclValidationReport,
  ShaclValidationReport as ShaclValidationReportSchema,
  type ShaclViolation,
  ShapesLoadError,
  ShaclValidationError
} from "../Domain/Shacl";

const decodeShaclValidationReport =
  Schema.decodeUnknownSync(ShaclValidationReportSchema);

const shaclFactory = Object.assign(Object.create(rdfDataModel), {
  dataset: rdfDataset.dataset
});

const serializeUnknown = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const mapShapesLoadError = (cause: unknown) =>
  new ShapesLoadError({
    operation: "loadShapes",
    message: serializeUnknown(cause),
    cause: serializeUnknown(cause)
  });

const mapShaclValidationError = (operation: string) => (cause: unknown) =>
  new ShaclValidationError({
    operation,
    message: serializeUnknown(cause),
    cause: serializeUnknown(cause)
  });

const pathQuantifierSuffix = (quantifier: string) => {
  switch (quantifier) {
    case "zeroOrMore":
      return "*";
    case "oneOrMore":
      return "+";
    case "zeroOrOne":
      return "?";
    default:
      return "";
  }
};

const serializePath = (
  path:
    | ReadonlyArray<{
        readonly quantifier: string;
        readonly start: string;
        readonly predicates: ReadonlyArray<{ readonly value: string }>;
      }>
    | undefined
) => {
  if (path === undefined) {
    return undefined;
  }

  return path
    .map((step) => {
      const predicatePart = step.predicates.map((predicate) => predicate.value).join(" | ");
      const direction = step.start === "object" ? "^" : "";
      return `${direction}${predicatePart}${pathQuantifierSuffix(step.quantifier)}`;
    })
    .join(" / ");
};

const toSeverity = (iri: string): ShaclViolation["severity"] => {
  switch (iri) {
    case "http://www.w3.org/ns/shacl#Violation":
      return "Violation";
    case "http://www.w3.org/ns/shacl#Warning":
      return "Warning";
    case "http://www.w3.org/ns/shacl#Info":
      return "Info";
    default:
      throw new Error(`Unsupported SHACL severity: ${iri}`);
  }
};

const requireValue = (field: string, value: string | undefined) => {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${field} in shacl-engine result`);
  }

  return value;
};

const adaptViolation = (result: {
  readonly focusNode?: { readonly term?: { readonly value?: string } };
  readonly shape?: { readonly ptr?: { readonly term?: { readonly value?: string } } };
  readonly constraintComponent?: { readonly value?: string };
  readonly severity?: { readonly value?: string };
  readonly message?: ReadonlyArray<{ readonly value?: string }>;
  readonly path?: ReadonlyArray<{
    readonly quantifier: string;
    readonly start: string;
    readonly predicates: ReadonlyArray<{ readonly value: string }>;
  }>;
  readonly value?: { readonly term?: { readonly value?: string } };
}): ShaclViolation => {
  const path = serializePath(result.path);
  const value = result.value?.term?.value;

  return {
    focusNode: requireValue("focusNode", result.focusNode?.term?.value),
    sourceShape: requireValue("sourceShape", result.shape?.ptr?.term?.value),
    sourceConstraint: requireValue(
      "sourceConstraint",
      result.constraintComponent?.value
    ),
    severity: toSeverity(requireValue("severity", result.severity?.value)),
    message:
      result.message
        ?.map((item) => item.value)
        .filter((value): value is string => value !== undefined && value.length > 0)
        .join(" | ") || requireValue("sourceConstraint", result.constraintComponent?.value),
    ...(path === undefined ? {} : { path }),
    ...(value === undefined ? {} : { value })
  };
};

export class ShaclService extends ServiceMap.Service<
  ShaclService,
  {
    readonly loadShapes: (
      text: string
    ) => Effect.Effect<RdfStore, ShapesLoadError, Scope.Scope>;
    readonly validate: (
      dataStore: RdfStore,
      shapesStore: RdfStore
    ) => Effect.Effect<ShaclValidationReport, ShaclValidationError>;
  }
>()("@skygest/ontology-store/ShaclService") {
  static readonly layer = Layer.effect(
    ShaclService,
    Effect.gen(function* () {
      const rdf = yield* RdfStoreService;

      const loadShapes = Effect.fn("ShaclService.loadShapes")(function* (
        text: string
      ) {
        const store = yield* rdf.makeStore;

        yield* rdf.parseTurtle(store, text).pipe(
          Effect.mapError(mapShapesLoadError)
        );

        return store;
      });

      const validate = Effect.fn("ShaclService.validate")(function* (
        dataStore: RdfStore,
        shapesStore: RdfStore
      ) {
        const validator = yield* Effect.try({
          try: () => new Validator(shapesStore, { factory: shaclFactory }),
          catch: mapShaclValidationError("validate")
        });

        const report = yield* Effect.tryPromise({
          try: () => validator.validate({ dataset: dataStore }),
          catch: mapShaclValidationError("validate")
        });

        return yield* Effect.try({
          try: () =>
            decodeShaclValidationReport({
              conforms: report.conforms,
              violations: report.results.map(adaptViolation)
            }),
          catch: mapShaclValidationError("validate")
        });
      });

      return ShaclService.of({
        loadShapes,
        validate
      });
    })
  );

  static readonly Default = ShaclService.layer.pipe(
    Layer.provide(RdfStoreService.Default)
  );
}
