import { it, expect, mock } from "bun:test";

it("exports fetch", async () => {
  mock.module("cloudflare:workers", () => ({
    DurableObject: class {}
  }));

  const mod = await import("./feed");
  expect(mod.fetch).toBeDefined();
});
