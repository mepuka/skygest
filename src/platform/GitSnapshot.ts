import { DateTime, Effect, FileSystem, Path, Result, Schema } from "effect";
import { GitSnapshotFetchError } from "../domain/errors";
import { IsoTimestamp } from "../domain/types";
import {
  decodeJsonStringEitherWith,
  encodeJsonStringPrettyWith,
  formatSchemaParseError,
  stringifyUnknown
} from "./Json";

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

export const GitSnapshotStateFileName = ".git-snapshot-state.json";

export const GitSnapshotState = Schema.Struct({
  commit: NonEmptyString,
  manifestHash: NonEmptyString,
  fetchedAt: IsoTimestamp
});
export type GitSnapshotState = Schema.Schema.Type<typeof GitSnapshotState>;

export type GitSnapshotTreeHashOptions = {
  readonly exclude?: ReadonlyArray<string>;
};

const encodeGitSnapshotStateWith = encodeJsonStringPrettyWith(GitSnapshotState);
const decodeIsoTimestamp = Schema.decodeUnknownSync(IsoTimestamp);

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

const normalizeRelativePath = (value: string) =>
  value
    .split("\\")
    .join("/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+/gu, "/");

const mapHashError = (operation: string, path?: string) => (error: unknown) =>
  new GitSnapshotFetchError({
    operation,
    message: stringifyUnknown(error),
    ...(path === undefined ? {} : { path })
  });

const mapFsError = (operation: string, path: string) => (error: unknown) =>
  new GitSnapshotFetchError({
    operation,
    path,
    message: stringifyUnknown(error)
  });

const sha256HexBytes = (
  bytes: Uint8Array,
  operation: string,
  path?: string
): Effect.Effect<string, GitSnapshotFetchError> =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", bytes),
    catch: mapHashError(operation, path)
  }).pipe(
    Effect.map((digest) => bytesToHex(new Uint8Array(digest))),
    Effect.mapError((error) =>
      error instanceof GitSnapshotFetchError
        ? error
        : mapHashError(operation, path)(error)
    )
  );

export const sha256HexString = (
  value: string,
  operation: string,
  path?: string
) : Effect.Effect<string, GitSnapshotFetchError> =>
  sha256HexBytes(new TextEncoder().encode(value), operation, path);

const listSnapshotFiles: (
  rootDir: string,
  currentDir: string,
  excluded: ReadonlySet<string>
) => Effect.Effect<
  ReadonlyArray<string>,
  GitSnapshotFetchError,
  FileSystem.FileSystem | Path.Path
> = Effect.fn("gitSnapshot.listSnapshotFiles")(function* (
  rootDir: string,
  currentDir: string,
  excluded: ReadonlySet<string>
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entryNames = yield* fs.readDirectory(currentDir).pipe(
    Effect.mapError(mapFsError("verify-tree-hash", currentDir))
  );

  const files: Array<string> = [];

  for (const entryName of [...entryNames].sort((left, right) => left.localeCompare(right))) {
    const absolutePath = path.join(currentDir, entryName);
    const relativePath = normalizeRelativePath(path.relative(rootDir, absolutePath));

    if (entryName === ".git" || excluded.has(relativePath)) {
      continue;
    }

    const info = yield* fs.stat(absolutePath).pipe(
      Effect.mapError(mapFsError("verify-tree-hash", absolutePath))
    );

    if (info.type === "Directory") {
      files.push(...(yield* listSnapshotFiles(rootDir, absolutePath, excluded)));
      continue;
    }

    if (info.type === "File") {
      files.push(absolutePath);
      continue;
    }

    return yield* new GitSnapshotFetchError({
      operation: "verify-tree-hash",
      path: absolutePath,
      message: `Unsupported snapshot entry type: ${info.type}`
    });
  }

  return files;
});

export const computeDirectoryTreeHash = (
  rootDir: string,
  options?: GitSnapshotTreeHashOptions
): Effect.Effect<
  string,
  GitSnapshotFetchError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const excluded = new Set(
      (options?.exclude ?? []).map((value) => normalizeRelativePath(value))
    );
    const absoluteFiles = yield* listSnapshotFiles(rootDir, rootDir, excluded);

    const entries: Array<{ readonly path: string; readonly sha256: string }> = [];

    for (const absolutePath of absoluteFiles) {
      const relativePath = normalizeRelativePath(path.relative(rootDir, absolutePath));
      const fileBytes = yield* fs.readFile(absolutePath).pipe(
        Effect.mapError(mapFsError("verify-tree-hash", absolutePath))
      );
      const sha256 = yield* sha256HexBytes(
        fileBytes,
        "verify-tree-hash",
        absolutePath
      );
      entries.push({ path: relativePath, sha256 });
    }

    const listing = entries
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((entry) => `${entry.path}\t${entry.sha256}`)
      .join("\n");

    return yield* sha256HexString(listing, "verify-tree-hash", rootDir);
  });

export const decodeGitSnapshotStateText = (
  input: string,
  filePath: string
): Effect.Effect<GitSnapshotState, GitSnapshotFetchError> => {
  const decoded = decodeJsonStringEitherWith(
    GitSnapshotState as Schema.Decoder<unknown>
  )(input);

  return Result.isSuccess(decoded)
    ? Effect.succeed(decoded.success as GitSnapshotState)
    : Effect.fail(
        new GitSnapshotFetchError({
          operation: "read-state",
          path: filePath,
          message: formatSchemaParseError(decoded.failure)
        })
      );
};

export const encodeGitSnapshotState = (state: GitSnapshotState) =>
  encodeGitSnapshotStateWith(state);

export const makeGitSnapshotState = (
  commit: string,
  manifestHash: string
): GitSnapshotState => ({
  commit,
  manifestHash,
  fetchedAt: decodeIsoTimestamp(
    DateTime.formatIso(DateTime.fromDateUnsafe(new Date()))
  )
});

export const isPlaceholderSnapshotCommit = (commit: string) => {
  const normalized = commit.trim().toLowerCase();
  return normalized.length === 0 || normalized === "placeholder";
};
