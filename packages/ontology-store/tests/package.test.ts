import { describe, expect, it } from "@effect/vitest";

import { ontologyStorePackageMarker } from "../src/index";

describe("@skygest/ontology-store", () => {
  it("resolves the package marker through workspace wiring", () => {
    expect(ontologyStorePackageMarker).toBe("@skygest/ontology-store@stub");
  });
});
