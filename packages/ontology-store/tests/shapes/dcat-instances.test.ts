import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RdfStoreService } from "../../src/Service/RdfStore";
import { ShaclService } from "../../src/Service/Shacl";

const shapesPath = fileURLToPath(
  new URL("../../shapes/dcat-instances.ttl", import.meta.url)
);
const shapesText = readFileSync(shapesPath, "utf8");
const TestLayer = Layer.mergeAll(RdfStoreService.Default, ShaclService.Default);

describe("dcat-instances.ttl", () => {
  it("parses through ShaclService.loadShapes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const shacl = yield* ShaclService;
        const rdf = yield* RdfStoreService;

        const store = yield* shacl.loadShapes(shapesText);
        const size = yield* rdf.size(store);

        expect(size).toBeGreaterThan(0);
      }).pipe(Effect.provide(TestLayer), Effect.scoped)
    ));
});
