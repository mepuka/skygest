import { Command, Flag } from "effect/unstable/cli";
import {
  Console,
  Effect,
  FileSystem,
  Path,
  Result,
  Schema
} from "effect";
import { ChildProcess } from "effect/unstable/process";
import {
  CommandExecutionError,
  GitSnapshotFetchError
} from "../src/domain/errors";
import {
  computeDirectoryTreeHash,
  decodeGitSnapshotStateText,
  encodeGitSnapshotState,
  GitSnapshotStateFileName,
  isPlaceholderSnapshotCommit,
  makeGitSnapshotState,
  sha256HexString
} from "../src/platform/GitSnapshot";
import { decodeJsonStringEitherWith, formatSchemaParseError, stringifyUnknown } from "../src/platform/Json";
import { LockFile } from "../src/platform/LockFile";
import { Manifest } from "../src/platform/Manifest";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";
import { runCommandCollectingOutput } from "../src/platform/CommandRunner";

export type FetchGitSnapshotOptions = {
  readonly lockFile: string;
  readonly destDir: string;
  readonly requiredManifestFile: string;
};

type CliOptions = FetchGitSnapshotOptions;

const gitRemoteUrlPattern = /^[a-z][a-z0-9+.-]*:\/\//iu;

const mapFsError = (operation: string, path: string) => (error: unknown) =>
  new GitSnapshotFetchError({
    operation,
    path,
    message: stringifyUnknown(error)
  });

const mapCommandError = (
  operation: string,
  commandText: string,
  repo?: string,
  commit?: string
) =>
  (error: unknown) =>
    new GitSnapshotFetchError({
      operation,
      message:
        error instanceof CommandExecutionError
          ? error.message
          : `${commandText}: ${stringifyUnknown(error)}`,
      ...(repo === undefined ? {} : { repo }),
      ...(commit === undefined ? {} : { commit })
    });

const readJsonFile = <S extends Schema.Decoder<unknown>>(
  filePath: string,
  schema: S,
  operation: string
): Effect.Effect<unknown, GitSnapshotFetchError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(filePath).pipe(
      Effect.mapError(mapFsError(operation, filePath))
    );
    const decoded = decodeJsonStringEitherWith(schema)(text);

    return Result.isSuccess(decoded)
      ? decoded.success as S["Type"]
      : yield* new GitSnapshotFetchError({
          operation,
          path: filePath,
          message: formatSchemaParseError(decoded.failure)
        });
  });

const readLockFile = (filePath: string) =>
  readJsonFile(
    filePath,
    LockFile as Schema.Decoder<unknown>,
    "read-lock-file"
  ).pipe(
    Effect.map((value) => value as import("../src/platform/LockFile").LockFile)
  );

const parseManifestText = (input: string, filePath: string) => {
  const decoded = decodeJsonStringEitherWith(
    Manifest as Schema.Decoder<unknown>
  )(input);

  return Result.isSuccess(decoded)
    ? Effect.succeed(decoded.success as import("../src/platform/Manifest").Manifest)
    : Effect.fail(
        new GitSnapshotFetchError({
          operation: "parse-manifest",
          path: filePath,
          message: formatSchemaParseError(decoded.failure)
        })
      );
};

const readExistingState = (
  statePath: string
): Effect.Effect<
  import("../src/platform/GitSnapshot").GitSnapshotState | null,
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(statePath).pipe(Effect.orElseSucceed(() => false));

    if (!exists) {
      return null;
    }

    return yield* fs.readFileString(statePath).pipe(
      Effect.flatMap((text) => decodeGitSnapshotStateText(text, statePath)),
      Effect.option,
      Effect.map((state) => (state._tag === "Some" ? state.value : null))
    );
  });

const normalizeRepo = (repo: string) => {
  if (
    gitRemoteUrlPattern.test(repo) ||
    repo.startsWith("/") ||
    repo.startsWith("./") ||
    repo.startsWith("../") ||
    repo.startsWith("git@")
  ) {
    return repo;
  }

  return `https://${repo}`;
};

const normalizeRelativePath = (value: string) =>
  value
    .split("\\")
    .join("/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+/gu, "/");

const resolveSnapshotSourceRoot = (
  tempRepoDir: string,
  snapshotPath: string | undefined
): Effect.Effect<string, GitSnapshotFetchError, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    if (snapshotPath === undefined) {
      return tempRepoDir;
    }

    const normalized = path.normalize(snapshotPath);
    if (
      path.isAbsolute(normalized) ||
      normalized === ".." ||
      normalized.startsWith(`..${path.sep}`)
    ) {
      return yield* new GitSnapshotFetchError({
        operation: "resolve-snapshot-path",
        path: snapshotPath,
        message: "snapshotPath must stay within the fetched repository root"
      });
    }

    return path.join(tempRepoDir, normalized);
  });

