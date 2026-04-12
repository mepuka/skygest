import { Effect } from "effect";
import {
  ScriptConfig,
  type ScriptConfigShape,
  runDataEuropaIngest
} from "../src/ingest/dcat-adapters/data-europa";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export { runDataEuropaIngest };
export type { ScriptConfigShape };

const main = Effect.fn("DataEuropaIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runDataEuropaIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) =>
    Logging.logFailure("data-europa ingest failed", error)
  )
);

if (import.meta.main) {
  runScriptMain(
    "DataEuropaIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
