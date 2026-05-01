import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  Post,
  PostUnifiedProjection,
  postFromTriples,
  postIriFromAtUri,
  postTimeBucket,
  postToTriples
} from "../../src/content/post";

const samplePost = (): Post =>
  Schema.decodeUnknownSync(Post)({
    iri: "https://w3id.org/energy-intel/post/did_plc_abc_3kgvexample",
    did: "did:plc:abc",
    atUri: "at://did:plc:abc/app.bsky.feed.post/3kgvexample",
    text: "First post about grid stability under high renewables.",
    postedAt: 1715000000000,
    authoredBy: "https://w3id.org/energy-intel/expert/MarkZJacobson"
  });

describe("Post", () => {
  describe("postIriFromAtUri", () => {
    it("derives a Post IRI from a well-formed at:// URI", () => {
      const iri = postIriFromAtUri(
        "at://did:plc:abc/app.bsky.feed.post/3kgvexample"
      );
      expect(iri).toBe(
        "https://w3id.org/energy-intel/post/did_plc_abc_3kgvexample"
      );
    });

    it("rejects malformed at:// URIs", () => {
      expect(() => postIriFromAtUri("not-an-at-uri")).toThrow(/Invalid at/);
    });
  });

  describe("postTimeBucket", () => {
    it("buckets a millisecond timestamp to YYYY-MM in UTC", () => {
      // 2024-05-06T14:13:20.000Z
      expect(postTimeBucket(1715000000000)).toBe("2024-05-06"
        .slice(0, 7));
    });

    it("zero-pads single-digit months", () => {
      // 2024-01-15T00:00:00.000Z
      const date = Date.UTC(2024, 0, 15);
      expect(postTimeBucket(date)).toBe("2024-01");
    });
  });

  describe("PostUnifiedProjection", () => {
    it("toKey produces entities/post/<iri-suffix>.md", () => {
      expect(PostUnifiedProjection.toKey(samplePost())).toBe(
        "entities/post/did_plc_abc_3kgvexample.md"
      );
    });

    it("toMetadata returns the unified 5 keys with correct values", () => {
      const meta = PostUnifiedProjection.toMetadata(samplePost());
      expect(Object.keys(meta).sort()).toEqual([
        "authority",
        "entity_type",
        "iri",
        "time_bucket",
        "topic"
      ]);
      expect(meta.entity_type).toBe("Post");
      expect(meta.iri).toBe(
        "https://w3id.org/energy-intel/post/did_plc_abc_3kgvexample"
      );
      expect(meta.topic).toBe("unknown");
      expect(meta.authority).toBe("unknown");
      expect(meta.time_bucket).toMatch(/^\d{4}-\d{2}$/);
    });

    it("toBody includes text, did, at_uri, and authored_by", () => {
      const body = PostUnifiedProjection.toBody(samplePost());
      expect(body).toContain("did:plc:abc");
      expect(body).toContain("at://did:plc:abc/app.bsky.feed.post/3kgvexample");
      expect(body).toContain("First post about grid stability");
      expect(body).toContain(
        "https://w3id.org/energy-intel/expert/MarkZJacobson"
      );
    });

    it("toBody omits authored_by when absent", () => {
      const post = Schema.decodeUnknownSync(Post)({
        iri: "https://w3id.org/energy-intel/post/did_plc_xyz_anonpost",
        did: "did:plc:xyz",
        atUri: "at://did:plc:xyz/app.bsky.feed.post/anonpost",
        text: "Anon post.",
        postedAt: 1715000000000
      });
      const body = PostUnifiedProjection.toBody(post);
      expect(body).not.toContain("authored_by:");
    });
  });

  describe("postToTriples / postFromTriples", () => {
    it("emits a typed triple plus content triples", () => {
      const triples = postToTriples(samplePost());
      const types = triples.filter(
        (t) =>
          t.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
      );
      expect(types).toHaveLength(1);
      expect(types[0]?.object.value).toBe("https://w3id.org/energy-intel/Post");

      const authoredBy = triples.filter(
        (t) =>
          t.predicate.value === "https://w3id.org/energy-intel/authoredBy"
      );
      expect(authoredBy).toHaveLength(1);
    });

    it.effect("fromTriples round-trips an emitted post", () =>
      Effect.gen(function* () {
        const original = samplePost();
        const triples = postToTriples(original);
        const distilled = yield* postFromTriples(triples, original.iri);
        expect(distilled.iri).toBe(original.iri);
        expect(distilled.did).toBe(original.did);
        expect(distilled.atUri).toBe(original.atUri);
        expect(distilled.text).toBe(original.text);
        expect(distilled.postedAt).toBe(original.postedAt);
        expect(distilled.authoredBy).toBe(original.authoredBy);
      })
    );

    it.effect("fromTriples round-trips a post without authoredBy", () =>
      Effect.gen(function* () {
        const original = Schema.decodeUnknownSync(Post)({
          iri: "https://w3id.org/energy-intel/post/did_plc_xyz_anonpost",
          did: "did:plc:xyz",
          atUri: "at://did:plc:xyz/app.bsky.feed.post/anonpost",
          text: "Anon post.",
          postedAt: 1715000000000
        });
        const triples = postToTriples(original);
        const distilled = yield* postFromTriples(triples, original.iri);
        expect(distilled.authoredBy).toBeUndefined();
      })
    );

    it.effect("fromTriples raises when required fields are missing", () =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(
          postFromTriples([], "https://w3id.org/energy-intel/post/empty")
        );
        expect(result._tag).toBe("Failure");
      })
    );
  });
});
