import { Effect } from "effect";
import {
  ScriptConfig,
  type ScriptConfigShape,
  runOdreIngest
} from "../src/ingest/dcat-adapters/odre";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export { runOdreIngest };
export type { ScriptConfigShape };

const main = Effect.fn("OdreIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runOdreIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) =>
    Logging.logFailure("odre ingest failed", error)
  )
);

if (import.meta.main) {
  runScriptMain(
    "OdreIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
