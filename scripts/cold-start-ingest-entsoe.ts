import { Effect } from "effect";
import {
  ScriptConfig,
  type ScriptConfigShape,
  runEntsoeIngest
} from "../src/ingest/dcat-adapters/entsoe";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export { runEntsoeIngest };
export type { ScriptConfigShape };

const main = Effect.fn("EntsoeIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runEntsoeIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) =>
    Logging.logFailure("entsoe ingest failed", error)
  )
);

if (import.meta.main) {
  runScriptMain(
    "EntsoeIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
