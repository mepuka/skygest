import { it, expect } from "bun:test";
import { fetch } from "./feed";

it("exports fetch", () => {
  expect(fetch).toBeDefined();
});
