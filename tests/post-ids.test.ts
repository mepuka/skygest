import fc from "fast-check";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { parseFeedImageUrl } from "../src/bluesky/BskyCdn";
import {
  ChartAssetId,
  PostSkygestUri,
  chartAssetIdFromBluesky,
  decodeDidDots,
  encodeDidDots,
  mintBlueskyChartAssetId,
  mintPostSkygestUri,
  parseChartAssetId,
  parsePostSkygestUri
} from "../src/domain/data-layer/post-ids";
import { Did, PostUri } from "../src/domain/types";

const decodeDid = Schema.decodeUnknownSync(Did);
const decodePostUri = Schema.decodeUnknownSync(PostUri);
const decodePostSkygestUri = Schema.decodeUnknownSync(PostSkygestUri);
const decodeChartAssetId = Schema.decodeUnknownSync(ChartAssetId);

const alphaNumericChars = [
  ..."abcdefghijklmnopqrstuvwxyz0123456789"
] as const;
const domainLabelChars = [...alphaNumericChars, "-"] as const;
const rkeyChars = [...alphaNumericChars, ".", "-"] as const;

const tokenArbitrary = fc
  .array(fc.constantFrom(...alphaNumericChars), {
    minLength: 1,
    maxLength: 24
  })
  .map((chars) => chars.join(""));

const domainLabelArbitrary = fc
  .array(fc.constantFrom(...domainLabelChars), {
    minLength: 1,
    maxLength: 16
  })
  .map((chars) => chars.join(""))
  .filter((label) => !label.startsWith("-") && !label.endsWith("-"));

const domainArbitrary = fc
  .array(domainLabelArbitrary, {
    minLength: 2,
    maxLength: 4
  })
  .map((labels) => labels.join("."));

const didArbitrary: fc.Arbitrary<Schema.Schema.Type<typeof Did>> = fc.oneof(
  tokenArbitrary.map((token) => decodeDid(`did:plc:${token}`)),
  tokenArbitrary.map((token) => decodeDid(`did:key:${token}`)),
  domainArbitrary.map((domain) => decodeDid(`did:web:${domain}`)),
  fc
    .tuple(domainArbitrary, tokenArbitrary, tokenArbitrary)
    .map(([domain, collection, item]) =>
      decodeDid(`did:web:${domain}:${collection}:${item}`)
    )
);

const rkeyArbitrary = fc
  .array(fc.constantFrom(...rkeyChars), {
    minLength: 1,
    maxLength: 32
  })
  .map((chars) => chars.join(""))
  .filter((value) => !value.startsWith(".") && !value.endsWith("."));

const blobCidArbitrary = tokenArbitrary;
const numericTokenArbitrary = fc
  .array(fc.constantFrom(...("0123456789".split("") as Array<"0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9">)), {
    minLength: 5,
    maxLength: 20
  })
  .map((chars) => chars.join(""));
const realStoredBskyImageUrls = [
  "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:ii2yv4lw6nju7ynpwohqvvle/bafkreibolo5bd5qtdw5mxq3sbxie2ekq2smwo4zg3fy2uwaimy5fnurv7i",
  "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:ii2yv4lw6nju7ynpwohqvvle/bafkreibolo5bd5qtdw5mxq3sbxie2ekq2smwo4zg3fy2uwaimy5fnurv7i@jpeg"
] as const;

describe("post-ids", () => {
  it("round-trips the did-dots encoding across supported DID methods", () => {
    fc.assert(
      fc.property(didArbitrary, (did) => {
        expect(decodeDidDots(encodeDidDots(did))).toBe(did);
      })
    );
  });

  it("round-trips Bluesky post URIs through mint and parse", () => {
    fc.assert(
      fc.property(didArbitrary, rkeyArbitrary, (did, rkey) => {
        const postUri = decodePostUri(`at://${did}/app.bsky.feed.post/${rkey}`);
        const skygestUri = mintPostSkygestUri(postUri);

        expect(decodePostSkygestUri(skygestUri)).toBe(skygestUri);
        expect(parsePostSkygestUri(skygestUri)).toEqual({
          platform: "bluesky",
          did,
          rkey
        });
      })
    );
  });

  it("round-trips Twitter post URIs through mint and parse while dropping the user id", () => {
    fc.assert(
      fc.property(
        numericTokenArbitrary,
        numericTokenArbitrary,
        (userId, tweetId) => {
          const postUri = decodePostUri(`x://${userId}/status/${tweetId}`);
          const skygestUri = mintPostSkygestUri(postUri);

          expect(decodePostSkygestUri(skygestUri)).toBe(skygestUri);
          expect(skygestUri).toBe(`https://id.skygest.io/post/twitter/${tweetId}`);
          expect(parsePostSkygestUri(skygestUri)).toEqual({
            platform: "twitter",
            tweetId
          });
        }
      )
    );
  });

  it("round-trips minted Bluesky chart asset ids", () => {
    fc.assert(
      fc.property(didArbitrary, rkeyArbitrary, blobCidArbitrary, (did, rkey, blobCid) => {
        const chartAssetId = mintBlueskyChartAssetId({
          did,
          rkey,
          blobCid
        });

        expect(decodeChartAssetId(chartAssetId)).toBe(chartAssetId);
        expect(parseChartAssetId(chartAssetId)).toEqual({
          platform: "bluesky",
          did,
          rkey,
          blobCid
        });
      })
    );
  });

  it("derives a Bluesky chart asset id from the platform post URI", () => {
    fc.assert(
      fc.property(didArbitrary, rkeyArbitrary, blobCidArbitrary, (did, rkey, blobCid) => {
        const postUri = decodePostUri(`at://${did}/app.bsky.feed.post/${rkey}`);
        const chartAssetId = chartAssetIdFromBluesky(postUri, blobCid);

        expect(parseChartAssetId(chartAssetId)).toEqual({
          platform: "bluesky",
          did,
          rkey,
          blobCid
        });
      })
    );
  });

  it("parses representative real Bluesky image URLs from the old eval corpus", () => {
    expect(realStoredBskyImageUrls.length).toBeGreaterThan(0);

    for (const url of realStoredBskyImageUrls) {
      expect(parseFeedImageUrl(url)).not.toBeNull();
    }
  });
});