const copyDirectoryContents: (
  sourceDir: string,
  targetDir: string
) => Effect.Effect<
  void,
  GitSnapshotFetchError,
  FileSystem.FileSystem | Path.Path
> = Effect.fn("gitSnapshot.copyDirectoryContents")(function* (
  sourceDir: string,
  targetDir: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entryNames = yield* fs.readDirectory(sourceDir).pipe(
    Effect.mapError(mapFsError("copy-snapshot", sourceDir))
  );

  for (const entryName of [...entryNames].sort((left, right) => left.localeCompare(right))) {
    if (entryName === ".git") {
      continue;
    }

    const sourcePath = path.join(sourceDir, entryName);
    const targetPath = path.join(targetDir, entryName);
    const info = yield* fs.stat(sourcePath).pipe(
      Effect.mapError(mapFsError("copy-snapshot", sourcePath))
    );

    if (info.type === "Directory") {
      yield* fs.makeDirectory(targetPath, { recursive: true }).pipe(
        Effect.mapError(mapFsError("copy-snapshot", targetPath))
      );
      yield* copyDirectoryContents(sourcePath, targetPath);
      continue;
    }

    if (info.type === "File") {
      yield* fs.copyFile(sourcePath, targetPath).pipe(
        Effect.mapError(mapFsError("copy-snapshot", targetPath))
      );
      continue;
    }

    return yield* new GitSnapshotFetchError({
      operation: "copy-snapshot",
      path: sourcePath,
      message: `Unsupported snapshot entry type: ${info.type}`
    });
  }
});

const runGitCommand = (
  tempRepoDir: string,
  args: ReadonlyArray<string>,
  operation: string,
  repo?: string,
  commit?: string
) => {
  const commandText = `git ${args.join(" ")}`;
  return runCommandCollectingOutput(
    commandText,
    ChildProcess.make("git", args)
  ).pipe(
    Effect.mapError(mapCommandError(operation, commandText, repo, commit)),
    Effect.withSpan("git-snapshot.git", {
      attributes: {
        operation,
        repoDir: tempRepoDir
      }
    })
  );
};

