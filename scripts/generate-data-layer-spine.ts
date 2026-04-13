import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Path, Result, Schema } from "effect";
import {
  DataLayerSpineGenerationError,
  DataLayerSpineManifestLoadError
} from "../src/domain/errors";
import {
  DataLayerSpineManifest,
  type SpineBrandedIdRef,
  type SpineClassKey,
  type SpineClassSpec,
  type SpineFieldSpec,
  type SpineFieldType,
  type SpineLiteralKind
} from "../src/domain/dataLayerSpineManifest";
import {
  decodeJsonStringEitherWith,
  formatSchemaParseError,
  stringifyUnknown
} from "../src/platform/Json";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

type CliOptions = {
  readonly manifest: string;
  readonly output: string;
};

type SpineManifest = Schema.Schema.Type<typeof DataLayerSpineManifest>;

type ImportSpec = {
  readonly name: string;
  readonly path: string;
};

type RenderedFieldType = {
  readonly expr: string;
  readonly imports: ReadonlyArray<ImportSpec>;
};

type RenderedFragment = {
  readonly source: string;
  readonly imports: ReadonlyArray<ImportSpec>;
  readonly usesDcatProperty: boolean;
};

const CLASS_ORDER: ReadonlyArray<SpineClassKey> = [
  "Agent",
  "Dataset",
  "Variable",
  "Series"
];

const BRANDED_ID_IMPORT_PATH: Record<SpineBrandedIdRef, string> = {
  AgentId: "../data-layer/ids",
  CatalogId: "../data-layer/ids",
  CatalogRecordId: "../data-layer/ids",
  DataServiceId: "../data-layer/ids",
  DatasetId: "../data-layer/ids",
  DatasetSeriesId: "../data-layer/ids",
  DistributionId: "../data-layer/ids",
  SeriesId: "../data-layer/ids",
  VariableId: "../data-layer/ids"
};

const CLOSED_ENUM_IMPORT_PATH: Record<string, string> = {
  AgentKind: "../data-layer/catalog",
  DistributionKind: "../data-layer/catalog",
  AccessRights: "../data-layer/catalog",
  Cadence: "../data-layer/catalog",
  StatisticType: "../data-layer/variable-enums",
  Aggregation: "../data-layer/variable-enums",
  UnitFamily: "../data-layer/variable-enums"
};

const STRUCT_IMPORT_PATH: Record<string, string> = {
  Aliases: "../data-layer/alias",
  FixedDims: "../data-layer/variable"
};

const manifestFlag = Flag.string("manifest").pipe(
  Flag.withDescription("Checked-in data-layer spine manifest path"),
  Flag.withDefault("references/data-layer-spine/manifest.json")
);

const outputFlag = Flag.string("output").pipe(
  Flag.withDescription("Generated data-layer spine file"),
  Flag.withDefault("src/domain/generated/dataLayerSpine.ts")
);

const decodeManifestJson = decodeJsonStringEitherWith(DataLayerSpineManifest);

const manifestLoadError = (path: string, issues: ReadonlyArray<string>) =>
  new DataLayerSpineManifestLoadError({
    message: `invalid data-layer spine manifest at ${path}`,
    path,
    issues: [...issues]
  });

const generationError = (
  operation: string,
  path: string,
  cause: unknown
) =>
  new DataLayerSpineGenerationError({
    operation,
    path,
    message: stringifyUnknown(cause)
  });

const assertNever = (value: never): never => value;

const importSpec = (name: string, path: string): ImportSpec => ({ name, path });

const importPathFor = (
  registry: Readonly<Record<string, string>>,
  name: string
) => registry[name] ?? missingImportPath(name);

const literalExpr = (literalKind: SpineLiteralKind) => {
  switch (literalKind) {
    case "string":
      return "Schema.String";
    case "number":
      return "Schema.Number";
    case "boolean":
      return "Schema.Boolean";
  }
};

const missingImportPath = (name: string) => `__missing__/${name}`;

const renderFieldType = (fieldType: SpineFieldType): RenderedFieldType => {
  switch (fieldType._tag) {
    case "brandedId":
      return {
        expr: fieldType.ref,
        imports: [
          importSpec(fieldType.ref, importPathFor(BRANDED_ID_IMPORT_PATH, fieldType.ref))
        ]
      };
    case "brandedIdArray":
      return {
        expr: `Schema.Array(${fieldType.ref})`,
        imports: [
          importSpec(fieldType.ref, importPathFor(BRANDED_ID_IMPORT_PATH, fieldType.ref))
        ]
      };
    case "literal":
      return { expr: literalExpr(fieldType.literalKind), imports: [] };
    case "literalArray": {
      const elementExpr = literalExpr(fieldType.literalKind);
      return { expr: `Schema.Array(${elementExpr})`, imports: [] };
    }
    case "closedEnum": {
      const importPath = importPathFor(CLOSED_ENUM_IMPORT_PATH, fieldType.enumName);
      return {
        expr: fieldType.enumName,
        imports: [importSpec(fieldType.enumName, importPath)]
      };
    }
    case "closedEnumArray": {
      const importPath = importPathFor(CLOSED_ENUM_IMPORT_PATH, fieldType.enumName);
      return {
        expr: `Schema.Array(${fieldType.enumName})`,
        imports: [importSpec(fieldType.enumName, importPath)]
      };
    }
    case "struct": {
      const importPath = importPathFor(STRUCT_IMPORT_PATH, fieldType.structName);
      return {
        expr: fieldType.structName,
        imports: [importSpec(fieldType.structName, importPath)]
      };
    }
    case "webUrl":
      return {
        expr: "WebUrl",
        imports: [importSpec("WebUrl", "../data-layer/base")]
      };
    case "dateLike":
      return {
        expr: "DateLike",
        imports: [importSpec("DateLike", "../data-layer/base")]
      };
    case "isoTimestamp":
      return {
        expr: "IsoTimestamp",
        imports: [importSpec("IsoTimestamp", "../types")]
      };
    default:
      return assertNever(fieldType);
  }
};

