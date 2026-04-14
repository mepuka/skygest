import { migrations } from "./migrations";
import { runMigrationSet } from "./migrationRunner";

export const runMigrations = runMigrationSet(migrations);
