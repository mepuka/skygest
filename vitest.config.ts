import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "root",
          environment: "node",
          include: ["tests/**/*.test.ts"]
        }
      },
      "./packages/*/vitest.config.ts"
    ]
  }
});
