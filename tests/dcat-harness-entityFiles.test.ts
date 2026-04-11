import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import * as BunPath from "@effect/platform-bun/BunPath";
import {
  writeEntityFileWith
} from "../src/ingest/dcat-harness";

class FakeFsError extends Schema.TaggedErrorClass<FakeFsError>()(
  "FakeFsError",
  { message: Schema.String }
) {}

describe("dcat-harness entityFiles", () => {
  it.effect("removes the temporary file when rename fails", () =>
    Effect.gen(function* () {
      const removed: Array<string> = [];
      const writes: Array<string> = [];

      const fakeFs = {
        makeDirectory: () => Effect.void,
        writeFileString: (path: string) =>
          Effect.sync(() => {
            writes.push(path);
          }),
        rename: () =>
          Effect.fail(new FakeFsError({ message: "rename failed" })),
        remove: (path: string) =>
          Effect.sync(() => {
            removed.push(path);
          })
      } as unknown as FileSystem.FileSystem;

      const error = yield* writeEntityFileWith(
        "/tmp/catalog/datasets/example.json",
        "{}\n"
      ).pipe(
        Effect.flip,
        Effect.provide(Layer.mergeAll(
          Layer.succeed(FileSystem.FileSystem, fakeFs),
          BunPath.layer
        ))
      );

      expect(error.operation).toBe("rename");
      expect(writes).toHaveLength(1);
      expect(removed).toEqual([writes[0]!]);
    })
  );
});