export const fetchGitSnapshot = (
  options: FetchGitSnapshotOptions
): Effect.Effect<
  void,
  GitSnapshotFetchError,
  FileSystem.FileSystem | Path.Path | import("effect/unstable/process").ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const lock = yield* readLockFile(options.lockFile);

    if (isPlaceholderSnapshotCommit(lock.commit)) {
      yield* Console.log(
        `Skipping fetch for ${options.lockFile} because the lock file commit is still a placeholder.`
      );
      return;
    }

    const statePath = path.join(options.destDir, GitSnapshotStateFileName);
    const existingState = yield* readExistingState(statePath);
    const manifestPath = path.join(options.destDir, options.requiredManifestFile);

    if (
      existingState !== null &&
      existingState.commit === lock.commit &&
      existingState.manifestHash === lock.manifestHash &&
      (yield* fs.exists(manifestPath).pipe(Effect.orElseSucceed(() => false)))
    ) {
      return;
    }

    const repo = normalizeRepo(lock.repo);
    const destParent = path.dirname(options.destDir);
    const excludedTreeHashPaths = [
      normalizeRelativePath(options.requiredManifestFile),
      GitSnapshotStateFileName
    ];

    yield* fs.makeDirectory(destParent, { recursive: true }).pipe(
      Effect.mapError(mapFsError("prepare-destination", destParent))
    );

    yield* fs.remove(options.destDir, { recursive: true, force: true }).pipe(
      Effect.mapError(mapFsError("cleanup-destination", options.destDir))
    );

    yield* Effect.gen(function* () {
      const tempRoot = yield* fs.makeTempDirectoryScoped({
        directory: destParent,
        prefix: ".git-snapshot-"
      }).pipe(Effect.mapError(mapFsError("prepare-destination", destParent)));
      const tempRepoDir = path.join(tempRoot, "repo");
      const extractedDir = path.join(tempRoot, "snapshot");

      yield* fs.makeDirectory(tempRepoDir, { recursive: true }).pipe(
        Effect.mapError(mapFsError("prepare-destination", tempRepoDir))
      );
      yield* fs.makeDirectory(extractedDir, { recursive: true }).pipe(
        Effect.mapError(mapFsError("prepare-destination", extractedDir))
      );

      yield* runGitCommand(
        tempRepoDir,
        ["-C", tempRepoDir, "init"],
        "fetch-repo",
        repo,
        lock.commit
      );
      yield* runGitCommand(
        tempRepoDir,
        ["-C", tempRepoDir, "remote", "add", "origin", repo],
        "fetch-repo",
        repo,
        lock.commit
      );
      yield* runGitCommand(
        tempRepoDir,
        ["-C", tempRepoDir, "fetch", "--depth", "1", "origin", lock.commit],
        "fetch-repo",
        repo,
        lock.commit
      );

      const fetchedCommit = (
        yield* runGitCommand(
          tempRepoDir,
          ["-C", tempRepoDir, "rev-parse", "FETCH_HEAD"],
          "verify-fetched-commit",
          repo,
          lock.commit
        )
      ).trim();

      if (fetchedCommit !== lock.commit) {
        return yield* new GitSnapshotFetchError({
          operation: "verify-fetched-commit",
          repo,
          commit: lock.commit,
          message: `Fetched commit ${fetchedCommit} did not match lock file commit ${lock.commit}`
        });
      }

      yield* runGitCommand(
        tempRepoDir,
        ["-C", tempRepoDir, "checkout", "--detach", "FETCH_HEAD"],
        "checkout-repo",
        repo,
        lock.commit
      );

      const sourceRoot = yield* resolveSnapshotSourceRoot(
        tempRepoDir,
        lock.snapshotPath
      );
      const sourceInfo = yield* fs.stat(sourceRoot).pipe(
        Effect.mapError(mapFsError("resolve-snapshot-path", sourceRoot))
      );

      if (sourceInfo.type !== "Directory") {
        return yield* new GitSnapshotFetchError({
          operation: "resolve-snapshot-path",
          path: sourceRoot,
          message: "snapshotPath must point at a directory"
        });
      }

      yield* copyDirectoryContents(sourceRoot, extractedDir);

      const fetchedManifestPath = path.join(
        extractedDir,
        options.requiredManifestFile
      );
      const manifestText = yield* fs.readFileString(fetchedManifestPath).pipe(
        Effect.mapError(mapFsError("read-manifest", fetchedManifestPath))
      );
      const manifestHash = yield* sha256HexString(
        manifestText,
        "verify-manifest-hash",
        fetchedManifestPath
      );

      if (manifestHash !== lock.manifestHash) {
        return yield* new GitSnapshotFetchError({
          operation: "verify-manifest-hash",
          path: fetchedManifestPath,
          commit: lock.commit,
          message: `Manifest hash mismatch: expected ${lock.manifestHash}, got ${manifestHash}`
        });
      }

      const manifest = yield* parseManifestText(
        manifestText,
        fetchedManifestPath
      );

      const treeHash = yield* computeDirectoryTreeHash(extractedDir, {
        exclude: excludedTreeHashPaths
      });

      if (treeHash !== manifest.treeHash) {
        return yield* new GitSnapshotFetchError({
          operation: "verify-tree-hash",
          path: extractedDir,
          commit: lock.commit,
          message: `Tree hash mismatch: expected ${manifest.treeHash}, got ${treeHash}`
        });
      }

      yield* fs.rename(extractedDir, options.destDir).pipe(
        Effect.mapError(mapFsError("commit-destination", options.destDir))
      );

      const state = makeGitSnapshotState(lock.commit, lock.manifestHash);
      yield* fs.writeFileString(
        statePath,
        encodeGitSnapshotState(state)
      ).pipe(Effect.mapError(mapFsError("write-state", statePath)));
    }).pipe(
      Effect.scoped,
      Effect.tapError(() =>
        fs.remove(options.destDir, { recursive: true, force: true }).pipe(
          Effect.ignore
        )
      )
    );
  });

const lockFileFlag = Flag.string("lock-file").pipe(
  Flag.withDescription("Path to the lock file"),
  Flag.withDefault("ingest-artifacts.lock.json")
);

const destDirFlag = Flag.string("dest-dir").pipe(
  Flag.withDescription("Destination directory under .generated/")
);

const requiredManifestFileFlag = Flag.string("required-manifest-file").pipe(
  Flag.withDescription("Manifest file expected inside the fetched snapshot"),
  Flag.withDefault("manifest.json")
);

const runFetchGitSnapshot = Effect.fn("fetch-git-snapshot.run")(function* (
  rawOptions: CliOptions
) {
  const path = yield* Path.Path;

  yield* fetchGitSnapshot({
    lockFile: path.resolve(process.cwd(), rawOptions.lockFile),
    destDir: path.resolve(process.cwd(), rawOptions.destDir),
    requiredManifestFile: rawOptions.requiredManifestFile
  });
});

const fetchGitSnapshotCommand = Command.make(
  "fetch-git-snapshot",
  {
    lockFile: lockFileFlag,
    destDir: destDirFlag,
    requiredManifestFile: requiredManifestFileFlag
  },
  runFetchGitSnapshot
);

const cli = Command.runWith(fetchGitSnapshotCommand, {
  version: "0.1.0"
});

if (import.meta.main) {
  runScriptMain(
    "fetch-git-snapshot",
    Effect.suspend(() => cli(process.argv.slice(2))).pipe(
      Effect.provide(scriptPlatformLayer)
    )
  );
}
