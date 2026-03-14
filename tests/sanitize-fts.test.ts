import { describe, expect, test } from "vitest";
import { sanitizeFtsQuery } from "../src/query/sanitizeFts";

describe("sanitizeFtsQuery", () => {
  test("passes clean input through unchanged", () => {
    expect(sanitizeFtsQuery("solar energy")).toBe("solar energy");
  });

  test("strips FTS5 boolean operators", () => {
    expect(sanitizeFtsQuery("solar AND wind")).toBe("solar wind");
    expect(sanitizeFtsQuery("solar OR wind")).toBe("solar wind");
    expect(sanitizeFtsQuery("solar NOT wind")).toBe("solar wind");
  });

  test("strips NEAR operator", () => {
    expect(sanitizeFtsQuery("NEAR(solar wind)")).toBe("solar wind");
  });

  test("is case-insensitive for operators", () => {
    expect(sanitizeFtsQuery("solar and wind")).toBe("solar wind");
    expect(sanitizeFtsQuery("solar Or wind")).toBe("solar wind");
    expect(sanitizeFtsQuery("solar not wind")).toBe("solar wind");
  });

  test("strips double quotes", () => {
    expect(sanitizeFtsQuery('"solar panels"')).toBe("solar panels");
  });

  test("strips unbalanced quotes", () => {
    expect(sanitizeFtsQuery('solar "panels')).toBe("solar panels");
  });

  test("strips wildcard asterisks", () => {
    expect(sanitizeFtsQuery("solar*")).toBe("solar");
  });

  test("strips caret and colon (column weight) operator", () => {
    expect(sanitizeFtsQuery("title:^2 solar")).toBe("title 2 solar");
  });

  test("strips curly braces and brackets", () => {
    expect(sanitizeFtsQuery("{solar} [wind]")).toBe("solar wind");
  });

  test("strips parentheses", () => {
    expect(sanitizeFtsQuery("(solar OR wind)")).toBe("solar wind");
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

  test("strips colons to prevent FTS5 column prefix errors", () => {
    expect(sanitizeFtsQuery("title:solar")).toBe("title solar");
  });

  test("handles mixed special chars and operators", () => {
    expect(sanitizeFtsQuery('"solar" AND (wind OR "nuclear")')).toBe(
      "solar wind nuclear"
    );
  });
});
