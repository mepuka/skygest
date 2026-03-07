import { Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  assertValidExpertSeedManifest,
  mergeExpertSeedManifest
} from "../src/bootstrap/ExpertSeeds";
import { ExpertSeed, ExpertSeedManifest } from "../src/domain/bi";

const decodeManifest = Schema.decodeUnknownSync(ExpertSeedManifest);
const decodeSeeds = Schema.decodeUnknownSync(Schema.Array(ExpertSeed));

describe("expert seed manifests", () => {
  it("rejects duplicate handles after normalization", () => {
    const manifest = decodeManifest({
      domain: "energy",
      experts: [
        {
          did: "did:plc:seed-alpha",
          handle: "CanaryMedia.com",
          source: "manual",
          active: true
        },
        {
          did: "did:plc:seed-beta",
          handle: "canarymedia.com",
          source: "network",
          active: true
        }
      ]
    });

    expect(() => assertValidExpertSeedManifest(manifest)).toThrow(
      /duplicate handle "canarymedia\.com"/u
    );
  });

  it("skips additions already present by did or handle", () => {
    const manifest = decodeManifest({
      domain: "energy",
      experts: [
        {
          did: "did:plc:seed-alpha",
          handle: "grist.org",
          source: "manual",
          active: true
        }
      ]
    });
    const additions = decodeSeeds([
      {
        did: "did:plc:seed-beta",
        handle: "GRIST.ORG",
        source: "network",
        active: true
      },
      {
        did: "did:plc:seed-gamma",
        handle: "heatmap.news",
        source: "network",
        active: true
      }
    ]);

    const merged = mergeExpertSeedManifest(manifest, additions);

    expect(merged.experts.map((expert) => expert.did)).toEqual([
      "did:plc:seed-alpha",
      "did:plc:seed-gamma"
    ]);
  });
});
