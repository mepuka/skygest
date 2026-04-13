import { Effect } from "effect";
import {
  ScriptConfig,
  type ScriptConfigShape,
  runNesoIngest
} from "../src/ingest/dcat-adapters/neso";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export { runNesoIngest };
export type { ScriptConfigShape };

const main = Effect.fn("NesoIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runNesoIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) => Logging.logFailure("neso ingest failed", error))
);

if (import.meta.main) {
  runScriptMain(
    "NesoIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
