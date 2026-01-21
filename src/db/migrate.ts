import * as Migrator from "@effect/sql/Migrator";
import { Effect } from "effect";
import { migrations } from "./migrations";

export const runMigrations = Migrator.make({})({
  loader: Effect.succeed(migrations)
});
