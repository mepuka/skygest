import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import manifestJson from "../references/data-layer-spine/manifest.json";
import { DataLayerSpineManifestLoadError } from "../src/domain/errors";
import { DataLayerSpineManifest } from "../src/domain/dataLayerSpineManifest";
import {
  decodeDataLayerSpineManifest,
  renderSpineFile
} from "../scripts/generate-data-layer-spine";

const decodeManifestSync = Schema.decodeUnknownSync(DataLayerSpineManifest);
const manifest = decodeManifestSync(manifestJson);
const checkedInGenerated = readFileSync(
  `${process.cwd()}/src/domain/generated/dataLayerSpine.ts`,
  "utf8"
);

describe("data-layer spine generation", () => {
  it("renders deterministically from the checked-in manifest", () => {
    const first = renderSpineFile(manifest);
    const second = renderSpineFile(manifest);

    expect(first).toBe(second);
  });

  it("matches the checked-in generated file exactly", () => {
    const rendered = renderSpineFile(manifest);
    expect(`${rendered}\n`).toBe(checkedInGenerated);
  });

  it("records manifest metadata in the generated header", () => {
    const rendered = renderSpineFile(manifest);

    expect(rendered).toContain(
      ` * Manifest version: ${String(manifest.manifestVersion)}`
    );
    expect(rendered).toContain(` * Ontology version: ${manifest.ontologyVersion}`);
    expect(rendered).toContain(` * Source commit: ${manifest.sourceCommit}`);
    expect(rendered).toContain(` * Generated at: ${manifest.generatedAt}`);
    expect(rendered).toContain(` * Input hash: ${manifest.inputHash}`);
  });

  it("changes output when manifest field order changes", () => {
    const reordered = structuredClone(manifestJson);
    reordered.classes.Variable.fields = [
      ...reordered.classes.Variable.fields
    ].reverse();

    const original = renderSpineFile(manifest);
    const reorderedOutput = renderSpineFile(decodeManifestSync(reordered));

    expect(reorderedOutput).not.toBe(original);
  });

  it("wraps exactly the optional generated fields in Schema.optionalKey", () => {
    const rendered = renderSpineFile(manifest);
    const byRuntimeName = new Map<string, string>();

    for (const line of rendered.split("\n")) {
      const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*): (.+),$/u.exec(line);
      if (match !== null) {
        const fieldName = match[1];
        const renderedExpr = match[2];
        if (fieldName !== undefined && renderedExpr !== undefined) {
          byRuntimeName.set(fieldName, renderedExpr);
        }
      }
    }

    for (const classKey of ["Agent", "Dataset", "Variable", "Series"] as const) {
      for (const field of manifest.classes[classKey].fields) {
        if (field.generation !== "generated") {
          continue;
        }

        const renderedExpr = byRuntimeName.get(field.runtimeName);
        if (renderedExpr === undefined) {
          throw new Error(
            `missing generated field line for ${classKey}.${field.runtimeName}`
          );
        }

        expect(renderedExpr.includes("Schema.optionalKey(")).toBe(field.optional);
      }
    }
  });

  it.effect("surfaces manifestVersion mismatches as DataLayerSpineManifestLoadError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeDataLayerSpineManifest(
          "fixture.json",
          JSON.stringify({ ...manifestJson, manifestVersion: 2 })
        )
      );

      expect(error).toBeInstanceOf(DataLayerSpineManifestLoadError);
      expect(error._tag).toBe("DataLayerSpineManifestLoadError");
      expect(error.path).toBe("fixture.json");
      expect(error.issues).not.toHaveLength(0);
    })
  );
});
