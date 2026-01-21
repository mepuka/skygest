import { Array, Effect, Request, RequestResolver } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import { UsersRepo, type AccessIncrement } from "./UsersRepo";

export class IncrementAccess extends Request.TaggedClass("IncrementAccess")<
  void,
  SqlError,
  AccessIncrement
> {}

export type UsersWriteRequest = IncrementAccess;

export const UsersWriteResolver = RequestResolver.fromEffectTagged<UsersWriteRequest>()({
  IncrementAccess: (requests) =>
    Effect.gen(function* () {
      const users = yield* UsersRepo;
      const grouped = Array.groupBy(requests, (req) => req.did);
      const increments = Object.values(grouped).map((group) => {
        const initialAccessAt = group[0].lastAccessAt;
        const totals = Array.reduce(
          group,
          { access: 0, consent: 0, lastAccessAt: initialAccessAt },
          (acc, req) => ({
            access: acc.access + req.accessIncrement,
            consent: acc.consent + req.consentIncrement,
            lastAccessAt: Math.max(acc.lastAccessAt, req.lastAccessAt)
          })
        );
        return {
          did: group[0].did,
          accessIncrement: totals.access,
          consentIncrement: totals.consent,
          lastAccessAt: totals.lastAccessAt
        } satisfies AccessIncrement;
      });

      yield* users.incrementAccessMany(increments);
      return requests.map(() => undefined);
    })
});
