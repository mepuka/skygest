import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { UsersRepo } from "../UsersRepo";
import { UsersRepoD1 } from "./UsersRepoD1";
import { runMigrations } from "../../db/migrate";

it("upserts and reads users", async () => {
  const program = Effect.gen(function* () {
    yield* runMigrations;
    const users = yield* UsersRepo;
    yield* users.upsert({
      did: "did:plc:1",
      handle: "test",
      displayName: "Test",
      createdAt: 1,
      lastAccessAt: 1,
      accessCount: 0,
      consentAccesses: 0,
      optOut: false,
      deactivated: false
    });
    const got = yield* users.get("did:plc:1");
    return got?.handle ?? "";
  });

  const baseLayer = SqliteClient.layer({ filename: ":memory:" });
  const appLayer = UsersRepoD1.layer.pipe(Layer.provideMerge(baseLayer));

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(appLayer))
  );

  expect(result).toBe("test");
});
