import { Effect, Path } from "effect";
import { fetchGitSnapshot } from "./fetch-git-snapshot";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export const fetchIngestArtifacts = Effect.fn("fetch-ingest-artifacts.run")(function* () {
  const path = yield* Path.Path;

  yield* fetchGitSnapshot({
    lockFile: path.resolve(process.cwd(), "ingest-artifacts.lock.json"),
    destDir: path.resolve(process.cwd(), ".generated/cold-start"),
    requiredManifestFile: "manifest.json"
  });
});

if (import.meta.main) {
  runScriptMain(
    "fetch-ingest-artifacts",
    fetchIngestArtifacts.pipe(Effect.provide(scriptPlatformLayer))
  );
}
