/// <reference path="../types/shacl-runtime.d.ts" />

import rdfDataModel from "@rdfjs/data-model";
import rdfDataset from "@rdfjs/dataset";
import { Effect, Layer, Scope, Schema, ServiceMap } from "effect";
import { Validator } from "shacl-engine";

import { stringifyUnknown } from "../../../../src/platform/Json";
import { type RdfStore, RdfStoreService } from "./RdfStore";
import { asIri } from "../Domain/Rdf";
import {
  type ShaclValidationReport,
  ShaclValidationReport as ShaclValidationReportSchema,
  type ShaclViolation,
  ShapesLoadError,
  ShaclValidationError
} from "../Domain/Shacl";

const decodeShaclValidationReport = Schema.decodeUnknownEffect(ShaclValidationReportSchema);

const shaclFactory = Object.assign(Object.create(rdfDataModel), {
  dataset: rdfDataset.dataset
});

const mapShapesLoadError = (cause: unknown) =>
  new ShapesLoadError({
    operation: "loadShapes",
    message: stringifyUnknown(cause),
    cause: stringifyUnknown(cause)
  });

const mapShaclValidationError = (operation: string) => (cause: unknown) =>
  new ShaclValidationError({
    operation,
    message: stringifyUnknown(cause),
    cause: stringifyUnknown(cause)
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

const failValidation = (operation: string, message: string) =>
  Effect.fail(
    new ShaclValidationError({
      operation,
      message,
      cause: message
    })
  );

const toSeverity = (
  operation: string,
  iri: string
): Effect.Effect<ShaclViolation["severity"], ShaclValidationError> => {
  switch (iri) {
    case "http://www.w3.org/ns/shacl#Violation":
      return Effect.succeed("Violation");
    case "http://www.w3.org/ns/shacl#Warning":
      return Effect.succeed("Warning");
    case "http://www.w3.org/ns/shacl#Info":
      return Effect.succeed("Info");
    default:
      return failValidation(operation, `Unsupported SHACL severity: ${iri}`);
  }
};

const requireValue = (
  operation: string,
  field: string,
  value: string | undefined
): Effect.Effect<string, ShaclValidationError> => {
  if (value === undefined || value.length === 0) {
    return failValidation(operation, `Missing ${field} in shacl-engine result`);
  }

  return Effect.succeed(value);
};

const requireIri = (
  operation: string,
  field: string,
  value: string | undefined
) =>
  requireValue(operation, field, value).pipe(
    Effect.andThen((iri) =>
      Effect.try({
        try: () => asIri(iri),
        catch: mapShaclValidationError(operation)
      })
    )
  );

const adaptViolation = (
  operation: string,
  result: {
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
  }
): Effect.Effect<ShaclViolation, ShaclValidationError> =>
  Effect.gen(function* () {
    const path = serializePath(result.path);
    const value = result.value?.term?.value;
    const focusNode = yield* requireIri(
      operation,
      "focusNode",
      result.focusNode?.term?.value
    );
    const sourceShape = yield* requireIri(
      operation,
      "sourceShape",
      result.shape?.ptr?.term?.value
    );
    const sourceConstraint = yield* requireIri(
      operation,
      "sourceConstraint",
      result.constraintComponent?.value
    );
    const severityIri = yield* requireValue(
      operation,
      "severity",
      result.severity?.value
    );

    return {
      focusNode,
      sourceShape,
      sourceConstraint,
      severity: yield* toSeverity(operation, severityIri),
      message:
        result.message
          ?.map((item) => item.value)
          .filter((value): value is string => value !== undefined && value.length > 0)
          .join(" | ") || sourceConstraint,
      ...(path === undefined ? {} : { path }),
      ...(value === undefined ? {} : { value })
    };
  });

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

        const violations = yield* Effect.forEach(report.results, (result) =>
          adaptViolation("validate", result)
        );

        return yield* decodeShaclValidationReport({
          conforms: report.conforms,
          violations
        }).pipe(Effect.mapError(mapShaclValidationError("validate")));
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
