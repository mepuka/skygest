import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  fetchGitSnapshot
} from "../scripts/fetch-git-snapshot";
import { GitSnapshotStateFileName } from "../src/platform/GitSnapshot";
import { scriptPlatformLayer } from "../src/platform/ScriptRuntime";

const sha256Hex = (value: string | Uint8Array) =>
  crypto.createHash("sha256").update(value).digest("hex");

const normalizeRelativePath = (value: string) => value.split(nodePath.sep).join("/");

const computeTreeHash = async (
  rootDir: string,
  excludedRelativePaths: ReadonlyArray<string>
): Promise<string> => {
  const excluded = new Set(excludedRelativePaths);
  const entries: Array<{ readonly path: string; readonly sha256: string }> = [];

  const walk = async (currentDir: string) => {
    const names = (await fsp.readdir(currentDir)).sort((left, right) =>
      left.localeCompare(right)
    );

    for (const name of names) {
      if (name === ".git") {
        continue;
      }

      const absolutePath = nodePath.join(currentDir, name);
      const relativePath = normalizeRelativePath(
        nodePath.relative(rootDir, absolutePath)
      );

      if (excluded.has(relativePath)) {
        continue;
      }

      const stat = await fsp.stat(absolutePath);
      if (stat.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (stat.isFile()) {
        const bytes = await fsp.readFile(absolutePath);
        entries.push({ path: relativePath, sha256: sha256Hex(bytes) });
        continue;
      }

      throw new Error(`Unsupported fixture entry: ${absolutePath}`);
    }
  };

  await walk(rootDir);

  const listing = entries
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `${entry.path}\t${entry.sha256}`)
    .join("\n");

  return sha256Hex(listing);
};

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"]
  })
    .toString("utf8")
    .trim();

const writeJson = (filePath: string, value: unknown) =>
  fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const makeFixture = async (
  rootDir: string,
  options?: { readonly mutateAfterManifest?: boolean }
) => {
  const repoDir = nodePath.join(rootDir, "snapshot-repo");
  await fsp.mkdir(nodePath.join(repoDir, "catalog"), { recursive: true });
  await writeJson(nodePath.join(repoDir, "catalog", "dataset.json"), {
    _tag: "Dataset",
    id: "fixture-dataset"
  });
  await fsp.writeFile(
    nodePath.join(repoDir, "README.md"),
    "fixture snapshot\n",
    "utf8"
  );

  const manifest = {
    manifestVersion: 1,
    generatedAt: "2026-04-15T00:00:00Z",
    sourceCommit: "fixture-source-commit",
    inputHash: "sha256:fixture-input",
    treeHash: await computeTreeHash(repoDir, ["manifest.json"]),
    kind: "ingest-artifacts",
    counts: {
      datasets: 1
    }
  };

  const manifestPath = nodePath.join(repoDir, "manifest.json");
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await fsp.writeFile(manifestPath, manifestText, "utf8");

  if (options?.mutateAfterManifest === true) {
    await writeJson(nodePath.join(repoDir, "catalog", "dataset.json"), {
      _tag: "Dataset",
      id: "fixture-dataset-mutated"
    });
  }

  git(repoDir, "init");
  git(repoDir, "config", "user.name", "Codex Fixture");
  git(repoDir, "config", "user.email", "codex-fixture@example.com");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "fixture snapshot");

  const commit = git(repoDir, "rev-parse", "HEAD");
  const lockPath = nodePath.join(rootDir, "snapshot.lock.json");
  await writeJson(lockPath, {
    repo: repoDir,
    ref: "fixture",
    commit,
    manifestHash: sha256Hex(manifestText)
  });

  return {
    lockPath,
    repoDir,
    destDir: nodePath.join(rootDir, ".generated", "fixture")
  };
};

describe("fetchGitSnapshot", () => {
  it("is idempotent for the same pinned commit and does not delete existing contents on the second run", async () => {
    const rootDir = await fsp.mkdtemp(
      nodePath.join(os.tmpdir(), "git-snapshot-fetch-")
    );

    try {
      const fixture = await makeFixture(rootDir);

      await Effect.runPromise(
        fetchGitSnapshot({
          lockFile: fixture.lockPath,
          destDir: fixture.destDir,
          requiredManifestFile: "manifest.json"
        }).pipe(Effect.provide(scriptPlatformLayer))
      );

      const markerPath = nodePath.join(fixture.destDir, "local-marker.txt");
      await fsp.writeFile(markerPath, "leave me alone\n", "utf8");

      await Effect.runPromise(
        fetchGitSnapshot({
          lockFile: fixture.lockPath,
          destDir: fixture.destDir,
          requiredManifestFile: "manifest.json"
        }).pipe(Effect.provide(scriptPlatformLayer))
      );

      expect(await fsp.readFile(markerPath, "utf8")).toBe("leave me alone\n");
      expect(
        JSON.parse(
          await fsp.readFile(
            nodePath.join(fixture.destDir, GitSnapshotStateFileName),
            "utf8"
          )
        )
      ).toMatchObject({
        commit: JSON.parse(await fsp.readFile(fixture.lockPath, "utf8")).commit
      });
      expect(
        await fsp.readFile(
          nodePath.join(fixture.destDir, "catalog", "dataset.json"),
          "utf8"
        )
      ).toContain("fixture-dataset");
    } finally {
      await fsp.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("removes the destination tree when verification fails", async () => {
    const rootDir = await fsp.mkdtemp(
      nodePath.join(os.tmpdir(), "git-snapshot-fetch-fail-")
    );

    try {
      const fixture = await makeFixture(rootDir);
      const brokenLockPath = nodePath.join(rootDir, "broken.lock.json");
      const lockFile = JSON.parse(await fsp.readFile(fixture.lockPath, "utf8"));
      lockFile.manifestHash = "not-the-real-hash";
      await writeJson(brokenLockPath, lockFile);

      await fsp.mkdir(fixture.destDir, { recursive: true });
      await fsp.writeFile(
        nodePath.join(fixture.destDir, "stale.txt"),
        "stale contents\n",
        "utf8"
      );

      await expect(
        Effect.runPromise(
          fetchGitSnapshot({
            lockFile: brokenLockPath,
            destDir: fixture.destDir,
            requiredManifestFile: "manifest.json"
          }).pipe(Effect.provide(scriptPlatformLayer))
        )
      ).rejects.toMatchObject({
        _tag: "GitSnapshotFetchError",
        operation: "verify-manifest-hash"
      });

      await expect(fsp.access(fixture.destDir)).rejects.toBeDefined();
    } finally {
      await fsp.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("fails when the fetched tree does not match the manifest tree hash", async () => {
    const rootDir = await fsp.mkdtemp(
      nodePath.join(os.tmpdir(), "git-snapshot-fetch-treehash-")
    );

    try {
      const fixture = await makeFixture(rootDir, {
        mutateAfterManifest: true
      });

      await expect(
        Effect.runPromise(
          fetchGitSnapshot({
            lockFile: fixture.lockPath,
            destDir: fixture.destDir,
            requiredManifestFile: "manifest.json"
          }).pipe(Effect.provide(scriptPlatformLayer))
        )
      ).rejects.toMatchObject({
        _tag: "GitSnapshotFetchError",
        operation: "verify-tree-hash"
      });

      await expect(fsp.access(fixture.destDir)).rejects.toBeDefined();
    } finally {
      await fsp.rm(rootDir, { recursive: true, force: true });
    }
  });
});
