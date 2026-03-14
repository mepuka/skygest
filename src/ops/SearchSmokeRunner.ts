/**
 * Live smoke tests for the FTS5 search infrastructure.
 *
 * Runs read-only HTTP requests against a deployed staging environment
 * to verify search, pagination, snippets, stemming, and ontology integration.
 */
import { Console, Effect, Schema } from "effect";
import { KnowledgePostsPageOutput } from "../domain/api";
import { ExpandedTopicsOutput, ExplainPostTopicsOutput } from "../domain/bi";
import { decodeJsonStringWith, stringifyUnknown } from "../platform/Json";
import { SmokeAssertionError, StagingRequestError } from "./Errors";

const decodePostsPage = decodeJsonStringWith(KnowledgePostsPageOutput);
const decodeExpandedTopics = decodeJsonStringWith(ExpandedTopicsOutput);
const decodeExplainTopics = decodeJsonStringWith(ExplainPostTopicsOutput);

const fetchPublicJson = <A>(
  baseUrl: URL,
  path: string,
  decode: (text: string) => A
) =>
  Effect.tryPromise({
    try: async () => {
      const url = new URL(path, baseUrl);
      const response = await fetch(url);
      const text = await response.text();

      if (!response.ok) {
        throw StagingRequestError.make({
          operation: `GET ${path}`,
          status: response.status,
          message: text || response.statusText
        });
      }

      return decode(text);
    },
    catch: (error) =>
      error instanceof StagingRequestError
        ? error
        : StagingRequestError.make({
            operation: `GET ${path}`,
            message: stringifyUnknown(error)
          })
  });

const check = (name: string, effect: Effect.Effect<void, StagingRequestError | SmokeAssertionError>) =>
  Console.log(`  [check] ${name}`).pipe(
    Effect.zipRight(effect),
    Effect.zipRight(Console.log(`  [pass]  ${name}`)),
    Effect.mapError((error) =>
      error._tag === "SmokeAssertionError"
        ? SmokeAssertionError.make({ message: `${name}: ${error.message}` })
        : error
    )
  );

const expect = (condition: boolean, message: string) =>
  condition
    ? Effect.void
    : Effect.fail(SmokeAssertionError.make({ message }));

const checkPorterStemming = (baseUrl: URL) =>
  check("Porter stemming", Effect.gen(function* () {
    const page = yield* fetchPublicJson(
      baseUrl,
      "/api/posts/search?q=generating&limit=5",
      decodePostsPage
    );

    yield* expect(
      page.items.length > 0,
      "expected 'generating' to match posts via Porter stemming (generation/generate/etc)"
    );
  }));

const checkFtsSanitization = (baseUrl: URL) =>
  check("FTS5 sanitization", Effect.gen(function* () {
    const page = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/search?q=${encodeURIComponent("solar AND NOT wind")}&limit=5`,
      decodePostsPage
    );

    yield* expect(
      Array.isArray(page.items),
      "expected FTS5 operators to be stripped without causing a server error"
    );
  }));

const checkSearchSnippet = (baseUrl: URL) =>
  check("Search snippet highlighting", Effect.gen(function* () {
    const page = yield* fetchPublicJson(
      baseUrl,
      "/api/posts/search?q=solar&limit=3",
      decodePostsPage
    );

    yield* expect(page.items.length > 0, "expected search results for 'solar'");

    const first = page.items[0] as any;
    yield* expect(
      typeof first.snippet === "string" && first.snippet.includes("<mark>"),
      "expected snippet field with <mark> highlighting tags"
    );
  }));

const checkSearchPagination = (baseUrl: URL) =>
  check("Search pagination", Effect.gen(function* () {
    const firstPage = yield* fetchPublicJson(
      baseUrl,
      "/api/posts/search?q=energy&limit=1",
      decodePostsPage
    );

    yield* expect(firstPage.items.length === 1, "expected exactly 1 item with limit=1");
    yield* expect(
      firstPage.page.nextCursor !== null,
      "expected nextCursor for 'energy' search (should have many results)"
    );

    const secondPage = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/search?q=energy&limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor!)}`,
      decodePostsPage
    );

    yield* expect(secondPage.items.length === 1, "expected 1 item on page 2");
    yield* expect(
      firstPage.items[0]?.uri !== secondPage.items[0]?.uri,
      "expected different URIs across pages"
    );
  }));

