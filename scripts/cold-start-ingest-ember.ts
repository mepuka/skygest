import { Effect } from "effect";
import {
  ScriptConfig,
  type ScriptConfigShape,
  runEmberIngest
} from "../src/ingest/dcat-adapters/ember";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export { runEmberIngest };
export type { ScriptConfigShape };

const main = Effect.fn("EmberIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runEmberIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) => Logging.logFailure("ember ingest failed", error))
);

if (import.meta.main) {
  runScriptMain(
    "EmberIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