const renderObjectKey = (fieldName: string) =>
  /^[$A-Z_][0-9A-Z_$]*$/iu.test(fieldName)
    ? fieldName
    : JSON.stringify(fieldName);

const renderAnnotatedExpr = (expr: string, ontologyIri: string | null) =>
  ontologyIri === null
    ? expr
    : `${expr}.annotate({ [DcatProperty]: ${JSON.stringify(ontologyIri)} })`;

const renderFieldLine = (field: SpineFieldSpec) => {
  const rendered = renderFieldType(field.type);
  const annotated = renderAnnotatedExpr(rendered.expr, field.ontologyIri);
  const expr = field.optional
    ? `Schema.optionalKey(${annotated})`
    : annotated;

  return {
    line: `  ${renderObjectKey(field.runtimeName)}: ${expr},`,
    imports: rendered.imports,
    usesDcatProperty: field.ontologyIri !== null
  };
};

const renderFragment = (
  classKey: SpineClassKey,
  classSpec: SpineClassSpec
): RenderedFragment => {
  const generatedFields = classSpec.fields.filter(
    (field) => field.generation === "generated"
  );
  const renderedFields = generatedFields.map(renderFieldLine);

  return {
    source: [
      `export const ${classKey}OntologyFields = {`,
      ...renderedFields.map((field) => field.line),
      "} as const;"
    ].join("\n"),
    imports: renderedFields.flatMap((field) => field.imports),
    usesDcatProperty: renderedFields.some((field) => field.usesDcatProperty)
  };
};

const renderImportBlock = (
  imports: ReadonlyArray<ImportSpec>,
  needsDcatProperty: boolean
) => {
  const grouped = new Map<string, Set<string>>();

  for (const entry of imports) {
    const names = grouped.get(entry.path) ?? new Set<string>();
    names.add(entry.name);
    grouped.set(entry.path, names);
  }

  const rendered = [
    `import { Schema } from "effect";`,
    ...(needsDcatProperty
      ? [`import { DcatProperty } from "../data-layer/annotations";`]
      : []),
    ...[...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([path, names]) =>
          `import { ${[...names].sort().join(", ")} } from "${path}";`
      )
  ];

  return rendered.join("\n");
};

export const renderSpineFile = (manifest: SpineManifest) => {
  const fragments = CLASS_ORDER.map((classKey) =>
    renderFragment(classKey, manifest.classes[classKey])
  );
  const usesDcatProperty = fragments.some((fragment) => fragment.usesDcatProperty);

  return [
    "/**",
    " * AUTO-GENERATED. DO NOT EDIT.",
    " *",
    " * Source manifest: references/data-layer-spine/manifest.json",
    ` * Manifest version: ${String(manifest.manifestVersion)}`,
    ` * Ontology version: ${manifest.ontologyVersion}`,
    ` * Source commit: ${manifest.sourceCommit}`,
    ` * Generated at: ${manifest.generatedAt}`,
    ` * Input hash: ${manifest.inputHash}`,
    " * Generation command: bun run gen:data-layer-spine",
    " */",
    "",
    renderImportBlock(
      fragments.flatMap((fragment) => fragment.imports),
      usesDcatProperty
    ),
    "",
    fragments.map((fragment) => fragment.source).join("\n\n")
  ].join("\n");
};

export const decodeDataLayerSpineManifest = (
  manifestPath: string,
  raw: string
) => {
  const decoded = decodeManifestJson(raw);
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      manifestLoadError(manifestPath, [formatSchemaParseError(decoded.failure)])
    );
  }

  return Effect.succeed(decoded.success);
};

const loadManifest = (manifestPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(manifestPath).pipe(
      Effect.mapError((cause) =>
        generationError("readFileString", manifestPath, cause)
      )
    );

    return yield* decodeDataLayerSpineManifest(manifestPath, raw);
  });

export const runGenerateDataLayerSpine = Effect.fn(
  "generate-data-layer-spine.run"
)(function* (rawOptions: CliOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const options = {
    manifest: path.resolve(process.cwd(), rawOptions.manifest),
    output: path.resolve(process.cwd(), rawOptions.output)
  };

  const manifest = yield* loadManifest(options.manifest);
  const generated = renderSpineFile(manifest);

  yield* fs.makeDirectory(path.dirname(options.output), { recursive: true }).pipe(
    Effect.mapError((cause) =>
      generationError("makeDirectory", path.dirname(options.output), cause)
    )
  );
  yield* fs.writeFileString(options.output, `${generated}\n`).pipe(
    Effect.mapError((cause) =>
      generationError("writeFileString", options.output, cause)
    )
  );

  yield* Console.log(`Generated ${options.output}.`);
});

const generateDataLayerSpineCommand = Command.make(
  "generate-data-layer-spine",
  {
    manifest: manifestFlag,
    output: outputFlag
  },
  runGenerateDataLayerSpine
);

const cli = Command.runWith(generateDataLayerSpineCommand, {
  version: "0.1.0"
});

if (import.meta.main) {
  runScriptMain(
    "generate-data-layer-spine",
    Effect.suspend(() => cli(process.argv.slice(2))).pipe(
      Effect.provide(scriptPlatformLayer)
    )
  );
}
