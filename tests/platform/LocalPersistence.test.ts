import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Exit, Layer, Schema } from "effect";
import { Persistable, Persistence } from "effect/unstable/persistence";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { localPersistenceLayer } from "../../src/platform/LocalPersistence";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

class ExampleRequest extends Persistable.Class()("ExampleRequest", {
  primaryKey: () => "example",
  success: Schema.Struct({ value: Schema.String })
}) {}

const request = new ExampleRequest();

const makeTmpPersistenceDir = () =>
  Effect.tryPromise(() =>
    fsp.mkdtemp(nodePath.join(os.tmpdir(), "local-persistence-"))
  );

describe("localPersistenceLayer", () => {
  it.effect("creates the backing directory and round-trips persisted values", () =>
    Effect.gen(function* () {
      const dir = yield* makeTmpPersistenceDir();
      const layer = Layer.mergeAll(
        bunFsLayer,
        localPersistenceLayer(dir).pipe(Layer.provide(bunFsLayer))
      );

      yield* Effect.gen(function* () {
        const persistence = yield* Persistence.Persistence;
        const store = yield* persistence.make({ storeId: "walk-cache" });
        yield* store.set(request, Exit.succeed({ value: "cached" }));
      }).pipe(Effect.provide(layer));

      const entries = yield* Effect.tryPromise(() => fsp.readdir(dir));
      expect(entries.length).toBeGreaterThan(0);

      const cached = yield* Effect.gen(function* () {
        const persistence = yield* Persistence.Persistence;
        const store = yield* persistence.make({ storeId: "walk-cache" });
        return yield* store.get(request);
      }).pipe(Effect.provide(layer));

      expect(cached).toBeDefined();
      expect(cached !== undefined && Exit.isSuccess(cached)).toBe(true);
      if (cached !== undefined && Exit.isSuccess(cached)) {
        expect(cached.value.value).toBe("cached");
      }

      yield* Effect.tryPromise(() =>
        fsp.rm(dir, { recursive: true, force: true })
      );
    })
  );
});
