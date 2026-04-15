import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@skygest/ontology-store",
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
