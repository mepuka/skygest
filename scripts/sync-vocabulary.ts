import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Path, Result } from "effect";
import {
  VocabularyCollisionError,
  VocabularyLoadError
} from "../src/domain/errors";
import { stringifyUnknown } from "../src/platform/Json";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";
import {
  type VocabularyFacetDescriptor,
  type VocabularyValidationOk,
  validateVocabularyJson,
  VOCABULARY_FACETS
} from "../src/resolution/facetVocabulary/vocabularyFacets";

type CliOptions = {
  readonly source: string;
  readonly target: string;
  readonly apply: boolean;
};

type ValidationOutcome = {
  readonly descriptor: VocabularyFacetDescriptor;
  readonly sourcePath: string;
  readonly result: Result.Result<
    VocabularyValidationOk,
    VocabularyLoadError | VocabularyCollisionError
  >;
};

const formatOutcomeSummary = (outcome: ValidationOutcome) => {
  if (Result.isSuccess(outcome.result)) {
    return `${outcome.descriptor.filename.padEnd(24)} ${`${String(outcome.result.success.entryCount)} entries`.padEnd(12)} OK`;
  }

  return `${outcome.descriptor.filename.padEnd(24)} ${"FAILED"}`;
};

const formatFailureDetails = (
  outcome: ValidationOutcome,
  error: VocabularyLoadError | VocabularyCollisionError
) => {
  if (error._tag === "VocabularyCollisionError") {
    return [
      `${outcome.descriptor.filename}: conflicting canonical values for "${error.normalizedSurfaceForm}"`,
      `  - ${error.canonicalA}`,
      `  - ${error.canonicalB}`
    ];
  }

  return [
    `${outcome.descriptor.filename}: ${error.path}`,
    ...error.issues.map((issue) => `  - ${issue}`)
  ];
};

const sourceFlag = Flag.string("source").pipe(
  Flag.withDescription("Source vocabulary directory"),
  Flag.withDefault("../ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary")
);

const targetFlag = Flag.string("target").pipe(
  Flag.withDescription("Target vocabulary directory"),
  Flag.withDefault("references/vocabulary")
);

const applyFlag = Flag.boolean("apply").pipe(
  Flag.withDescription("Copy files after validation"),
  Flag.withDefault(false)
);

const mapFileReadError = (descriptor: VocabularyFacetDescriptor, path: string) =>
  (cause: unknown) =>
    new VocabularyLoadError({
      facet: descriptor.facet,
      path,
      issues: [stringifyUnknown(cause)]
    });

const mapTargetWriteError = (path: string) => (cause: unknown) =>
  new VocabularyLoadError({
    facet: "sync-vocabulary",
    path,
    issues: [stringifyUnknown(cause)]
  });

const runSyncVocabulary = Effect.fn("sync-vocabulary.run")(function* (
  rawOptions: CliOptions
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const options = {
    source: path.resolve(process.cwd(), rawOptions.source),
    target: path.resolve(process.cwd(), rawOptions.target),
    apply: rawOptions.apply
  };

  const outcomes = yield* Effect.forEach(VOCABULARY_FACETS, (descriptor) =>
    Effect.gen(function* () {
      const sourcePath = path.join(options.source, descriptor.filename);
      const exists = yield* fs.exists(sourcePath).pipe(
        Effect.mapError(mapFileReadError(descriptor, sourcePath))
      );

      if (!exists) {
        return {
          descriptor,
          sourcePath,
          result: Result.fail(
            new VocabularyLoadError({
              facet: descriptor.facet,
              path: sourcePath,
              issues: ["file not found"]
            })
          )
        } satisfies ValidationOutcome;
      }

      const jsonString = yield* fs.readFileString(sourcePath).pipe(
        Effect.mapError(mapFileReadError(descriptor, sourcePath))
      );

      return {
        descriptor,
        sourcePath,
        result: validateVocabularyJson(descriptor, jsonString)
      } satisfies ValidationOutcome;
    })
  );

  for (const outcome of outcomes) {
    yield* Console.log(formatOutcomeSummary(outcome));
  }

  const failures = outcomes.flatMap((outcome) =>
    Result.isFailure(outcome.result)
      ? [{ outcome, error: outcome.result.failure }] as const
      : []
  );

  if (failures.length > 0) {
    yield* Console.log("");
    for (const failure of failures) {
      for (const line of formatFailureDetails(failure.outcome, failure.error)) {
        yield* Console.log(line);
      }
    }

    return yield* new VocabularyLoadError({
      facet: "sync-vocabulary",
      path: options.source,
      issues: [`validation failed for ${String(failures.length)} vocabulary file(s)`]
    });
  }

  if (!options.apply) {
    yield* Console.log(
      `\nDry run only. Re-run with --apply to copy files into ${options.target}.`
    );
    return;
  }

  yield* fs.makeDirectory(options.target, { recursive: true }).pipe(
    Effect.mapError(mapTargetWriteError(options.target))
  );

  for (const outcome of outcomes) {
    const targetPath = path.join(options.target, outcome.descriptor.filename);
    yield* fs.copyFile(outcome.sourcePath, targetPath).pipe(
      Effect.mapError(mapTargetWriteError(targetPath))
    );
  }

  yield* Console.log(
    `\nCopied ${String(outcomes.length)} vocabulary files into ${options.target}.`
  );
});

const syncVocabularyCommand = Command.make(
  "sync-vocabulary",
  {
    source: sourceFlag,
    target: targetFlag,
    apply: applyFlag
  },
  runSyncVocabulary
);

const cli = Command.runWith(syncVocabularyCommand, {
  version: "0.1.0"
});

runScriptMain(
  "sync-vocabulary",
  Effect.suspend(() => cli(process.argv.slice(2))).pipe(
    Effect.provide(scriptPlatformLayer)
  )
);
