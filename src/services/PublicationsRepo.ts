import { ServiceMap, Effect } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  PublicationListItem,
  PublicationRecord,
  ListPublicationsInput,
  PublicationSeedManifest,
  SeedPublicationsResult
} from "../domain/bi";

export class PublicationsRepo extends ServiceMap.Service<
  PublicationsRepo,
  {
    readonly seedCurated: (
      manifest: PublicationSeedManifest,
      observedAt: number
    ) => Effect.Effect<SeedPublicationsResult, SqlError | DbError>;
    readonly list: (
      input: ListPublicationsInput
    ) => Effect.Effect<ReadonlyArray<PublicationListItem>, SqlError | DbError>;
    readonly ensureDomains: (
      hostnames: ReadonlyArray<string>,
      observedAt: number
    ) => Effect.Effect<void, SqlError | DbError>;

    readonly getByHostnames: (
      hostnames: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<PublicationRecord>, SqlError | DbError>;
    readonly getByShowSlugs: (
      showSlugs: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<PublicationRecord>, SqlError | DbError>;
  }
>()("@skygest/PublicationsRepo") {}
