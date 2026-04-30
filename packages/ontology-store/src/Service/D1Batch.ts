import { D1Client } from "@effect/sql-d1";
import { Effect, Option } from "effect";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";

export type D1DatabaseBinding = D1Client.D1Client["config"]["db"];
export type D1PreparedStatementBinding = ReturnType<
  D1DatabaseBinding["prepare"]
>;

type D1BatchResult = {
  readonly success?: boolean;
  readonly error?: unknown;
};

export const optionalD1Database: Effect.Effect<D1DatabaseBinding | null> =
  Effect.serviceOption(D1Client.D1Client).pipe(
    Effect.map(
      Option.match({
        onNone: () => null,
        onSome: (client) => client.config.db
      })
    )
  );

export const d1BatchSqlError = (
  cause: unknown,
  operation: string
): SqlError =>
  new SqlError({
    reason: new UnknownError({
      cause,
      message: `Failed to execute D1 batch for ${operation}`,
      operation
    })
  });

export const runD1Batch = (
  db: D1DatabaseBinding,
  statements: ReadonlyArray<D1PreparedStatementBinding>,
  operation: string
): Effect.Effect<void, SqlError> =>
  Effect.tryPromise({
    try: () => db.batch(Array.from(statements)),
    catch: (cause) => d1BatchSqlError(cause, operation)
  }).pipe(
    Effect.flatMap((results) => {
      const failureIndex = (results as ReadonlyArray<D1BatchResult>).findIndex(
        (result) => result.success === false
      );
      return failureIndex === -1
        ? Effect.void
        : Effect.fail(
            d1BatchSqlError(
              (results as ReadonlyArray<D1BatchResult>)[failureIndex],
              `${operation}[${String(failureIndex)}]`
            )
          );
    })
  );
