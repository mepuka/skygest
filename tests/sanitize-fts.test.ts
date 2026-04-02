import { describe, expect, test } from "vitest";
import { sanitizeFtsQuery } from "../src/query/sanitizeFts";

describe("sanitizeFtsQuery", () => {
  test("passes clean input through unchanged", () => {
    expect(sanitizeFtsQuery("solar energy")).toBe("solar energy");
  });

  test("preserves boolean operators", () => {
    expect(sanitizeFtsQuery("solar AND wind")).toBe("solar AND wind");
    expect(sanitizeFtsQuery("solar OR wind")).toBe("solar OR wind");
    expect(sanitizeFtsQuery("solar NOT wind")).toBe("solar NOT wind");
  });

  test("canonicalizes lowercase boolean operators", () => {
    expect(sanitizeFtsQuery("solar and wind")).toBe("solar AND wind");
    expect(sanitizeFtsQuery("solar or wind")).toBe("solar OR wind");
    expect(sanitizeFtsQuery("solar not wind")).toBe("solar NOT wind");
  });

  test("accepts common 'AND NOT' syntax and normalizes it", () => {
    expect(sanitizeFtsQuery("solar AND NOT wind")).toBe("solar NOT wind");
  });

  test("preserves phrase queries", () => {
    expect(sanitizeFtsQuery('"solar panels"')).toBe('"solar panels"');
  });

  test("falls back safely for unbalanced quotes", () => {
    expect(sanitizeFtsQuery('solar "panels')).toBe("solar panels");
  });

  test("preserves wildcard prefixes", () => {
    expect(sanitizeFtsQuery("solar*")).toBe("solar*");
  });

  test("preserves NEAR groups", () => {
    expect(sanitizeFtsQuery("NEAR(solar wind, 5)")).toBe("NEAR(solar wind, 5)");
  });

  test("preserves parentheses around boolean expressions", () => {
    expect(sanitizeFtsQuery("(solar OR wind)")).toBe("(solar OR wind)");
  });

  test("strips unsupported column and weighting syntax", () => {
    expect(sanitizeFtsQuery("title:^2 solar")).toBe("title 2 solar");
    expect(sanitizeFtsQuery("title:solar")).toBe("title solar");
  });

  test("treats plain handle-like queries as exact phrases", () => {
    expect(sanitizeFtsQuery("ferc-watch.bsky.social")).toBe("\"ferc watch bsky social\"");
    expect(sanitizeFtsQuery("@gridwonk.bsky.social")).toBe("\"gridwonk bsky social\"");
  });

  test("normalizes non-handle punctuation into token separators", () => {
    expect(sanitizeFtsQuery("{solar} [wind]")).toBe("solar wind");
  });

  test("collapses multiple spaces", () => {
    expect(sanitizeFtsQuery("solar   energy   wind")).toBe("solar energy wind");
  });

  test("trims leading and trailing whitespace", () => {
    expect(sanitizeFtsQuery("  solar energy  ")).toBe("solar energy");
  });

  test("returns empty string for empty input", () => {
    expect(sanitizeFtsQuery("")).toBe("");
  });

  test("returns empty string for whitespace-only input", () => {
    expect(sanitizeFtsQuery("   ")).toBe("");
  });

  test("returns empty string when only operators remain", () => {
    expect(sanitizeFtsQuery("AND OR NOT")).toBe("");
  });

  test("falls back to plain terms when syntax is malformed", () => {
    expect(sanitizeFtsQuery("(solar OR wind")).toBe("solar wind");
    expect(sanitizeFtsQuery("NEAR(solar, foo)")).toBe("solar foo");
    expect(sanitizeFtsQuery("solar OR")).toBe("solar");
    expect(sanitizeFtsQuery("solar AND")).toBe("solar");
    expect(sanitizeFtsQuery("solar NOT")).toBe("solar");
  });

  test("handles mixed special chars and operators", () => {
    expect(sanitizeFtsQuery('"solar" AND (wind OR "nuclear")')).toBe(
      "solar AND (wind OR nuclear)"
    );
  });
});
