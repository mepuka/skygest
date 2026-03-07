import { Command, CommandExecutor, FetchHttpClient, FileSystem } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Config, Console, Effect, Either, Layer, Schema } from "effect";
import {
  assertUniqueExpertSeeds,
  assertValidExpertSeedManifest,
  mergeExpertSeedManifest,
  toExpertSeedHandleKey
} from "../bootstrap/ExpertSeeds";
import { BlueskyClient, makeBlueskyClient } from "../bluesky/BlueskyClient";
import { ExpertSeed, ExpertSeedManifest, type ExpertSource } from "../domain/bi";

// ---------------------------------------------------------------------------
// Skygent store author extraction via @effect/platform Command
// ---------------------------------------------------------------------------

const SkygentAuthor = Schema.Struct({
  author: Schema.String,
  posts: Schema.Number,
  engagement: Schema.Number,
  lastActive: Schema.String
});

const SkygentAuthorsResponse = Schema.Struct({
  authors: Schema.Array(SkygentAuthor)
});

const DEFAULT_SEED_PATH = fileURLToPath(
  new URL("../../config/expert-seeds/energy.json", import.meta.url)
);
const DEFAULT_SKYGENT_DIR = resolve(import.meta.dir, "../../../skygent-bsky");
const DEFAULT_PUBLIC_API = "https://public.api.bsky.app";
const DEFAULT_STORE = "energy-news";
const DEFAULT_STORE_LIMIT = 500;
const DEFAULT_BATCH_SIZE = 25;

const ScriptConfig = Config.all({
  seedPath: Config.withDefault(
    Config.string("EXPERT_SEED_PATH"),
    DEFAULT_SEED_PATH
  ),
  skygentDir: Config.withDefault(
    Config.string("SKYGENT_DIR"),
    DEFAULT_SKYGENT_DIR
  ),
  publicApi: Config.withDefault(
    Config.string("PUBLIC_BSKY_API"),
    DEFAULT_PUBLIC_API
  ),
  store: Config.withDefault(
    Config.string("SKYGENT_STORE"),
    DEFAULT_STORE
  ),
  storeLimit: Config.withDefault(
    Config.integer("SKYGENT_STORE_LIMIT"),
    DEFAULT_STORE_LIMIT
  ),
  batchSize: Config.withDefault(
    Config.integer("SKYGENT_BATCH_SIZE"),
    DEFAULT_BATCH_SIZE
  )
});

type ScriptConfigShape = Config.Config.Success<typeof ScriptConfig>;

