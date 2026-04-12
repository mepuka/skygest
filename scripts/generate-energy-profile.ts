import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Path, Result, Schema } from "effect";
import {
  EnergyProfileManifestLoadError,
  EnergyProfilePipelineError
} from "../src/domain/errors";
import { EnergyProfileManifest } from "../src/domain/energyProfileManifest";
import { SurfaceFormEntryAny } from "../src/domain/surfaceForm";
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
  readonly vocabularyRoot: string;
  readonly output: string;
};

const decodeManifestJson = decodeJsonStringEitherWith(EnergyProfileManifest);
const decodeVocabularyJson = decodeJsonStringEitherWith(
  Schema.Array(SurfaceFormEntryAny)
);

const manifestFlag = Flag.string("manifest").pipe(
  Flag.withDescription("Checked-in SHACL manifest path"),
  Flag.withDefault("references/energy-profile/shacl-manifest.json")
);

const vocabularyRootFlag = Flag.string("vocabulary-root").pipe(
  Flag.withDescription("Checked-in vocabulary directory"),
  Flag.withDefault("references/vocabulary")
);

const outputFlag = Flag.string("output").pipe(
  Flag.withDescription("Generated energy profile file"),
  Flag.withDefault("src/domain/generated/energyVariableProfile.ts")
);

const manifestLoadError = (path: string, issues: ReadonlyArray<string>) =>
  new EnergyProfileManifestLoadError({
    message: `invalid energy profile manifest at ${path}`,
    path,
    issues: [...issues]
  });

const pipelineError = (
  operation: string,
  path: string,
  cause: unknown
) =>
  new EnergyProfilePipelineError({
    operation,
    path,
    message: stringifyUnknown(cause)
  });

const loadManifest = (manifestPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(manifestPath).pipe(
      Effect.mapError((cause) =>
        pipelineError("readFileString", manifestPath, cause)
      )
    );
    const decoded = decodeManifestJson(raw);
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(
        manifestLoadError(manifestPath, [formatSchemaParseError(decoded.failure)])
      );
    }

    return decoded.success;
  });

const loadVocabularyCanonicals = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(filePath).pipe(
      Effect.mapError((cause) => pipelineError("readFileString", filePath, cause))
    );
    const decoded = decodeVocabularyJson(raw);
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(
        pipelineError("decodeVocabulary", filePath, [
          formatSchemaParseError(decoded.failure)
        ])
      );
    }

    return [...new Set(decoded.success.map((entry) => entry.canonical))].sort();
  });

const renderConstArray = (name: string, values: ReadonlyArray<string>) => [
  `export const ${name} = [`,
  ...values.map((value) => `  ${JSON.stringify(value)},`),
  "] as const;",
  ""
].join("\n");

const renderGeneratedProfile = (input: {
  readonly manifest: Schema.Schema.Type<typeof EnergyProfileManifest>;
  readonly measuredPropertyCanonicals: ReadonlyArray<string>;
  readonly domainObjectCanonicals: ReadonlyArray<string>;
  readonly technologyOrFuelCanonicals: ReadonlyArray<string>;
  readonly policyInstrumentCanonicals: ReadonlyArray<string>;
  readonly aggregationCanonicals: ReadonlyArray<string>;
  readonly unitFamilyCanonicals: ReadonlyArray<string>;
}) =>
  [
    "/**",
    " * AUTO-GENERATED. DO NOT EDIT.",
    " *",
    " * Source manifest: references/energy-profile/shacl-manifest.json",
    ` * Manifest version: ${String(input.manifest.manifestVersion)}`,
    ` * Source commit: ${input.manifest.sourceCommit}`,
    ` * Input hash: ${input.manifest.inputHash}`,
    " * Generation command: bun run gen:energy-profile",
    " */",
    "",
    renderConstArray("FACET_KEYS", input.manifest.facetKeys),
    renderConstArray("REQUIRED_FACET_KEYS", input.manifest.requiredFacetKeys),
    renderConstArray(
      "StatisticTypeMembers",
      input.manifest.closedEnums.StatisticType.values
    ),
    renderConstArray(
      "AggregationMembers",
      input.manifest.closedEnums.Aggregation.values
    ),
    renderConstArray(
      "UnitFamilyMembers",
      input.manifest.closedEnums.UnitFamily.values
    ),
    renderConstArray("MeasuredPropertyCanonicals", input.measuredPropertyCanonicals),
    renderConstArray("DomainObjectCanonicals", input.domainObjectCanonicals),
    renderConstArray(
      "TechnologyOrFuelCanonicals",
      input.technologyOrFuelCanonicals
    ),
    renderConstArray(
      "PolicyInstrumentCanonicals",
      input.policyInstrumentCanonicals
    ),
    renderConstArray("AggregationCanonicals", input.aggregationCanonicals),
    renderConstArray("UnitFamilyCanonicals", input.unitFamilyCanonicals)
  ].join("\n");

const runGenerateEnergyProfile = Effect.fn("generate-energy-profile.run")(function* (
  rawOptions: CliOptions
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const options = {
    manifest: path.resolve(process.cwd(), rawOptions.manifest),
    vocabularyRoot: path.resolve(process.cwd(), rawOptions.vocabularyRoot),
    output: path.resolve(process.cwd(), rawOptions.output)
  };

  const manifest = yield* loadManifest(options.manifest);

  const [
    measuredPropertyCanonicals,
    domainObjectCanonicals,
    technologyOrFuelCanonicals,
    policyInstrumentCanonicals,
    aggregationCanonicals,
    unitFamilyCanonicals
  ] = yield* Effect.all([
    loadVocabularyCanonicals(
      path.join(options.vocabularyRoot, "measured-property.json")
    ),
    loadVocabularyCanonicals(
      path.join(options.vocabularyRoot, "domain-object.json")
    ),
    loadVocabularyCanonicals(
      path.join(options.vocabularyRoot, "technology-or-fuel.json")
    ),
    loadVocabularyCanonicals(
      path.join(options.vocabularyRoot, "policy-instrument.json")
    ),
    loadVocabularyCanonicals(path.join(options.vocabularyRoot, "aggregation.json")),
    loadVocabularyCanonicals(path.join(options.vocabularyRoot, "unit-family.json"))
  ]);

  const generated = renderGeneratedProfile({
    manifest,
    measuredPropertyCanonicals,
    domainObjectCanonicals,
    technologyOrFuelCanonicals,
    policyInstrumentCanonicals,
    aggregationCanonicals,
    unitFamilyCanonicals
  });

  yield* fs.makeDirectory(path.dirname(options.output), { recursive: true }).pipe(
    Effect.mapError((cause) =>
      pipelineError("makeDirectory", path.dirname(options.output), cause)
    )
  );
  yield* fs.writeFileString(options.output, `${generated}\n`).pipe(
    Effect.mapError((cause) =>
      pipelineError("writeFileString", options.output, cause)
    )
  );

  yield* Console.log(`Generated ${options.output}.`);
});

const generateEnergyProfileCommand = Command.make(
  "generate-energy-profile",
  {
    manifest: manifestFlag,
    vocabularyRoot: vocabularyRootFlag,
    output: outputFlag
  },
  runGenerateEnergyProfile
);

const cli = Command.runWith(generateEnergyProfileCommand, {
  version: "0.1.0"
});

runScriptMain(
  "generate-energy-profile",
  Effect.suspend(() => cli(process.argv.slice(2))).pipe(
    Effect.provide(scriptPlatformLayer)
  )
);
