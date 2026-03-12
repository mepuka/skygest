import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import snapshot from "../../config/ontology/energy-snapshot.json";

const namespaceId = process.argv[2];
const configPath = process.argv[3] === undefined
  ? resolve(import.meta.dir, "../../wrangler.toml")
  : resolve(import.meta.dir, "../..", process.argv[3]);

if (namespaceId === undefined) {
  throw new Error("Usage: bun run src/scripts/seed-ontology-kv.ts <namespace-id> [wrangler-config]");
}

const tempDir = await mkdtemp(join(tmpdir(), "skygest-ontology-"));
const snapshotPath = join(tempDir, "energy-snapshot.json");
const pointerPath = join(tempDir, "active-pointer.json");

try {
  await Bun.write(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await Bun.write(pointerPath, `${JSON.stringify({ snapshotVersion: snapshot.snapshotVersion }, null, 2)}\n`);

  const runWrangler = async (args: ReadonlyArray<string>) => {
    const proc = Bun.spawn({
      cmd: ["bunx", "wrangler", ...args],
      stdout: "inherit",
      stderr: "inherit"
    });
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`wrangler exited with status ${exitCode}`);
    }
  };

  await runWrangler([
    "kv",
    "key",
    "put",
    `--namespace-id=${namespaceId}`,
    "--config",
    configPath,
    `ontology:energy:snapshots:${snapshot.snapshotVersion}`,
    "--path",
    snapshotPath
  ]);
  await runWrangler([
    "kv",
    "key",
    "put",
    `--namespace-id=${namespaceId}`,
    "--config",
    configPath,
    "ontology:energy:active",
    "--path",
    pointerPath
  ]);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
