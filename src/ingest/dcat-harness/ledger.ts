import { Effect, FileSystem, Path, Result, Schema } from "effect";
import {
  decodeJsonStringEitherWith,
  encodeJsonStringPrettyWith,
  formatSchemaParseError,
  stringifyUnknown
} from "../../platform/Json";
import type { IngestNode } from "./IngestNode";
import { IngestLedgerError } from "./errors";
import { isNotFoundPlatformError } from "./entityFiles";

export const EntityIdLedger = Schema.Record(Schema.String, Schema.String);
export type EntityIdLedger = Schema.Schema.Type<typeof EntityIdLedger>;

const encodeEntityIdLedger = encodeJsonStringPrettyWith(EntityIdLedger);
const decodeEntityIdLedger = decodeJsonStringEitherWith(EntityIdLedger);

const ledgerKindByTag: Record<IngestNode["_tag"], string> = {
  agent: "Agent",
  catalog: "Catalog",
  "data-service": "DataService",
  dataset: "Dataset",
  distribution: "Distribution",
  "catalog-record": "CatalogRecord"
};

export const ledgerKeyForNode = (node: IngestNode): string =>
  `${ledgerKindByTag[node._tag]}:${node.slug}`;

export function loadLedgerWith(
  rootDir: string
): Effect.Effect<EntityIdLedger, IngestLedgerError, FileSystem.FileSystem | Path.Path>;
export function loadLedgerWith<E>(
  rootDir: string,
  mapError: (message: string) => E
): Effect.Effect<EntityIdLedger, E, FileSystem.FileSystem | Path.Path>;
export function loadLedgerWith<E>(
  rootDir: string,
  mapError?: (message: string) => E
): Effect.Effect<EntityIdLedger, E | IngestLedgerError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const ledgerPath = path_.resolve(rootDir, ".entity-ids.json");

    const readExit = yield* Effect.exit(fs_.readFileString(ledgerPath));
    if (readExit._tag === "Failure") {
      if (isNotFoundPlatformError(readExit.cause)) {
        return {} satisfies EntityIdLedger;
      }
      return yield* new IngestLedgerError({
        message:
          `Cannot read ledger at ${ledgerPath}: ${stringifyUnknown(readExit.cause)}`
      });
    }

    const decoded = decodeEntityIdLedger(readExit.value);
    if (Result.isFailure(decoded)) {
      return yield* new IngestLedgerError({
        message:
          `Cannot decode ledger at ${ledgerPath}: ${formatSchemaParseError(decoded.failure)}`
      });
    }
    return decoded.success;
  }).pipe(
    Effect.mapError((error) =>
      mapError === undefined ? error : mapError(error.message)
    )
  );
}

export const loadLedgerWithMapped = <E>(
  rootDir: string,
  mapError: (message: string) => E
): Effect.Effect<EntityIdLedger, E, FileSystem.FileSystem | Path.Path> =>
  loadLedgerWith(rootDir).pipe(
    Effect.mapError((error) => mapError(error.message))
  );

export const saveLedgerWith = <E, R>(
  rootDir: string,
  ledger: EntityIdLedger,
  writeEntityFile: (
    filePath: string,
    content: string
  ) => Effect.Effect<void, E, R>
): Effect.Effect<void, E, Path.Path | R> =>
  Effect.gen(function* () {
    const path_ = yield* Path.Path;
    const ledgerPath = path_.resolve(rootDir, ".entity-ids.json");
    yield* writeEntityFile(ledgerPath, `${encodeEntityIdLedger(ledger)}\n`);
  });
