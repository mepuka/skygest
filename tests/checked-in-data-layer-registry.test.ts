import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { checkedInDataLayerRegistryRoot, loadCheckedInDataLayerRegistry } from "../src/bootstrap/CheckedInDataLayerRegistry";
import { toDataLayerRegistryLookup } from "../src/resolution/dataLayerRegistry";
import { layer as localFileSystemLayer } from "./helpers/LocalFileSystem";

// Flake fix: full-suite contention can push this real registry load past Vitest's 5s default.
const registryLoadTimeoutMs = 30_000;

describe("checked-in data layer registry loader", () => {
  it.effect(
    "loads the checked-in cold-start registry",
    () =>
      Effect.gen(function* () {
        const prepared = yield* loadCheckedInDataLayerRegistry(
          checkedInDataLayerRegistryRoot
        ).pipe(Effect.provide(localFileSystemLayer));
        const lookup = toDataLayerRegistryLookup(prepared);

        const distribution = Option.getOrNull(
          lookup.findDistributionByUrl(
            "https://api.eia.gov/v2/eba/?foo=bar#chart"
          )
        );

        expect(Array.from(prepared.entities).length).toBeGreaterThan(0);
        expect(distribution?.id).toBe(
          "https://id.skygest.io/distribution/dist_01KNQSXEPQE7D85JBAFH47Y9MS"
        );
      }),
    registryLoadTimeoutMs
  );

  it.effect("fails with a typed diagnostic when the root is missing", () =>
    Effect.gen(function* () {
      const failure = yield* loadCheckedInDataLayerRegistry(
        "references/cold-start/does-not-exist"
      ).pipe(
        Effect.provide(localFileSystemLayer),
        Effect.flip
      );

      expect(failure._tag).toBe("DataLayerRegistryLoadError");
      expect(
        failure.diagnostic.issues.some(
          (issue: (typeof failure.diagnostic.issues)[number]) =>
            issue._tag === "FileReadIssue"
        )
      ).toBe(true);
    })
  );
});
