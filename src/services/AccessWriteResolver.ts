import { Effect, Request, RequestResolver } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import { AccessRepo, type AccessLog } from "./AccessRepo";

export class LogAccess extends Request.TaggedClass("LogAccess")<
  void,
  SqlError,
  { readonly log: AccessLog }
> {}

export type AccessWriteRequest = LogAccess;

export const AccessWriteResolver = RequestResolver.fromEffectTagged<AccessWriteRequest>()({
  LogAccess: (requests) =>
    Effect.gen(function* () {
      const access = yield* AccessRepo;
      yield* access.logAccessMany(requests.map((req) => req.log));
      return requests.map(() => undefined);
    })
});
