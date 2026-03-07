import { Context, Effect, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import { ExpertNotFoundError, type ExpertRecord } from "../domain/bi";
import { BlueskyApiError, PollerBusyError } from "../domain/errors";
import type { PollFailure, PollRequest, PollRunSummary } from "../domain/polling";
import { ExpertPoller, type ExpertPollResult } from "./ExpertPoller";
import { ExpertsRepo } from "../services/ExpertsRepo";
import { IngestLeaseRepo } from "../services/IngestLeaseRepo";

const LEASE_NAME = "expert-poller";
const LEASE_TTL_MS = 10 * 60 * 1000;
const POLL_CONCURRENCY = 5;

type PollCoordinatorError = PollerBusyError | ExpertNotFoundError | SqlError | BlueskyApiError;

export class PollCoordinator extends Context.Tag("@skygest/PollCoordinator")<
  PollCoordinator,
  {
    readonly run: (
      request: PollRequest
    ) => Effect.Effect<PollRunSummary, PollCoordinatorError>;
  }
>() {
  static readonly layer = Layer.effect(
    PollCoordinator,
    Effect.gen(function* () {
      const expertsRepo = yield* ExpertsRepo;
      const leases = yield* IngestLeaseRepo;
      const poller = yield* ExpertPoller;

      const loadExperts = Effect.fn("PollCoordinator.loadExperts")(function* (
        request: PollRequest
      ) {
        if (request.did !== undefined) {
          const expert = yield* expertsRepo.getByDid(request.did);
          if (expert === null) {
            return yield* ExpertNotFoundError.make({
              did: request.did
            });
          }
          return [expert] as const;
        }

        return yield* expertsRepo.listActive();
      });

      const run = Effect.fn("PollCoordinator.run")(function* (request: PollRequest) {
        const owner = crypto.randomUUID();
        const startedAt = Date.now();
        const expiresAt = startedAt + LEASE_TTL_MS;
        const acquired = yield* leases.tryAcquire(LEASE_NAME, owner, startedAt, expiresAt);

        if (!acquired) {
          return yield* PollerBusyError.make({
            lease: LEASE_NAME,
            message: "poller lease is already held"
          });
        }

        return yield* Effect.gen(function* () {
          const experts = yield* loadExperts(request);
          const failures: Array<PollFailure> = [];
          let expertsSucceeded = 0;
          let expertsFailed = 0;
          let pagesFetched = 0;
          let postsSeen = 0;
          let postsStored = 0;
          let postsDeleted = 0;

          const refreshLease = () => Effect.gen(function* () {
            const renewed = yield* leases.renew(
              LEASE_NAME,
              owner,
              Date.now() + LEASE_TTL_MS
            );

            if (!renewed) {
              return yield* PollerBusyError.make({
                lease: LEASE_NAME,
                message: "poller lease could not be renewed"
              });
            }
          });

          const recordSuccess = (result: ExpertPollResult) => {
            expertsSucceeded += 1;
            pagesFetched += result.pagesFetched;
            postsSeen += result.postsSeen;
            postsStored += result.postsStored;
            postsDeleted += result.postsDeleted;
          };

          yield* Effect.forEach(
            experts,
            (expert: ExpertRecord) =>
              refreshLease().pipe(
                Effect.flatMap(() => poller.poll(expert, request)),
                Effect.tap((result) => Effect.sync(() => recordSuccess(result))),
                Effect.catchAll((error) =>
                  error instanceof PollerBusyError
                    ? Effect.fail(error)
                    : Effect.sync(() => {
                      expertsFailed += 1;
                      failures.push({
                        did: expert.did,
                        message: error instanceof Error ? error.message : String(error)
                      });
                    })
                )
              ),
            {
              concurrency: POLL_CONCURRENCY,
              discard: true
            }
          );

          const finishedAt = Date.now();
          const summary: PollRunSummary = {
            runId: owner,
            mode: request.mode,
            startedAt,
            finishedAt,
            expertsTotal: experts.length,
            expertsSucceeded,
            expertsFailed,
            pagesFetched,
            postsSeen,
            postsStored,
            postsDeleted,
            failures
          };

          yield* Effect.logInfo("poll run completed").pipe(
            Effect.annotateLogs({
              runId: summary.runId,
              mode: summary.mode,
              expertsTotal: summary.expertsTotal,
              expertsSucceeded: summary.expertsSucceeded,
              expertsFailed: summary.expertsFailed,
              pagesFetched: summary.pagesFetched,
              postsSeen: summary.postsSeen,
              postsStored: summary.postsStored,
              postsDeleted: summary.postsDeleted,
              durationMs: finishedAt - startedAt
            })
          );

          return summary;
        }).pipe(
          Effect.ensuring(
            leases.release(LEASE_NAME, owner).pipe(Effect.orDie)
          )
        );
      });

      return PollCoordinator.of({
        run
      });
    })
  );
}
