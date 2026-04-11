import { Effect } from "effect";
import {
  ScriptConfig,
  type ScriptConfigShape,
  runGridStatusIngest
} from "../src/ingest/dcat-adapters/gridstatus";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export { runGridStatusIngest };
export type { ScriptConfigShape };

const main = Effect.fn("GridStatusIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runGridStatusIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) =>
    Logging.logFailure("gridstatus ingest failed", error)
  )
);

if (import.meta.main) {
  runScriptMain(
    "GridStatusIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
