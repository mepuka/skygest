import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Path, Result } from "effect";
import {
  EnergyProfileManifestLoadError,
  EnergyProfilePipelineError
} from "../src/domain/errors";
import { EnergyProfileManifest } from "../src/domain/energyProfileManifest";
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
  readonly apply: boolean;
};

const decodeManifestJson = decodeJsonStringEitherWith(EnergyProfileManifest);

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

const runSyncEnergyProfile = Effect.fn("sync-energy-profile.run")(function* (
  rawOptions: CliOptions
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const options = {
    source: path.resolve(process.cwd(), rawOptions.source),
    target: path.resolve(process.cwd(), rawOptions.target),
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
