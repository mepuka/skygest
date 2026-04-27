/**
 * Canonical Expert fixture used by the six-phase round-trip test.
 *
 * Decoded synchronously through `Schema.decodeUnknownSync` so the value is
 * already brand-validated at module load time. If a future change to
 * `Expert` breaks this fixture, the round-trip test will fail to import
 * rather than reach phase 1 — the failure pins to the schema, not the
 * pipeline.
 */

import { Schema } from "effect";

import { Expert } from "../../src/agent/expert";

export const fixtureExpert: Expert = Schema.decodeUnknownSync(Expert)({
  iri: "https://w3id.org/energy-intel/expert/MarkZJacobson",
  did: "did:plc:xyz",
  displayName: "Mark Z. Jacobson",
  roles: ["https://w3id.org/energy-intel/energyExpertRole/research"],
  bio: "Energy researcher.",
  tier: "top",
  primaryTopic: "renewables-grid"
});
