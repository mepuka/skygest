import { Schema } from "effect";
import { energySeedDid } from "../bootstrap/CheckedInExpertSeeds";
import { RawEventBatch } from "../domain/types";

export const smokeSearchQuery = "photovoltaic battery storage";

export const smokeFixtureUris = (did = energySeedDid) =>
  [
    `at://${did}/app.bsky.feed.post/post-solar`,
    `at://${did}/app.bsky.feed.post/post-wind`
  ] as const;

export const makeSmokeFixtureBatch = (did = energySeedDid) =>
  Schema.decodeUnknownSync(RawEventBatch)({
    cursor: 1_710_000_001_000_000,
    events: [
      {
        kind: "commit",
        operation: "create",
        collection: "app.bsky.feed.post",
        did,
        uri: smokeFixtureUris(did)[0],
        cid: "cid-solar",
        record: {
          text: "Utility-scale solar photovoltaic battery storage is easing power grid pressure.",
          urls: ["https://example.com/solar-storage"],
          tags: ["solar", "storage"],
          label_values: ["grid"],
          embed: {
            external: {
              uri: "https://example.com/solar-storage",
              title: "Solar storage buildout",
              description: "Battery storage and transmission upgrades"
            }
          }
        },
        timeUs: 1_710_000_000_000_000
      },
      {
        kind: "commit",
        operation: "create",
        collection: "app.bsky.feed.post",
        did,
        uri: smokeFixtureUris(did)[1],
        cid: "cid-wind",
        record: {
          text: "Offshore wind developers still need more transmission capacity.",
          urls: ["https://grid.example.com/offshore-wind"],
          tags: ["wind"],
          label_values: ["transmission"],
          embed: {
            external: {
              uri: "https://grid.example.com/offshore-wind",
              title: "Wind transmission backlog",
              description: "Grid infrastructure for offshore wind"
            }
          }
        },
        timeUs: 1_710_000_001_000_000
      }
    ]
  });
