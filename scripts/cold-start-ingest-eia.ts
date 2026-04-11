import { Effect } from "effect";
import {
  mainEffect
} from "../src/ingest/dcat-adapters/eia-tree";
export * from "../src/ingest/dcat-adapters/eia-tree";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

if (import.meta.main) {
  runScriptMain(
    "EiaIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
