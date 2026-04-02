/**
 * Normalize user input into a valid SQLite FTS5 query string.
 *
 * The old implementation stripped almost all FTS syntax, which meant
 * phrase search, boolean operators, and prefix search never reached
 * SQLite. This parser keeps the safe, useful subset and falls back to a
 * plain term intersection when the input is malformed.
 */

import { normalizeWord } from "../ontology/normalize";

type Token =
  | { readonly type: "TERM"; readonly value: string }
  | { readonly type: "PHRASE"; readonly value: string }
  | { readonly type: "AND" | "OR" | "NOT" | "NEAR" | "LPAREN" | "RPAREN" | "COMMA" | "STAR" };

type QueryNode =
  | { readonly kind: "term"; readonly value: string; readonly prefix: boolean }
  | { readonly kind: "sequence"; readonly items: ReadonlyArray<QueryNode> }
  | { readonly kind: "and" | "or" | "not"; readonly left: QueryNode; readonly right: QueryNode }
  | { readonly kind: "group"; readonly value: QueryNode }
  | { readonly kind: "near"; readonly items: ReadonlyArray<QueryNode>; readonly distance: number | null };

const WORD_CHAR = /[\p{L}\p{N}_]/u;

const isWordChar = (value: string) => WORD_CHAR.test(value);

const normalizeTerms = (value: string) =>
  normalizeWord(value)
    .split(" ")
    .filter((term) => term.length > 0);

const fallbackQuery = (raw: string) =>
  normalizeTerms(raw).join(" ");

const pushNormalizedText = (tokens: Array<Token>, value: string) => {
  const terms = normalizeTerms(value);
  if (terms.length === 0) {
    return;
  }

  if (terms.length === 1) {
    tokens.push({ type: "TERM", value: terms[0]! });
    return;
  }

  tokens.push({ type: "PHRASE", value: terms.join(" ") });
};

const lex = (raw: string): ReadonlyArray<Token> => {
  const tokens: Array<Token> = [];
  let index = 0;

  while (index < raw.length) {
    const char = raw[index]!;

    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (char === "\"") {
      index += 1;
      let value = "";

      while (index < raw.length) {
        const current = raw[index]!;
        if (current === "\"") {
          if (raw[index + 1] === "\"") {
            value += "\"";
            index += 2;
            continue;
          }

          index += 1;
          break;
        }

        value += current;
        index += 1;
      }

      pushNormalizedText(tokens, value);
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "LPAREN" });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "RPAREN" });
      index += 1;
      continue;
    }

    if (char === ",") {
      tokens.push({ type: "COMMA" });
      index += 1;
      continue;
    }

    if (char === "*") {
      tokens.push({ type: "STAR" });
      index += 1;
      continue;
    }

    if (isWordChar(char)) {
      let value = char;
      index += 1;

      while (index < raw.length && isWordChar(raw[index]!)) {
        value += raw[index]!;
        index += 1;
      }

      const normalized = normalizeTerms(value);
      if (normalized.length === 0) {
        continue;
      }

      const term = normalized[0]!;
      const upper = term.toUpperCase();

      if (upper === "AND" || upper === "OR" || upper === "NOT" || upper === "NEAR") {
        tokens.push({ type: upper });
        continue;
      }

      tokens.push({ type: "TERM", value: term });
      continue;
    }

    // Treat punctuation such as '-', '.', ':', '^', '{', '}' and '[' as
    // separators. FTS's tokenizer will split them anyway, so we normalize
    // them into whitespace at parse time.
    index += 1;
  }

  return tokens;
};

const isSequenceStart = (token: Token | undefined) =>
  token?.type === "TERM" || token?.type === "PHRASE" || token?.type === "NEAR";

const precedence = (node: QueryNode): number => {
  switch (node.kind) {
    case "term":
    case "near":
      return 5;
    case "group":
      return 4;
    case "sequence":
      return 3;
    case "not":
      return 2;
    case "and":
      return 1;
    case "or":
      return 0;
  }
};

const escapePhrase = (value: string) =>
  value.replaceAll("\"", "\"\"");

class Parser {
  private index = 0;

  constructor(private readonly tokens: ReadonlyArray<Token>) {}

  parse(): QueryNode {
    const node = this.parseOr();
    if (this.peek() !== undefined) {
      throw new Error("Unexpected trailing tokens");
    }
    return node;
  }

  private peek(offset = 0) {
    return this.tokens[this.index + offset];
  }