const requirePositiveInteger = (value: number, envVar: string) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${envVar} must be a positive integer, received ${String(value)}`);
  }

  return value;
};

const loadScriptConfig = Effect.fn("buildExpertSeeds.loadConfig")(function* () {
  const config = yield* ScriptConfig;

  return {
    ...config,
    storeLimit: requirePositiveInteger(config.storeLimit, "SKYGENT_STORE_LIMIT"),
    batchSize: requirePositiveInteger(config.batchSize, "SKYGENT_BATCH_SIZE")
  } satisfies ScriptConfigShape;
});

const fetchStoreAuthors = (
  skygentDir: string,
  store: string,
  limit: number
) =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    const output = yield* executor.string(
      Command.make(
        "bunx", "skygent", "store", "authors", store,
        "--sort", "by-posts", "--limit", String(limit)
      ).pipe(Command.workingDirectory(skygentDir))
    );
    return yield* Schema.decode(Schema.parseJson(SkygentAuthorsResponse))(output);
  });

// ---------------------------------------------------------------------------
// Curation filters
// ---------------------------------------------------------------------------

const generalMedia = new Set([
  "npr.org", "bloomberg.com", "nytimes.com", "economist.com", "reuters.com",
  "theguardian.com", "washingtonpost.com", "apnews.com", "wired.com",
  "politico.com", "cnbc.com", "latimes.com", "axios.com", "wsj.com",
  "newyorker.com", "opinion.bloomberg.com", "propublica.org", "financialtimes.com",
  "thehill.com", "vox.com", "arstechnica.com", "kcur.org"
]);

const skipHandles = new Set([
  "ronfilipkowski.bsky.social", "acyn.bsky.social", "jamellebouie.net",
  "adamkinzinger.substack.com", "karenattiah.bsky.social", "kenjennings.bsky.social",
  "dieworkwear.bsky.social", "xkcd.com", "chrislhayes.bsky.social",
  "jasonleopold.bsky.social", "sanders.senate.gov", "barackobama.bsky.social",
  "kylegriffin1.bsky.social", "kevinmkruse.bsky.social", "jasonschreier.bsky.social",
  "carlquintanilla.bsky.social", "bencollins.bsky.social", "phillewis.bsky.social",
  "gtconway.bsky.social", "taniel.bsky.social", "kyledcheney.bsky.social",
  "bgrueskin.bsky.social", "muellershewrote.com", "atrupar.com",
  "sethabramson.bsky.social", "hankgreen.bsky.social", "timothysnyder.bsky.social",
  "rbreich.bsky.social", "mollyjongfast.bsky.social", "rokhanna.bsky.social",
  "jbpritzker.bsky.social", "dell.bsky.social", "sbworkersunited.org",
  "cjzero.bsky.social", "parkermolloy.com", "jessicavalenti.bsky.social",
  "stevevladeck.bsky.social", "walterolson.bsky.social", "daveweigel.bsky.social",
  "davidfrum.bsky.social", "gregsargent.bsky.social", "joshtpm.bsky.social",
  "adamserwer.bsky.social", "mehdirhasan.bsky.social", "sarahlongwell25.bsky.social",
  "angrystaffer.bsky.social", "brandyjensen.bsky.social", "tomtomorrow.bsky.social",
  "marcelias.bsky.social", "annabower.bsky.social", "rtraister.bsky.social",
  "donmoyn.bsky.social", "pbump.com", "crampell.bsky.social",
  "qjurecic.bsky.social", "sherylnyt.bsky.social", "karenho.bsky.social",
  "histoftech.bsky.social", "ramirez.house.gov", "cwebbonline.com",
  "madeleinevasaly.com", "simplyskye.bsky.social", "bubbaprog.xyz",
  "thefatwizard.bsky.social", "ottoenglish.bsky.social", "supernintendo.bsky.social",
  "vermontgmg.bsky.social", "crobertcargill.bsky.social", "bobsmyusername.bsky.social",
  "joesonka.lpm.org", "tylerhuckabee.bsky.social", "caitlingilbert.bsky.social",
  "jonathanhoefler.bsky.social", "beckyhammer.bsky.social", "lisaguerrero.bsky.social",
  "gracepanetta.bsky.social", "cingraham.bsky.social", "laurahelmuth.bsky.social",
  "kenwhite.bsky.social", "gelliottmorris.com", "rmac.bsky.social",
  "jpbrammer.bsky.social", "lorenaoneil.com", "shonamurray.bsky.social",
  "katiephang.bsky.social", "adamparkhomenko.bsky.social", "bradlander.bsky.social",
  "georgemonbiot.bsky.social", "crindivisible.bsky.social", "rebeccasolnit.bsky.social",
  "drewharwell.com", "reichlinmelnick.bsky.social", "maddowblog.bsky.social",
  "thetnholler.bsky.social", "knibbs.bsky.social", "jeisinger.bsky.social",
  "rgoodlaw.bsky.social", "lorak.bsky.social", "notlikewe.bsky.social",
  "marisakabas.bsky.social", "metr.org", "mcpli.bsky.social",
  "iwillnotbesilenced.bsky.social", "katrafiy.bsky.social", "chriswarcraft.bsky.social",
  "beijingpalmer.bsky.social", "rincewind.run", "skiles.blue",
  "cooperlund.online", "maxberger.bsky.social", "newsguy.bsky.social",
  "mbsolheim.bsky.social", "amutepiggy.bsky.social", "dimitridrekonja.bsky.social",
  "altmetric.com", "erinys.uwu.lgbt", "reckless.bsky.social",
  "djbyrnes1.bsky.social", "misernyc.bsky.social", "sharonk.bsky.social",
  "paleofuture.bsky.social", "gbbranstetter.bsky.social", "adambienkov.bsky.social",
  "dmbmeg.bsky.social", "nickmiroff.bsky.social", "waiterich.bsky.social",
  "davidho.bsky.social", "moreperfectunion.bsky.social", "stphnfwlr.com",
  "matt-levine.bsky.social", "zoetillman.bsky.social", "amandamull.bsky.social",
  "davey.bsky.social", "sdonnan.bsky.social", "hansilowang.bsky.social",
  "stevenmazie.bsky.social", "leahnylen.bsky.social",
  "europesays.bsky.social", "altenergy.bsky.social", "byteseu.bsky.social",
  "energywatch.bsky.social", "fintwitter.bsky.social", "megawattnews.bsky.social",
  "newsen.bsky.social", "mygridgb.bsky.social", "planetkooler.bsky.social",
  "longtail.news", "trundlelinb.bsky.social", "unaecosystems.bsky.social",
  "energysolutions.bsky.social", "epsteinweb.bsky.social", "bigearthdata.ai",
  "counterpoint4.bsky.social"
]);

type StoreAuthor = typeof SkygentAuthor.Type;

const isDefined = <A>(value: A | null): value is A => value !== null;

const isEnergyCandidate = (a: StoreAuthor): boolean => {
  if (generalMedia.has(a.author)) return false;
  if (skipHandles.has(a.author)) return false;
  if (a.posts < 15) return false;
  if (a.engagement < 10) return false;
  return true;
};

const dedupeStoreAuthors = (authors: ReadonlyArray<StoreAuthor>) => {
  const seenAuthors = new Set<string>();
  const deduped: Array<StoreAuthor> = [];
  let skipped = 0;

  for (const author of authors) {
    const normalizedAuthor = author.author.trim().toLowerCase();

    if (seenAuthors.has(normalizedAuthor)) {
      skipped += 1;
      continue;
    }

    seenAuthors.add(normalizedAuthor);
    deduped.push({
      ...author,
      author: author.author.trim()
    });
  }

  return {
    authors: deduped,
    skipped
  };
};

const formatResolutionError = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof error.message === "string") {
      if ("status" in error && typeof error.status === "number") {
        return `${error.message} (status ${String(error.status)})`;
      }

      return error.message;
    }
  }

  return String(error);
};

const assertPathExists = Effect.fn("buildExpertSeeds.assertPathExists")(function* (
  path: string,
  label: string,
  envVar: string
) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(path);

  if (!exists) {
    throw new Error(`${label} not found at ${path}. Set ${envVar} to override.`);
  }
});

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------

const SOURCE: ExpertSource = "network";
const SOURCE_REF = "energy-news-store/by-posts";

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const bluesky = yield* BlueskyClient;
  const config = yield* loadScriptConfig();

  yield* assertPathExists(config.seedPath, "expert seed manifest", "EXPERT_SEED_PATH");
  yield* assertPathExists(config.skygentDir, "skygent directory", "SKYGENT_DIR");

  // 1. Fetch authors from skygent store
  yield* Console.log(`Fetching ${config.store} authors from skygent store...`);
  const storeData = yield* fetchStoreAuthors(
    config.skygentDir,
    config.store,
    config.storeLimit
  );
  const filteredCandidates = storeData.authors.filter(isEnergyCandidate);
  const candidates = dedupeStoreAuthors(filteredCandidates);
  yield* Console.log(`Filtered to ${candidates.authors.length} energy-focused candidates`);

  if (candidates.skipped > 0) {
    yield* Console.log(`Skipped ${candidates.skipped} duplicate store authors`);
  }

  // 2. Load existing manifest and find new handles
  const existingText = yield* fs.readFileString(config.seedPath);
  const existing = assertValidExpertSeedManifest(
    yield* Schema.decode(Schema.parseJson(ExpertSeedManifest))(existingText)
  );
  const existingHandles = new Set(
    existing.experts
      .map((expert) => toExpertSeedHandleKey(expert.handle))
      .filter(isDefined)
  );
  const existingDids = new Set(existing.experts.map((expert) => String(expert.did)));
  const newCandidates = candidates.authors.filter(
    (candidate) =>
      !existingDids.has(candidate.author) &&
      !existingHandles.has(toExpertSeedHandleKey(candidate.author) ?? "")
  );
  yield* Console.log(`${newCandidates.length} new candidates (${existing.experts.length} already seeded)`);

  if (newCandidates.length === 0) {
    yield* Console.log("No new experts to add.");
    return;
  }

  // 3. Resolve handles → profiles via BlueskyClient
  const resolved: Array<ExpertSeed> = [];
  const failures: Array<{ readonly author: string; readonly error: unknown }> = [];

  for (let i = 0; i < newCandidates.length; i += config.batchSize) {
    const batch = newCandidates.slice(i, i + config.batchSize);
    const batchNum = Math.floor(i / config.batchSize) + 1;
    const batchTotal = Math.ceil(newCandidates.length / config.batchSize);
    yield* Console.log(`Resolving batch ${batchNum}/${batchTotal} (${batch.length} handles)...`);

    const results = yield* Effect.forEach(
      batch,
      (candidate) =>
        bluesky.getProfile(candidate.author).pipe(
          Effect.flatMap((profile) =>
            Schema.decodeUnknown(ExpertSeed)({
              did: profile.did,
              handle: profile.handle ?? undefined,
              displayName: profile.displayName ?? undefined,
              description: profile.description ?? undefined,
              source: SOURCE,
              sourceRef: SOURCE_REF,
              active: true
            })
          ),
          Effect.either
        ),
      { concurrency: 5 }
    );

    for (const [index, result] of results.entries()) {
      const candidate = batch[index];

      if (candidate === undefined) {
        continue;
      }

      if (Either.isRight(result)) {
        resolved.push(result.right);
      } else {
        failures.push({
          author: candidate.author,
          error: result.left
        });
        yield* Console.error(
          `  Failed to resolve ${candidate.author}: ${formatResolutionError(result.left)}`
        );
      }
    }

    if (i + config.batchSize < newCandidates.length) {
      yield* Effect.sleep(200);
    }
  }

  if (failures.length > 0) {
    const preview = failures
      .slice(0, 5)
      .map(({ author, error }) => `${author}: ${formatResolutionError(error)}`)
      .join("; ");

    throw new Error(
      `Aborted expert seed write after ${failures.length} failed lookups. ${preview}`
    );
  }

  assertUniqueExpertSeeds(resolved, "resolved expert seeds");

  // 4. Merge and validate manifest
  const merged = mergeExpertSeedManifest(existing, resolved);
  const addedCount = merged.experts.length - existing.experts.length;
  yield* Console.log(`Resolved ${addedCount} new experts`);

  if (addedCount === 0) {
    yield* Console.log("No new experts to add after manifest validation.");
    return;
  }

  // 5. Write merged manifest
  const encoded = yield* Schema.encode(Schema.parseJson(ExpertSeedManifest))(merged);
  yield* fs.writeFileString(config.seedPath, encoded + "\n");
  yield* Console.log(
    `Wrote ${merged.experts.length} experts (${existing.experts.length} existing + ${addedCount} new) to ${config.seedPath}`
  );
});

const blueskyLayer = Layer.effect(
  BlueskyClient,
  Effect.gen(function* () {
    const config = yield* loadScriptConfig();
    return yield* makeBlueskyClient(config.publicApi);
  })
).pipe(Layer.provide(FetchHttpClient.layer));

const main = program.pipe(
  Effect.provide(blueskyLayer)
);

main.pipe(
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
);
