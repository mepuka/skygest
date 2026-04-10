import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Agent, Dataset } from "../src/domain/data-layer";
import {
  type IngestNode,
  validateCandidatesWith,
  validateNodeWith
} from "../src/ingest/dcat-harness";

const FIXTURE_NOW = "2026-04-10T00:00:00.000Z";

type FixtureAlias = {
  readonly scheme: string;
  readonly value: string;
  readonly relation: string;
};

const validAgentBody = (
  name: string,
  ulid: string,
  aliases: ReadonlyArray<FixtureAlias>
) => ({
  _tag: "Agent",
  id: `https://id.skygest.io/agent/ag_${ulid}`,
  kind: "organization",
  name,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  aliases
});

const validDatasetBody = (
  title: string,
  ulid: string,
  aliases: ReadonlyArray<FixtureAlias>,
  publisherAgentId: string = "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB"
) => ({
  _tag: "Dataset",
  id: `https://id.skygest.io/dataset/ds_${ulid}`,
  title,
  publisherAgentId,
  accessRights: "public",
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  aliases
});

type ValidationTestError = {
  readonly _tag: "ValidationTestError";
  readonly kind: string;
  readonly slug: string;
};

const mapError = (node: IngestNode): ValidationTestError => ({
  _tag: "ValidationTestError",
  kind: node._tag,
  slug: node.slug
});

describe("dcat-harness validate", () => {
  it.effect("validates a good node and returns the post-parse node shape", () =>
    Effect.gen(function* () {
      const node: IngestNode = {
        _tag: "agent",
        slug: "eia",
        data: validAgentBody("U.S. Energy Information Administration", "01KNQEZ5V57VJJJFYV6HWM03VB", [
          {
            scheme: "url",
            value: "https://www.eia.gov/",
            relation: "exactMatch"
          }
        ]) as unknown as Agent
      };

      const validated = yield* validateNodeWith(node, mapError);
      expect(validated._tag).toBe("agent");
      expect(validated.slug).toBe("eia");
      expect(validated.data.id).toBe(node.data.id);
    })
  );

  it.effect("partitions failures and successes without aborting on the first bad node", () =>
    Effect.gen(function* () {
      const good: IngestNode = {
        _tag: "agent",
        slug: "eia",
        data: validAgentBody("U.S. Energy Information Administration", "01KNQEZ5V57VJJJFYV6HWM03VB", [
          {
            scheme: "url",
            value: "https://www.eia.gov/",
            relation: "exactMatch"
          }
        ]) as unknown as Agent
      };
      const bad: IngestNode = {
        _tag: "dataset",
        slug: "eia-bogus",
        merged: false,
        data: {
          ...validDatasetBody("Bogus", "01KNQSXEPPXRC56GM4SED9D0KX", []),
          id: "not-a-uri"
        } as unknown as Dataset
      };

      const { failures, successes } = yield* validateCandidatesWith(
        [bad, good],
        (candidate) => validateNodeWith(candidate, mapError)
      );

      expect(failures).toEqual([
        {
          _tag: "ValidationTestError",
          kind: "dataset",
          slug: "eia-bogus"
        }
      ]);
      expect(successes).toHaveLength(1);
      expect(successes[0]!._tag).toBe("agent");
      expect(successes[0]!.slug).toBe("eia");
    })
  );
});
