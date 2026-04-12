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
  readonly source: string;
  readonly target: string;
  readonly ontologyVocabularyRoot: string;
  readonly apply: boolean;
};

const decodeManifestJson = decodeJsonStringEitherWith(EnergyProfileManifest);
const decodeVocabularyJson = decodeJsonStringEitherWith(
  Schema.Array(SurfaceFormEntryAny)
);

const sourceFlag = Flag.string("source").pipe(
  Flag.withDescription("Source SHACL manifest file"),
  Flag.withDefault(
    "../ontology_skill/ontologies/skygest-energy-vocab/build/shacl-manifest.json"
  )
);

const targetFlag = Flag.string("target").pipe(
  Flag.withDescription("Target checked-in manifest path"),
  Flag.withDefault("references/energy-profile/shacl-manifest.json")
);

const ontologyVocabularyRootFlag = Flag.string("ontology-vocabulary-root").pipe(
  Flag.withDescription(
    "Sibling ontology vocabulary directory used for canonical drift checks"
  ),
  Flag.withDefault("../ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary")
);

const applyFlag = Flag.boolean("apply").pipe(
  Flag.withDescription("Copy the manifest after validation"),
  Flag.withDefault(false)
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

const validateManifestJson = (sourcePath: string, jsonString: string) => {
  const decoded = decodeManifestJson(jsonString);
  if (Result.isFailure(decoded)) {
    return Result.fail(
      manifestLoadError(sourcePath, [formatSchemaParseError(decoded.failure)])
    );
  }

  return decoded;
};

const VOCABULARY_FILENAMES = [
  "measured-property.json",
  "domain-object.json",
  "technology-or-fuel.json",
  "statistic-type.json",
  "aggregation.json",
  "unit-family.json",
  "policy-instrument.json"
] as const;

const loadCanonicalSet = (
  filePath: string
): Effect.Effect<ReadonlyArray<string>, EnergyProfilePipelineError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const jsonString = yield* fs.readFileString(filePath).pipe(
      Effect.mapError((cause) =>
        pipelineError("readVocabularyFile", filePath, cause)
      )
    );

    const decoded = decodeVocabularyJson(jsonString);
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(
        pipelineError("decodeVocabularyFile", filePath, [
          formatSchemaParseError(decoded.failure)
        ])
      );
    }

    return [...new Set(decoded.success.map((entry) => entry.canonical))].sort();
  });

const compareVocabularyRoots = (
  checkedInRoot: string,
  ontologyRoot: string
): Effect.Effect<void, EnergyProfilePipelineError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const pairs = yield* Effect.forEach(
      VOCABULARY_FILENAMES,
      (filename) =>
        Effect.all([
          loadCanonicalSet(path.join(checkedInRoot, filename)),
          loadCanonicalSet(path.join(ontologyRoot, filename))
        ]).pipe(
          Effect.map(([checkedIn, ontology]) => ({
            filename,
            checkedIn,
            ontology
          }))
        ),
      { concurrency: "unbounded" }
    );

    const mismatches = pairs.filter(
      (pair) =>
        JSON.stringify(pair.checkedIn) !== JSON.stringify(pair.ontology)
    );

    if (mismatches.length > 0) {
      return yield* Effect.fail(
        pipelineError(
          "compareVocabularyCanonicals",
          ontologyRoot,
          mismatches.map(
            (mismatch) =>
              `${mismatch.filename}: checked-in canonicals do not match ontology source`
          )
        )
      );
    }
  });

const runSyncEnergyProfile = Effect.fn("sync-energy-profile.run")(function* (
  rawOptions: CliOptions
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const options = {
    source: path.resolve(process.cwd(), rawOptions.source),
    target: path.resolve(process.cwd(), rawOptions.target),
    ontologyVocabularyRoot: path.resolve(
      process.cwd(),
      rawOptions.ontologyVocabularyRoot
    ),
    apply: rawOptions.apply
  };

  const exists = yield* fs.exists(options.source).pipe(
    Effect.mapError((cause) => pipelineError("exists", options.source, cause))
  );

  if (!exists) {
    return yield* Effect.fail(manifestLoadError(options.source, ["file not found"]));
  }

  const jsonString = yield* fs.readFileString(options.source).pipe(
    Effect.mapError((cause) =>
      pipelineError("readFileString", options.source, cause)
    )
  );

  const validated = validateManifestJson(options.source, jsonString);
  if (Result.isFailure(validated)) {
    return yield* Effect.fail(validated.failure);
  }

  const manifest = validated.success;

  yield* Console.log(
    `Manifest v${String(manifest.manifestVersion)} OK: ${String(manifest.facetKeys.length)} facets, ${String(Object.keys(manifest.closedEnums).length)} closed enums.`
  );

  const hasOntologyVocabularyRoot = yield* fs.exists(options.ontologyVocabularyRoot).pipe(
    Effect.mapError((cause) =>
      pipelineError("exists", options.ontologyVocabularyRoot, cause)
    )
  );

  if (hasOntologyVocabularyRoot) {
    yield* compareVocabularyRoots(
      path.resolve(process.cwd(), "references/vocabulary"),
      options.ontologyVocabularyRoot
    );
    yield* Console.log(
      `Checked-in vocabulary canonicals match ${options.ontologyVocabularyRoot}.`
    );
  } else {
    yield* Console.log(
      `Skipping vocabulary drift check because ${options.ontologyVocabularyRoot} is not present.`
    );
  }

  if (!options.apply) {
    yield* Console.log(
      `Dry run only. Re-run with --apply to copy the manifest into ${options.target}.`
    );
    return;
  }

  yield* fs.makeDirectory(path.dirname(options.target), { recursive: true }).pipe(
    Effect.mapError((cause) =>
      pipelineError(
        "makeDirectory",
        path.dirname(options.target),
        cause
      )
    )
  );

  yield* fs.writeFileString(options.target, jsonString).pipe(
    Effect.mapError((cause) =>
      pipelineError("writeFileString", options.target, cause)
    )
  );

  yield* Console.log(`Copied manifest into ${options.target}.`);
});

const syncEnergyProfileCommand = Command.make(
  "sync-energy-profile",
  {
    source: sourceFlag,
    target: targetFlag,
    ontologyVocabularyRoot: ontologyVocabularyRootFlag,
    apply: applyFlag
  },
  runSyncEnergyProfile
);

const cli = Command.runWith(syncEnergyProfileCommand, {
  version: "0.1.0"
});

runScriptMain(
  "sync-energy-profile",
  Effect.suspend(() => cli(process.argv.slice(2))).pipe(
    Effect.provide(scriptPlatformLayer)
  )
);
