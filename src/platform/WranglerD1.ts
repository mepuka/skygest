import {
  Clock,
  Effect,
  FileSystem,
  Path,
  Schema
} from "effect";
import { ChildProcess } from "effect/unstable/process";
import { SearchDbScriptError } from "../domain/errors";
import { decodeJsonStringEitherWith, formatSchemaParseError } from "./Json";
import { runCommandCollectingOutput } from "./CommandRunner";

const WranglerD1JsonRow = Schema.Record(Schema.String, Schema.Unknown);

const WranglerD1JsonResult = Schema.Struct({
  results: Schema.Array(WranglerD1JsonRow),
  success: Schema.Boolean
});

export const WranglerD1JsonResults = Schema.Array(WranglerD1JsonResult);
export type WranglerD1JsonResults = Schema.Schema.Type<
  typeof WranglerD1JsonResults
>;

export type WranglerD1CommandOptions = {
  readonly databaseName: string;
  readonly sql: string;
};

export type WranglerD1FileOptions = {
  readonly databaseName: string;
  readonly filePath: string;
};

type WranglerD1TempFileOptions = {
  readonly databaseName: string;
  readonly sql: string;
  readonly label: string;
  readonly tempDir?: string;
};

const baseExecuteArgs = (
  databaseName: string
): ReadonlyArray<string> => [
  "d1",
  "execute",
  databaseName,
  "--remote",
  "--yes"
];

const executeWithArgs = (
  databaseName: string,
  args: ReadonlyArray<string>
) =>
  runCommandCollectingOutput(
    `wrangler ${args.join(" ")}`,
    ChildProcess.make("wrangler", args)
  ).pipe(
    Effect.mapError((error) =>
      new SearchDbScriptError({
        operation: "wranglerD1.execute",
        message: `Failed to execute SQL against ${databaseName}: ${error.message}`
      })
    )
  );

export const executeWranglerD1Command = ({
  databaseName,
  sql
}: WranglerD1CommandOptions) =>
  executeWithArgs(databaseName, [
    ...baseExecuteArgs(databaseName),
    "--command",
    sql
  ]);

export const executeWranglerD1CommandJson = ({
  databaseName,
  sql
}: WranglerD1CommandOptions): Effect.Effect<
  WranglerD1JsonResults,
  SearchDbScriptError,
  import("effect/unstable/process").ChildProcessSpawner.ChildProcessSpawner
> =>
  executeWithArgs(databaseName, [
    ...baseExecuteArgs(databaseName),
    "--command",
    sql,
    "--json"
  ]).pipe(
    Effect.flatMap((output) => {
      const decoded = decodeJsonStringEitherWith(
        WranglerD1JsonResults as Schema.Decoder<unknown>
      )(output);

      return decoded._tag === "Success"
        ? Effect.succeed(decoded.success as WranglerD1JsonResults)
        : Effect.fail(
            new SearchDbScriptError({
              operation: "wranglerD1.executeJson",
              message: `Failed to parse wrangler D1 JSON output for ${databaseName}: ${formatSchemaParseError(decoded.failure)}`
            })
          );
    })
  );

export const executeWranglerD1File = ({
  databaseName,
  filePath
}: WranglerD1FileOptions) =>
  executeWithArgs(databaseName, [
    ...baseExecuteArgs(databaseName),
    "--file",
    filePath
  ]);

export const executeWranglerD1TempSqlFile = ({
  databaseName,
  sql,
  label,
  tempDir = ".cache/search-db/sql"
}: WranglerD1TempFileOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const now = yield* Clock.currentTimeMillis;
    const fileName = `${label}-${String(now)}-${Math.random().toString(36).slice(2, 8)}.sql`;
    const tempPath = path.join(tempDir, fileName);

    yield* fs.makeDirectory(tempDir, { recursive: true });

    yield* Effect.acquireUseRelease(
      fs.writeFileString(tempPath, sql),
      () => executeWranglerD1File({ databaseName, filePath: tempPath }),
      () => fs.remove(tempPath, { force: true }).pipe(Effect.ignore)
    );
  });