  private consume<T extends Token["type"]>(type: T): Extract<Token, { readonly type: T }> {
    const token = this.peek();
    if (token?.type !== type) {
      throw new Error(`Expected ${type}`);
    }
    this.index += 1;
    return token as Extract<Token, { readonly type: T }>;
  }

  private parseOr(): QueryNode {
    let left = this.parseAnd();

    while (this.peek()?.type === "OR") {
      this.consume("OR");
      left = { kind: "or", left, right: this.parseAnd() };
    }

    return left;
  }

  private parseAnd(): QueryNode {
    let left = this.parseNot();

    while (this.peek()?.type === "AND") {
      this.consume("AND");

      if (this.peek()?.type === "NOT") {
        this.consume("NOT");
        left = { kind: "not", left, right: this.parseSequence() };
        continue;
      }

      left = { kind: "and", left, right: this.parseNot() };
    }

    return left;
  }

  private parseNot(): QueryNode {
    let left = this.parseSequence();

    while (this.peek()?.type === "NOT") {
      this.consume("NOT");
      left = { kind: "not", left, right: this.parseSequence() };
    }

    return left;
  }

  private parseSequence(): QueryNode {
    const first = this.parseUnit();
    if (first.kind === "group") {
      return first;
    }

    const items: Array<QueryNode> = [first];
    while (isSequenceStart(this.peek())) {
      items.push(this.parseUnit());
    }

    return items.length === 1 ? first : { kind: "sequence", items };
  }

  private parseUnit(): QueryNode {
    const token = this.peek();
    if (token === undefined) {
      throw new Error("Unexpected end of input");
    }

    if (token.type === "LPAREN") {
      this.consume("LPAREN");
      const value = this.parseOr();
      this.consume("RPAREN");
      return { kind: "group", value };
    }

    if (token.type === "NEAR") {
      return this.parseNear();
    }

    if (token.type !== "TERM" && token.type !== "PHRASE") {
      throw new Error(`Unexpected token ${token.type}`);
    }

    this.index += 1;
    const prefix = this.peek()?.type === "STAR";
    if (prefix) {
      this.consume("STAR");
    }

    return {
      kind: "term",
      value: token.value,
      prefix
    };
  }

  private parseNear(): QueryNode {
    this.consume("NEAR");
    this.consume("LPAREN");

    const items: Array<QueryNode> = [];
    items.push(this.parseNearTerm());
    items.push(this.parseNearTerm());

    while (isSequenceStart(this.peek())) {
      items.push(this.parseNearTerm());
    }

    let distance: number | null = null;
    if (this.peek()?.type === "COMMA") {
      this.consume("COMMA");
      const token = this.consume("TERM");
      if (!/^\d+$/u.test(token.value)) {
        throw new Error("NEAR distance must be numeric");
      }
      distance = Number(token.value);
    }

    this.consume("RPAREN");
    return { kind: "near", items, distance };
  }

  private parseNearTerm(): QueryNode {
    const node = this.parseUnit();
    if (node.kind === "group") {
      throw new Error("NEAR terms cannot be grouped expressions");
    }
    return node;
  }
}

const serialize = (node: QueryNode, parentPrecedence = -1): string => {
  const current = (() => {
    switch (node.kind) {
      case "term": {
        const base = node.value.includes(" ")
          ? `"${escapePhrase(node.value)}"`
          : node.value;

        if (!node.prefix) {
          return base;
        }

        return node.value.includes(" ")
          ? `${base} *`
          : `${base}*`;
      }
      case "sequence":
        return node.items.map((item) => serialize(item, precedence(node))).join(" ");
      case "group":
        return `(${serialize(node.value)})`;
      case "near":
        return `NEAR(${node.items.map((item) => serialize(item, precedence(node))).join(" ")}${
          node.distance === null ? "" : `, ${String(node.distance)}`
        })`;
      case "not":
        return `${serialize(node.left, precedence(node))} NOT ${serialize(node.right, precedence(node))}`;
      case "and":
        return `${serialize(node.left, precedence(node))} AND ${serialize(node.right, precedence(node))}`;
      case "or":
        return `${serialize(node.left, precedence(node))} OR ${serialize(node.right, precedence(node))}`;
    }
  })();

  return precedence(node) < parentPrecedence
    ? `(${current})`
    : current;
};

export const sanitizeFtsQuery = (raw: string): string => {
  const tokens = lex(raw);
  if (tokens.length === 0) {
    return "";
  }

  if (!tokens.some((token) => token.type === "TERM" || token.type === "PHRASE")) {
    return "";
  }

  try {
    return serialize(new Parser(tokens).parse());
  } catch {
    return fallbackQuery(raw);
  }
};
