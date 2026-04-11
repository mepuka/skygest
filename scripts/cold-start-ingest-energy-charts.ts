import { Effect } from "effect";
import {
  ScriptConfig,
  type ScriptConfigShape,
  runEnergyChartsIngest
} from "../src/ingest/dcat-adapters/energy-charts";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export { runEnergyChartsIngest };
export type { ScriptConfigShape };

const main = Effect.fn("EnergyChartsIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runEnergyChartsIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) =>
    Logging.logFailure("energy charts ingest failed", error)
  )
);

if (import.meta.main) {
  runScriptMain(
    "EnergyChartsIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
