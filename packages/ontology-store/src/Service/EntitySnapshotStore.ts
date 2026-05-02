import { Clock, Effect, Layer, Schema, ServiceMap } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";

import type {
  AnyEntityDefinition,
  StorageAdapter
} from "../Domain/EntityDefinition";
import {
  type EntityIri,
  EntitySnapshot
} from "../Domain/EntityGraph";
import { EntityNotFoundError } from "../Domain/Errors";
import {
  optionalD1Database,
  runD1Batch,
  type D1DatabaseBinding
} from "./D1Batch";

const EntitySnapshotRow = Schema.Struct({
  iri: Schema.String,
  entity_type: Schema.String,
  payload_json: Schema.String,
  created_at: Schema.Number,
  updated_at: Schema.Number
});
type EntitySnapshotRow = typeof EntitySnapshotRow.Type;

type EntityOf<Def extends AnyEntityDefinition> =
  Schema.Schema.Type<Def["schema"]>;

const decodeSqlError = (cause: unknown, operation: string): SqlError =>
  new SqlError({
    reason: new UnknownError({
      cause,
      message: "Failed to decode entity snapshot rows",
      operation
    })
  });

const decodeRows = (rows: unknown, operation: string) =>
  Schema.decodeUnknownEffect(Schema.Array(EntitySnapshotRow))(rows).pipe(
    Effect.mapError((cause) => decodeSqlError(cause, operation))
  );

const toSnapshot = (
  row: EntitySnapshotRow
): Effect.Effect<EntitySnapshot, SqlError> =>
  Schema.decodeUnknownEffect(EntitySnapshot)({
    iri: row.iri,
    entityType: row.entity_type,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }).pipe(
    Effect.mapError((cause) =>
      decodeSqlError(cause, "entity_snapshots.decode")
    )
  );

const encodeJsonString = Schema.encodeUnknownEffect(
  Schema.UnknownFromJsonString
);

const encodePayload = <Def extends AnyEntityDefinition>(
  definition: Def,
  entity: EntityOf<Def>
): Effect.Effect<string, Schema.SchemaError> =>
  Schema.encodeUnknownEffect(definition.schema)(entity).pipe(
    Effect.flatMap((encoded) => encodeJsonString(encoded)),
    Effect.map((payload) => String(payload))
  ) as Effect.Effect<string, Schema.SchemaError>;

const decodePayload = <Def extends AnyEntityDefinition>(
  definition: Def,
  payloadJson: string
): Effect.Effect<EntityOf<Def>, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(definition.schema as Schema.Top) as Schema.Decoder<
      unknown,
      EntityOf<Def>
    >
  )(payloadJson) as Effect.Effect<EntityOf<Def>, Schema.SchemaError>;

const saveWithSql = (
  sql: SqlClient.SqlClient,
  iri: string,
  entityType: string,
  payloadJson: string,
  now: number
) =>
  sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO entities (iri, entity_type, created_at, updated_at)
        VALUES (${iri}, ${entityType}, ${now}, ${now})
        ON CONFLICT(iri) DO UPDATE SET
          entity_type = excluded.entity_type,
          updated_at = excluded.updated_at
      `.pipe(Effect.asVoid);
      yield* sql`
        INSERT INTO entity_snapshots (
          iri,
          entity_type,
          payload_json,
          created_at,
          updated_at
        ) VALUES (
          ${iri},
          ${entityType},
          ${payloadJson},
          ${now},
          ${now}
        )
        ON CONFLICT(iri) DO UPDATE SET
          entity_type = excluded.entity_type,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `.pipe(Effect.asVoid);
    })
  );

const saveWithD1Batch = (
  db: D1DatabaseBinding,
  iri: string,
  entityType: string,
  payloadJson: string,
  now: number
) =>
  runD1Batch(
    db,
    [
      db
        .prepare(
          `INSERT INTO entities (iri, entity_type, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(iri) DO UPDATE SET
             entity_type = excluded.entity_type,
             updated_at = excluded.updated_at`
        )
        .bind(iri, entityType, now, now),
      db
        .prepare(
          `INSERT INTO entity_snapshots (
             iri,
             entity_type,
             payload_json,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(iri) DO UPDATE SET
             entity_type = excluded.entity_type,
             payload_json = excluded.payload_json,
             updated_at = excluded.updated_at`
        )
        .bind(iri, entityType, payloadJson, now, now)
    ],
    "EntitySnapshotStoreD1.save"
  );

export class EntitySnapshotStore extends ServiceMap.Service<
  EntitySnapshotStore,
  {
    readonly save: <Def extends AnyEntityDefinition>(
      definition: Def,
      entity: EntityOf<Def>
    ) => Effect.Effect<void, SqlError | Schema.SchemaError>;
    readonly load: <Def extends AnyEntityDefinition>(
      definition: Def,
      iri: Schema.Schema.Type<Def["identity"]["iri"]>
    ) => Effect.Effect<
      EntityOf<Def>,
      SqlError | Schema.SchemaError | EntityNotFoundError
    >;
  }
>()("@skygest/ontology-store/EntitySnapshotStore") {}

export const entitySnapshotStorageAdapter = <
  Def extends AnyEntityDefinition
>(
  store: (typeof EntitySnapshotStore)["Service"],
  definition: Def
): StorageAdapter<Def> => ({
  definition,
  load: (iri) => store.load(definition, iri),
  save: (entity) => store.save(definition, entity)
});

export const makeEntitySnapshotStorageAdapter = <
  Def extends AnyEntityDefinition
>(
  definition: Def
): Effect.Effect<StorageAdapter<Def>, never, EntitySnapshotStore> =>
  EntitySnapshotStore.use((store) =>
    Effect.succeed(entitySnapshotStorageAdapter(store, definition))
  );

export const EntitySnapshotStoreD1 = {
  layer: Layer.effect(
    EntitySnapshotStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rawDb = yield* optionalD1Database;

      const save = <Def extends AnyEntityDefinition>(
        definition: Def,
        entity: EntityOf<Def>
      ) =>
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknownEffect(definition.schema)(
            entity
          );
          const iri = definition.identity.iriOf(decoded as never);
          const entityType = definition.tag;
          const payloadJson = yield* encodePayload(
            definition,
            decoded as EntityOf<Def>
          );
          const now = yield* Clock.currentTimeMillis;
          if (rawDb === null) {
            yield* saveWithSql(sql, iri, entityType, payloadJson, now);
          } else {
            yield* saveWithD1Batch(rawDb, iri, entityType, payloadJson, now);
          }
        }) as Effect.Effect<void, SqlError | Schema.SchemaError>;

      const load = <Def extends AnyEntityDefinition>(
        definition: Def,
        iri: Schema.Schema.Type<Def["identity"]["iri"]>
      ) =>
        Effect.gen(function* () {
          const rows = yield* sql<EntitySnapshotRow>`
            SELECT
              iri as iri,
              entity_type as entity_type,
              payload_json as payload_json,
              created_at as created_at,
              updated_at as updated_at
            FROM entity_snapshots
            WHERE iri = ${iri}
              AND entity_type = ${definition.tag}
            LIMIT 1
          `.pipe((effect) =>
            Effect.flatMap(effect, (rows) =>
              decodeRows(rows, "entity_snapshots.load")
            )
          );
          const row = rows[0];
          if (row === undefined) {
            return yield* new EntityNotFoundError({ iri });
          }
          const snapshot = yield* toSnapshot(row);
          return yield* decodePayload(definition, snapshot.payloadJson);
        });

      return EntitySnapshotStore.of({ save, load });
    })
  )
};
