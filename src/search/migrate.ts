import { runMigrationSet } from "../db/migrationRunner";
import { entitySearchMigrations } from "./migrations";

export const runEntitySearchMigrations = runMigrationSet(
  entitySearchMigrations
);
