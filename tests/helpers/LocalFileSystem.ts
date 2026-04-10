import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

class LocalFileSystemError extends Schema.TaggedErrorClass<LocalFileSystemError>()(
  "LocalFileSystemError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

export const layer = Layer.mergeAll(
  Layer.succeed(
    FileSystem.FileSystem,
    {
      readDirectory: (path: string) =>
        Effect.tryPromise({
          try: () => fs.readdir(path),
          catch: (error) =>
            new LocalFileSystemError({
              operation: "readDirectory",
              path,
              message: String(error)
            })
        }),
      readFileString: (path: string) =>
        Effect.tryPromise({
          try: () => fs.readFile(path, "utf-8"),
          catch: (error) =>
            new LocalFileSystemError({
              operation: "readFileString",
              path,
              message: String(error)
            })
        }),
      writeFileString: (path: string, content: string) =>
        Effect.tryPromise({
          try: () => fs.writeFile(path, content, "utf-8"),
          catch: (error) =>
            new LocalFileSystemError({
              operation: "writeFileString",
              path,
              message: String(error)
            })
        })
    } as unknown as FileSystem.FileSystem
  ),
  Layer.succeed(Path.Path, nodePath as unknown as Path.Path)
);
