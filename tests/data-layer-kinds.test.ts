import { describe, expect, it } from "@effect/vitest";
import {
  DataLayerEntityTag,
  DataLayerKind,
  dataLayerEntityKindSpecByApiKind,
  dataLayerEntityKindSpecByTag,
  dataLayerEntityKindSpecs
} from "../src/domain/data-layer";

describe("data layer entity kind specs", () => {
  it("cover every API kind and entity tag exactly once", () => {
    expect(dataLayerEntityKindSpecs.map((spec) => spec.apiKind)).toEqual([
      ...DataLayerKind.literals
    ]);
    expect(dataLayerEntityKindSpecs.map((spec) => spec.tag)).toEqual([
      ...DataLayerEntityTag.literals
    ]);
  });

  it("exposes stable lookup tables over the canonical specs", () => {
    for (const spec of dataLayerEntityKindSpecs) {
      expect(dataLayerEntityKindSpecByApiKind[spec.apiKind]).toBe(spec);
      expect(dataLayerEntityKindSpecByTag[spec.tag]).toBe(spec);
      expect(spec.mintId()).toMatch(/^https:\/\/id\.skygest\.io\//u);
    }
  });
});
