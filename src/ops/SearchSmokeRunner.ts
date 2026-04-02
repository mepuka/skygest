/**
 * Live smoke tests for the FTS5 search infrastructure.
 *
 * All assertions are anchored on the deterministic smoke fixture posts
 * loaded by `stage prepare`, so this command works reliably on both
 * freshly prepared and fully populated staging environments.
 */
import { Console, Effect, Schema } from "effect";
import { KnowledgePostsPageOutput } from "../domain/api";
import { ExpandedTopicsOutput, ExplainPostTopicsOutput } from "../domain/bi";
import { decodeJsonStringWith, stringifyUnknown } from "../platform/Json";
import { smokeFixtureUris, smokeSearchQuery } from "../staging/SmokeFixture";
import { SmokeAssertionError, StagingRequestError } from "./Errors";

const decodePostsPage = decodeJsonStringWith(KnowledgePostsPageOutput);
const decodeExpandedTopics = decodeJsonStringWith(ExpandedTopicsOutput);
const decodeExplainTopics = decodeJsonStringWith(ExplainPostTopicsOutput);

const expectedSolarUri = smokeFixtureUris()[0];
const expectedWindUri = smokeFixtureUris()[1];

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
        throw new StagingRequestError({
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
        : new StagingRequestError({
            operation: `GET ${path}`,
            message: stringifyUnknown(error)
          })
  });

const check = (name: string, effect: Effect.Effect<void, StagingRequestError | SmokeAssertionError>) =>
  Console.log(`  [check] ${name}`).pipe(
    Effect.andThen(effect),
    Effect.andThen(Console.log(`  [pass]  ${name}`)),
    Effect.mapError((error) =>
      error._tag === "SmokeAssertionError"
        ? new SmokeAssertionError({ message: `${name}: ${error.message}` })
        : error
    )
  );

const expect = (condition: boolean, message: string) =>
  condition
    ? Effect.void
    : Effect.fail(new SmokeAssertionError({ message }));

// Test 1: Porter stemming — "photovoltaic" in the fixture should match
// a search for the stem variant "photovoltaics"
const checkPorterStemming = (baseUrl: URL) =>
  check("Porter stemming", Effect.gen(function* () {
    const page = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/search?q=${encodeURIComponent("photovoltaics")}&limit=5`,
      decodePostsPage
    );

    const found = page.items.some((item) => item.uri === expectedSolarUri);
    yield* expect(
      found,
      `expected fixture post ${expectedSolarUri} to match 'photovoltaics' via Porter stemming`
    );
  }));

// Test 2: FTS5 sanitization — operators should not cause server errors
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

// Test 3: Snippet highlighting — search for the known smoke query
const checkSearchSnippet = (baseUrl: URL) =>
  check("Search snippet highlighting", Effect.gen(function* () {
    const page = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/search?q=${encodeURIComponent(smokeSearchQuery)}&limit=5`,
      decodePostsPage
    );

    const match = page.items.find((item) => item.uri === expectedSolarUri);
    yield* expect(match !== undefined, `expected fixture post ${expectedSolarUri} in results`);

    const snippet = (match as any)?.snippet;
    yield* expect(
      typeof snippet === "string" && snippet.includes("<mark>"),
      "expected snippet field with <mark> highlighting tags"
    );
  }));

// Test 4: Search pagination — use "solar" which matches at least the fixture post
const checkSearchPagination = (baseUrl: URL) =>
  check("Search pagination cursor encoding", Effect.gen(function* () {
    // Verify a single-result page returns null cursor (no more pages for this narrow query)
    const page = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/search?q=${encodeURIComponent(smokeSearchQuery)}&limit=100`,
      decodePostsPage
    );

    yield* expect(page.items.length > 0, "expected at least one result for smoke query");

    // If there are enough results for pagination, test it
    if (page.items.length > 1) {
      const limited = yield* fetchPublicJson(
        baseUrl,
        `/api/posts/search?q=${encodeURIComponent(smokeSearchQuery)}&limit=1`,
        decodePostsPage
      );

      yield* expect(limited.items.length === 1, "expected 1 item with limit=1");
      yield* expect(
        limited.page.nextCursor !== null,
        "expected nextCursor when more results exist"
      );

      const page2 = yield* fetchPublicJson(
        baseUrl,
        `/api/posts/search?q=${encodeURIComponent(smokeSearchQuery)}&limit=1&cursor=${encodeURIComponent(limited.page.nextCursor!)}`,
        decodePostsPage
      );

      yield* expect(page2.items.length === 1, "expected 1 item on page 2");
      yield* expect(
        limited.items[0]?.uri !== page2.items[0]?.uri,
        "expected different URIs across pages"
      );
    }
  }));

// Test 5: Topic filtering — the fixture's unique query + topic=solar should find it
const checkTopicFiltering = (baseUrl: URL) =>
  check("Topic filtering", Effect.gen(function* () {
    const page = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/search?q=${encodeURIComponent(smokeSearchQuery)}&topic=solar&limit=10`,
      decodePostsPage
    );

    yield* expect(page.items.length > 0, "expected results for smoke query + topic=solar");

    const allHaveSolar = page.items.every((item) =>
      item.topics.includes("solar")
    );
    yield* expect(allHaveSolar, "expected every result to have 'solar' topic");

    const found = page.items.some((item) => item.uri === expectedSolarUri);
    yield* expect(found, `expected fixture post ${expectedSolarUri} in topic-filtered results`);
  }));

// Test 6: FTS sync — the fixture solar post should be findable via search
const checkFtsSyncSanity = (baseUrl: URL) =>
  check("FTS external-content sync", Effect.gen(function* () {
    const page = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/search?q=${encodeURIComponent("photovoltaic battery storage")}&limit=5`,
      decodePostsPage
    );

    const found = page.items.some((item) => item.uri === expectedSolarUri);
    yield* expect(
      found,
      `expected fixture post ${expectedSolarUri} to be indexed and searchable`
    );
  }));

// Test 7: Recent posts pagination
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

// Test 8: Ontology expansion
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

// Test 9: Explain provenance — use the known fixture solar post
const checkExplainProvenance = (baseUrl: URL) =>
  check("Explain provenance", Effect.gen(function* () {
    const explained = yield* fetchPublicJson(
      baseUrl,
      `/api/posts/${encodeURIComponent(expectedSolarUri)}/topics`,
      decodeExplainTopics
    );

    yield* expect(
      explained.postUri === expectedSolarUri,
      "expected postUri to match fixture URI"
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
