import { describe, expect, it } from "@effect/vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const checkedPaths = [
  ".github/workflows",
  "alchemy.run.ts",
  "docs/architecture",
  "package.json",
  "packages",
  "scripts",
  "src",
  "worker-configuration.d.ts",
  "wrangler.agent.toml"
] as const;

const forbiddenPatterns = [
  "SEARCH_DB",
  "entity_search_docs",
  "EntitySearchRepo",
  "EntitySearchService",
  "EntitySemanticRecall",
  "entitySearchSqlLayer",
  "WranglerD1",
  "SearchDbScriptKeys",
  "SearchDbScriptError",
  "SEARCH_SOURCE_DB_NAME",
  "SEARCH_TARGET_DB_NAME",
  "migrate-search-db",
  "rebuild-search-db",
  "rebuild-entity-search-index",
  "EntityTypeNotEnabledError",
  "searchSignals",
  "src/search"
] as const;

const removedPaths = [
  "src/search",
  "src/services/EntitySearchService.ts",
  "src/services/EntitySearchRepo.ts",
  "src/services/EntitySemanticRecall.ts",
  "src/services/d1/EntitySearchRepoD1.ts",
  "src/platform/WranglerD1.ts",
  "scripts/migrate-search-db.ts",
  "scripts/rebuild-search-db.ts",
  "scripts/rebuild-entity-search-index.ts"
] as const;

const textExtensions = new Set([
  ".json",
  ".md",
  ".toml",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml"
]);

const isTextFile = (path: string) =>
  [...textExtensions].some((extension) => path.endsWith(extension));

const collectFiles = (path: string): ReadonlyArray<string> => {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return isTextFile(path) ? [path] : [];
  return readdirSync(path).flatMap((entry) => {
    if (entry === "node_modules" || entry === ".git" || entry === "analysis") {
      return [];
    }
    return collectFiles(join(path, entry));
  });
};

describe("entity search cutover", () => {
  it("removes the local search database files structurally", () => {
    for (const path of removedPaths) {
      expect(existsSync(join(repoRoot, path))).toBe(false);
    }
  });

  it("keeps the deleted local search database stack out of runtime code and deploy config", () => {
    const files = checkedPaths.flatMap((path) => collectFiles(join(repoRoot, path)));
    const matches = files.flatMap((file) => {
      const content = readFileSync(file, "utf8");
      return forbiddenPatterns
        .filter((pattern) => content.includes(pattern))
        .map((pattern) => `${file.slice(repoRoot.length)}: ${pattern}`);
    });

    expect(matches).toEqual([]);
  });
});
