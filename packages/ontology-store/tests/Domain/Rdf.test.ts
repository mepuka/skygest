import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { IRI, RdfError } from "../../src/Domain/Rdf";

describe("IRI", () => {
  it("accepts a well-formed HTTP IRI", () => {
    const result = Schema.decodeUnknownSync(IRI)("https://id.skygest.io/agent/ag_01");
    expect(result).toBe("https://id.skygest.io/agent/ag_01");
  });

  it("rejects the empty string", () => {
    expect(() => Schema.decodeUnknownSync(IRI)("")).toThrow();
  });

  it("rejects non-string values", () => {
    expect(() => Schema.decodeUnknownSync(IRI)(42)).toThrow();
    expect(() => Schema.decodeUnknownSync(IRI)(null)).toThrow();
  });
});

describe("RdfError", () => {
  it("constructs with operation + message", () => {
    const err = new RdfError({ operation: "parseTurtle", message: "unexpected token" });
    expect(err._tag).toBe("RdfError");
    expect(err.operation).toBe("parseTurtle");
    expect(err.message).toBe("unexpected token");
  });

  it("constructs with an optional cause", () => {
    const err = new RdfError({
      operation: "addQuads",
      message: "invalid term",
      cause: "TypeError: term.subject is null"
    });
    expect(err.cause).toBe("TypeError: term.subject is null");
  });
});
