import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { AiSearchError, RdfMappingError } from "../src/domain/errors";

describe("AiSearchError", () => {
  it("constructs with required fields and JSON-encodes through Schema", () => {
    const err = new AiSearchError({
      operation: "upload",
      instance: "experts",
      message: "binding upload failed"
    });
    expect(err._tag).toBe("AiSearchError");
    expect(err.operation).toBe("upload");
    const encoded = Schema.encodeUnknownSync(AiSearchError)(err);
    expect(encoded._tag).toBe("AiSearchError");
  });

  it("accepts optional status and key", () => {
    const err = new AiSearchError({
      operation: "search",
      instance: "experts",
      message: "rate limited",
      status: 429,
      retryAfterMs: 1_000,
      key: "expert/did:plc:xyz.md"
    });
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(1_000);
    expect(err.key).toBe("expert/did:plc:xyz.md");
  });
});

describe("RdfMappingError", () => {
  it("constructs with direction tag and entity name", () => {
    const err = new RdfMappingError({
      direction: "forward",
      entity: "Expert",
      message: "missing required field"
    });
    expect(err._tag).toBe("RdfMappingError");
    expect(err.direction).toBe("forward");
  });
});