const checkTopicFiltering = (baseUrl: URL) =>
  check("Topic filtering", Effect.gen(function* () {
    const page = yield* fetchPublicJson(
      baseUrl,
      "/api/posts/search?q=energy&topic=solar&limit=5",
      decodePostsPage
    );

    yield* expect(page.items.length > 0, "expected results for energy+solar");

    const allHaveSolar = page.items.every((item) =>
      item.topics.includes("solar")
    );
    yield* expect(allHaveSolar, "expected every result to have 'solar' topic");
  }));

const checkFtsSyncSanity = (baseUrl: URL) =>
  check("FTS external-content sync", Effect.gen(function* () {
    const recent = yield* fetchPublicJson(
      baseUrl,
      "/api/posts/recent?limit=1",
      decodePostsPage
    );

    yield* expect(recent.items.length > 0, "expected at least one recent post");

    const recentPost = recent.items[0]!;
    const words = recentPost.text
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 3);

    if (words.length === 0) {
      return;
    }

    const searchPage = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/search?q=${encodeURIComponent(words.join(" "))}&limit=5`,
      decodePostsPage
    );

    const found = searchPage.items.some((item) => item.uri === recentPost.uri);
    yield* expect(
      found,
      `expected recent post ${recentPost.uri} to appear in FTS results for "${words.join(" ")}"`
    );
  }));

const checkRecentPostsPagination = (baseUrl: URL) =>
  check("Recent posts pagination", Effect.gen(function* () {
    const firstPage = yield* fetchPublicJson(
      baseUrl,
      "/api/posts/recent?limit=1",
      decodePostsPage
    );

    yield* expect(firstPage.items.length === 1, "expected 1 recent post");
    yield* expect(
      firstPage.page.nextCursor !== null,
      "expected nextCursor for recent posts"
    );

    const secondPage = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/recent?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor!)}`,
      decodePostsPage
    );

    yield* expect(secondPage.items.length === 1, "expected 1 item on page 2");
    yield* expect(
      firstPage.items[0]?.uri !== secondPage.items[0]?.uri,
      "expected different URIs across pages"
    );
  }));

const checkOntologyExpansion = (baseUrl: URL) =>
  check("Ontology expansion", Effect.gen(function* () {
    const expanded = yield* fetchPublicJson(
      baseUrl,
      "/api/topics/solar/expand?mode=descendants",
      decodeExpandedTopics
    );

    yield* expect(expanded.mode === "descendants", "expected mode=descendants");
    yield* expect(
      expanded.canonicalTopicSlugs.length > 0,
      "expected at least one canonical topic slug"
    );
    yield* expect(
      (expanded.canonicalTopicSlugs as ReadonlyArray<string>).includes("solar"),
      "expected 'solar' in canonical topic slugs"
    );
  }));

const checkExplainProvenance = (baseUrl: URL) =>
  check("Explain provenance", Effect.gen(function* () {
    const page = yield* fetchPublicJson(
      baseUrl,
      "/api/posts/search?q=solar&limit=1",
      decodePostsPage
    );

    yield* expect(page.items.length > 0, "expected a search result to explain");

    const uri = page.items[0]!.uri;
    const explained = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/${encodeURIComponent(uri)}/topics`,
      decodeExplainTopics
    );

    yield* expect(explained.items.length > 0, "expected at least one topic match");

    const first = explained.items[0]!;
    yield* expect(
      ["term", "hashtag", "domain"].includes(first.matchSignal),
      `expected matchSignal to be term|hashtag|domain, got: ${first.matchSignal}`
    );
    yield* expect(
      first.ontologyVersion.length > 0,
      "expected non-empty ontologyVersion"
    );
  }));

export const runSearchSmokeChecks = (baseUrl: URL) =>
  Effect.gen(function* () {
    yield* Console.log("Running search infrastructure smoke checks...");

    yield* checkPorterStemming(baseUrl);
    yield* checkFtsSanitization(baseUrl);
    yield* checkSearchSnippet(baseUrl);
    yield* checkSearchPagination(baseUrl);
    yield* checkTopicFiltering(baseUrl);
    yield* checkFtsSyncSanity(baseUrl);
    yield* checkRecentPostsPagination(baseUrl);
    yield* checkOntologyExpansion(baseUrl);
    yield* checkExplainProvenance(baseUrl);

    yield* Console.log("All search smoke checks passed");
  });
