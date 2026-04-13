import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { checkedInDataLayerRegistryRoot, loadCheckedInDataLayerRegistry } from "../src/bootstrap/CheckedInDataLayerRegistry";
import { runStage1 } from "../src/resolution/Stage1";
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

  it.effect(
    "matches newly added human-facing dataset aliases through Stage 1",
    () =>
      Effect.gen(function* () {
        const prepared = yield* loadCheckedInDataLayerRegistry(
          checkedInDataLayerRegistryRoot
        ).pipe(Effect.provide(localFileSystemLayer));
        const lookup = toDataLayerRegistryLookup(prepared);

        const makeInput = (
          datasetName: string,
          providerLabel: string,
          domain: string
        ) => ({
          postContext: {
            postUri: "at://did:plc:test/app.bsky.feed.post/catalog-alias-check" as any,
            text: "",
            links: [],
            linkCards: [],
            threadCoverage: "focus-only" as const
          },
          sourceAttribution: {
            kind: "source-attribution" as const,
            provider: {
              providerId: providerLabel.toLowerCase() as any,
              providerLabel,
              sourceFamily: null
            },
            resolution: "matched" as const,
            providerCandidates: [],
            contentSource: {
              url: `https://${domain}`,
              title: null,
              domain,
              publication: providerLabel
            },
            socialProvenance: null,
            processedAt: 0
          },
          vision: {
            kind: "vision" as const,
            summary: {
              text: "Summary",
              mediaTypes: ["chart"] as const,
              chartTypes: ["line-chart"] as const,
              titles: [],
              keyFindings: []
            },
            assets: [
              {
                assetKey: "asset-1",
                assetType: "image" as const,
                source: "embed" as const,
                index: 0,
                originalAltText: null,
                extractionRoute: "full" as const,
                analysis: {
                  mediaType: "chart" as const,
                  chartTypes: ["line-chart"] as const,
                  altText: null,
                  altTextProvenance: "absent" as const,
                  xAxis: null,
                  yAxis: null,
                  series: [],
                  sourceLines: [
                    {
                      sourceText: `Source: ${providerLabel}`,
                      datasetName
                    }
                  ],
                  temporalCoverage: null,
                  keyFindings: [],
                  visibleUrls: [],
                  organizationMentions: [],
                  logoText: [],
                  title: null,
                  modelId: "test",
                  processedAt: 0
                }
              }
            ],
            modelId: "test",
            promptVersion: "v1",
            processedAt: 0
          }
        });

        const emberResult = runStage1(
          makeInput(
            "Ember Electricity Data Explorer",
            "Ember",
            "ember-energy.org"
          ),
          lookup
        );
        expect(
          emberResult.matches.some(
            (match) =>
              match._tag === "DatasetMatch" &&
              match.title === "Ember Data Explorer"
          )
        ).toBe(true);

        const eiaResult = runStage1(
          makeInput(
            "EIA Hourly Electric Grid Monitor",
            "EIA",
            "www.eia.gov"
          ),
          lookup
        );
        expect(
          eiaResult.matches.some(
            (match) =>
              match._tag === "DatasetMatch" &&
              match.title === "EIA U.S. Electric System Operating Data"
          )
        ).toBe(true);

        const nrelResult = runStage1(
          makeInput(
            "2024 NREL ATB",
            "NREL",
            "www.nrel.gov"
          ),
          lookup
        );
        expect(
          nrelResult.matches.some(
            (match) =>
              match._tag === "DatasetMatch" &&
              match.title === "NREL Annual Technology Baseline"
          )
        ).toBe(true);
      }),
    registryLoadTimeoutMs
  );
});
