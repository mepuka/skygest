/**
 * Minimal Doc pretty-printer shim.
 *
 * Replaces `@effect/printer/Doc` which was removed in Effect 4.
 * Implements only the subset used by ThreadPrinter and Fmt:
 *   Doc<A>, text, empty, hardLine, hsep, vsep, nest, indent, render
 */

// ---------------------------------------------------------------------------
// Core type
// ---------------------------------------------------------------------------

export interface Doc<out _A> {
  readonly _tag: string;
}

interface TextDoc extends Doc<never> {
  readonly _tag: "Text";
  readonly value: string;
}

interface EmptyDoc extends Doc<never> {
  readonly _tag: "Empty";
}

interface HardLineDoc extends Doc<never> {
  readonly _tag: "HardLine";
}

interface CatDoc<A> extends Doc<A> {
  readonly _tag: "Cat";
  readonly left: Doc<A>;
  readonly right: Doc<A>;
}

interface NestDoc<A> extends Doc<A> {
  readonly _tag: "Nest";
  readonly doc: Doc<A>;
  readonly indent: number;
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const text = (value: string): Doc<never> => ({ _tag: "Text", value }) as TextDoc;

export const empty: Doc<never> = { _tag: "Empty" } as EmptyDoc;

export const hardLine: Doc<never> = { _tag: "HardLine" } as HardLineDoc;

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

const cat = <A>(left: Doc<A>, right: Doc<A>): Doc<A> =>
  ({ _tag: "Cat", left, right }) as CatDoc<A>;

/** Horizontal separator (space-separated) */
export const hsep = <A>(docs: ReadonlyArray<Doc<A>>): Doc<A> => {
  const filtered = docs.filter((d) => d._tag !== "Empty");
  if (filtered.length === 0) return empty as Doc<A>;
  // biome-ignore lint/style/noNonNullAssertion: length checked
  let result: Doc<A> = filtered[0]!;
  for (let i = 1; i < filtered.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounds checked
    result = cat(cat(result, text(" ") as Doc<A>), filtered[i]!);
  }
  return result;
};

/** Vertical separator (newline-separated) */
export const vsep = <A>(docs: ReadonlyArray<Doc<A>>): Doc<A> => {
  const filtered = docs.filter((d) => d._tag !== "Empty");
  if (filtered.length === 0) return empty as Doc<A>;
  // biome-ignore lint/style/noNonNullAssertion: length checked
  let result: Doc<A> = filtered[0]!;
  for (let i = 1; i < filtered.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounds checked
    result = cat(cat(result, hardLine as Doc<A>), filtered[i]!);
  }
  return result;
};

/** Nest (indent subsequent lines) */
export const nest = <A>(doc: Doc<A>, indent: number): Doc<A> =>
  ({ _tag: "Nest", doc, indent }) as NestDoc<A>;

/** Indent (indent all lines including first) */
export const indent = <A>(doc: Doc<A>, amount: number): Doc<A> =>
  cat(text(" ".repeat(amount)) as Doc<A>, nest(doc, amount));

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const renderDoc = <A>(doc: Doc<A>, currentIndent: number): string => {
  switch (doc._tag) {
    case "Text":
      return (doc as TextDoc).value;
    case "Empty":
      return "";
    case "HardLine":
      return "\n" + " ".repeat(currentIndent);
    case "Cat": {
      const c = doc as CatDoc<A>;
      return renderDoc(c.left, currentIndent) + renderDoc(c.right, currentIndent);
    }
    case "Nest": {
      const n = doc as NestDoc<A>;
      return renderDoc(n.doc, currentIndent + n.indent);
    }
    default:
      return "";
  }
};

/**
 * Render a Doc to a string.
 *
 * The `options` parameter is accepted for API compatibility with
 * `@effect/printer` but currently ignored (always compact).
 */
export const render = <A>(
  doc: Doc<A>,
  _options?: { readonly style?: string }
): string => renderDoc(doc, 0);
