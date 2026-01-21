import { Context, Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";

export class JetstreamCursorStore extends Context.Tag("@skygest/JetstreamCursorStore")<
  JetstreamCursorStore,
  {
    readonly getCursor: () => Effect.Effect<number | null>;
    readonly setCursor: (cursor: number) => Effect.Effect<void>;
  }
>() {
  static layer = Layer.effect(
    JetstreamCursorStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const getCursor = () =>
        sql<{ cursor: number }>`SELECT cursor FROM jetstream_state WHERE id = 'main'`.pipe(
          Effect.map((rows) => rows[0]?.cursor ?? null)
        );

      const setCursor = (cursor: number) =>
        sql`
          INSERT INTO jetstream_state (id, cursor) VALUES ('main', ${cursor})
          ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor
        `.pipe(Effect.asVoid);

      return JetstreamCursorStore.of({ getCursor, setCursor });
    })
  );
}
