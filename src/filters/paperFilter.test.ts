import { describe, it, expect } from "bun:test";
import { containsPaperLink, buildSearchText } from "./paperFilter";

describe("paperFilter", () => {
  it("detects arxiv links", () => {
    const record = { text: "see https://arxiv.org/abs/2401.00001" };
    const searchText = buildSearchText(record as any);
    expect(containsPaperLink(searchText)).toBe(true);
  });
});
