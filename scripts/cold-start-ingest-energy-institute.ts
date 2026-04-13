import { Effect } from "effect";
import {
  ScriptConfig,
  type ScriptConfigShape,
  runEnergyInstituteIngest
} from "../src/ingest/dcat-adapters/energy-institute";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export { runEnergyInstituteIngest };
export type { ScriptConfigShape };

const main = Effect.fn("EnergyInstituteIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runEnergyInstituteIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) =>
    Logging.logFailure("energy institute ingest failed", error)
  )
);

if (import.meta.main) {
  runScriptMain(
    "EnergyInstituteIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
