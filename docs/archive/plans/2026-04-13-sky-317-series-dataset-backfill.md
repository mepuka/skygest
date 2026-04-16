# SKY-317 — Series→Dataset backfill from corpus evidence

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Populate `Series.datasetId` on the 7 cold-start series whose dataset link is already asserted by unanimous, semantically-coherent candidate evidence, and update the CQ conformance probe + coverage audit to reflect the new series-backed agent shelf.

**Architecture:** Evidence-based backfill. Never invent data. The single source of truth for "which dataset does series X belong to?" is the existing `referencedDatasetId` field on cold-start Candidate fixtures, which were curated in SKY-215. We backfill a series only when (a) every candidate referencing it points at a single non-null dataset, (b) the dataset's `publisherAgentId` agrees with the candidates' `referencedAgentId`, and (c) a human has confirmed the pairing is semantically sensible. Series without coherent evidence stay `datasetId`-undefined and are surfaced in a coverage audit.

**Tech Stack:** Effect 4, Bun, Cloudflare Workers, Vitest via `@effect/vitest`, checked-in JSON fixtures under `references/cold-start/`.

---

## 0. Context you need before touching anything

### 0.1 Current state on this branch

Branch `sky-321/data-layer-spine-manifest-contract` carries **two** commits worth of work:

- Committed (`be4b962d`): SKY-321 DataLayerSpineManifest contract.
- Uncommitted in working tree: SKY-320 structural codegen + Series.datasetId runtime/storage/lookup (added to this slice per the §4.6 clause of `docs/plans/2026-04-13-sky-320-structural-codegen-plan.md`).

You do **not** need to commit SKY-320 before starting SKY-317. Let the branch keep accumulating; we'll sort out PR boundaries at the end. All of SKY-320's work is required groundwork: `Series.datasetId` exists as an optional field, the D1 `series.dataset_id` column exists, the repo round-trips it, and `prepareDataLayerRegistry` derives `variablesByDatasetId` from `seed.series` loops (see `src/resolution/dataLayerRegistry.ts:591-604`).

Verify the starting state by running:

```bash
bun run typecheck
bun run test
```

Expected: clean typecheck, 1283 tests passing in ~21s. If anything is red, stop and fix before starting §1.

### 0.2 The data picture (do not skip this)

The 25 checked-in series live in `references/cold-start/series/*.json`. They were minted by `scripts/generate-series.ts` (SKY-215) — hand-authored by domain judgment, not adapter-derived. Their IDs are pinned in `references/cold-start/series/.series-ids.json`.

For each series, the cold-start candidate corpus (`references/cold-start/candidates/*.json`) may or may not already record which `Dataset` curators believed the series belongs to, via `referencedSeriesId + referencedDatasetId` on the Candidate record. **That is the only evidence we are allowed to use for backfill in this ticket.**

Running the evidence-scan script (§1.2 below) produces this exact table:

```
SERIES                                      | VOTES | STATUS       | WINNING DATASET
--------------------------------------------+-------+--------------+----------------------------------------
global-renewable-capacity-annual            |   5   | UNANIMOUS    | irena-capacity-stats-dataset.json
us-ca-solar-generation-daily                |   4   | UNANIMOUS    | caiso-todays-outlook.json
us-co2-emissions-by-state-annual            |   2   | UNANIMOUS    | eia-state-co2.json
us-pjm-capacity-auction-annual              |   1   | UNANIMOUS    | pjm-capacity-auction.json
us-pjm-load-forecast                        |   3   | UNANIMOUS    | pjm-load-forecast.json
us-tx-electricity-demand-hourly             |   4   | UNANIMOUS    | ercot-generation.json         (proxy)
us-tx-solar-generation-daily                |   6   | UNANIMOUS    | ercot-solar-records.json
--------------------------------------------+-------+--------------+----------------------------------------
de-wholesale-electricity-price              |   3   | UNAN(ERROR)  | eia-electricity-data.json     (SKIP)
--------------------------------------------+-------+--------------+----------------------------------------
eu-solar-generation-annual                  |   3   | SPLIT 2/3    | (leave undefined)
global-electricity-generation-annual        |   7   | SPLIT 4/7    | (leave undefined)
us-ca-electricity-price-hourly              |  17   | SPLIT 14/17  | (leave undefined)
us-electricity-generation-annual            |   5   | SPLIT 3/5    | (leave undefined)
--------------------------------------------+-------+--------------+----------------------------------------
13 series with zero candidate evidence                             | (leave undefined, audited)
```

**Why `de-wholesale-electricity-price` is SKIP:** 3/3 candidates vote for `eia-electricity-data.json`, but EIA does not publish German wholesale electricity prices — the series is tagged `place: "DE", market: "EPEX"` in `references/cold-start/series/de-wholesale-electricity-price.json`. The candidates are self-consistently mislabelled. Fixing them is SKY-215 corpus hygiene, not SKY-317 scope. We leave `datasetId` undefined and document the known error in the plan + coverage audit.

**Why split-vote series stay undefined:** Picking the majority would silently override the 2–3 dissenting candidates, and those candidates would then fail the new `series.datasetId == candidate.referencedDatasetId` consistency check we're about to add. Silencing them would mean inventing data. Out of scope.

**Why zero-evidence series stay undefined:** SKY-317's acceptance criteria explicitly allow missing `datasetId` during migration. The 13 zero-evidence series will be surfaced in a coverage audit, but not fabricated.

### 0.3 Out of scope (do not do any of this in this PR)

- Populating the 13 zero-evidence series by hand-picking from the 1430 catalog datasets.
- Fixing the noisy candidate records (even `de-wholesale → EIA`). That is SKY-215 / corpus hygiene.
- Tightening `Series.datasetId` from optional to required. That is the follow-up ticket after this one lands.
- Removing `Dataset.variableIds` from the schema. SKY-317 acceptance §"Out of Scope" explicitly forbids it.
- Modelling Distribution → Series.
- Running the CQ conformance harness end-to-end and claiming gold-row wins — this ticket only restores the *structural* non-emptiness of the agent shelf.

---

## 1. Task list

Each task is small, has an explicit verification step, and ends with a commit. Do **not** batch commits.

---

### Task 1: Lock the evidence scan as a checked-in utility

Before touching any fixture, produce the same decision matrix the plan summarises, from a checked-in script that anyone can re-run. This is your protection against drift: if a candidate changes, the script will re-compute a new matrix and you'll notice.

**Files:**
- Create: `scripts/audit-series-dataset-evidence.ts`

**Step 1: Write the script**

```ts
/**
 * SKY-317 evidence audit — reports the series→dataset backfill decision
 * matrix from cold-start candidates.
 *
 * Usage: bun scripts/audit-series-dataset-evidence.ts
 *
 * Emits a table of (seriesSlug, voteCount, status, winningDataset) and a
 * list of zero-evidence series. Treats the candidate corpus as ground truth
 * — never invents pairings.
 */
import { Command } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Path, Result, Schema } from "effect";
import { Candidate } from "../src/domain/data-layer";
import { decodeJsonStringEitherWith } from "../src/platform/Json";
import { runScriptMain, scriptPlatformLayer } from "../src/platform/ScriptRuntime";

type CandidateRecord = Schema.Schema.Type<typeof Candidate>;

type SeriesVote = {
  readonly candidate: string;
  readonly datasetId: string | undefined;
  readonly agentId: string | undefined;
};

type DecisionRow = {
  readonly slug: string;
  readonly votes: number;
  readonly status: "UNANIMOUS" | "SPLIT" | "NONE";
  readonly winner: string | undefined;
  readonly winnerFile: string | undefined;
  readonly winnerPublisher: string | undefined;
};

const run = Effect.fn("audit-series-dataset-evidence.run")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve("references/cold-start");

  // 1. Load series slug → id map
  const seriesIdsPath = path.join(root, "series", ".series-ids.json");
  const seriesIdsText = yield* fs.readFileString(seriesIdsPath);
  const seriesIds = yield* decodeJsonStringEitherWith(
    Schema.Record({ key: Schema.String, value: Schema.String })
  )(seriesIdsText).pipe(Effect.mapError((e) => new Error(String(e))));

  const slugById = new Map<string, string>();
  for (const [slug, id] of Object.entries(seriesIds)) {
    slugById.set(id, slug);
  }

  // 2. Load agents (id → name)
  const agentsDir = path.join(root, "catalog", "agents");
  const agentFiles = yield* fs.readDirectory(agentsDir);
  const agentById = new Map<string, string>();
  for (const file of agentFiles) {
    if (!file.endsWith(".json")) continue;
    const text = yield* fs.readFileString(path.join(agentsDir, file));
    const parsed = JSON.parse(text) as { id: string; name: string };
    agentById.set(parsed.id, parsed.name);
  }

  // 3. Load datasets (id → { file, title, publisher })
  const datasetsDir = path.join(root, "catalog", "datasets");
  const datasetFiles = yield* fs.readDirectory(datasetsDir);
  const datasetById = new Map<
    string,
    { file: string; title: string; publisherAgentId?: string }
  >();
  for (const file of datasetFiles) {
    if (!file.endsWith(".json")) continue;
    const text = yield* fs.readFileString(path.join(datasetsDir, file));
    const parsed = JSON.parse(text) as {
      id: string;
      title: string;
      publisherAgentId?: string;
    };
    datasetById.set(parsed.id, {
      file,
      title: parsed.title,
      publisherAgentId: parsed.publisherAgentId
    });
  }

  // 4. Walk candidates, collect series votes
  const candidatesDir = path.join(root, "candidates");
  const candidateFiles = yield* fs.readDirectory(candidatesDir);
  const votesBySlug = new Map<string, Array<SeriesVote>>();

  for (const file of candidateFiles) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    const text = yield* fs.readFileString(path.join(candidatesDir, file));
    const parsed = JSON.parse(text) as {
      referencedSeriesId?: string;
      referencedDatasetId?: string;
      referencedAgentId?: string;
    };
    if (typeof parsed.referencedSeriesId !== "string") continue;
    const slug = slugById.get(parsed.referencedSeriesId);
    if (slug === undefined) continue;

    const existing = votesBySlug.get(slug) ?? [];
    existing.push({
      candidate: file,
      datasetId: parsed.referencedDatasetId,
      agentId: parsed.referencedAgentId
    });
    votesBySlug.set(slug, existing);
  }

  // 5. Build decision rows
  const rows: Array<DecisionRow> = [];
  for (const slug of [...Object.keys(seriesIds)].sort()) {
    const votes = votesBySlug.get(slug) ?? [];
    const nonNone = votes.filter((v) => v.datasetId !== undefined);
    const distinct = new Set(nonNone.map((v) => v.datasetId));

    if (distinct.size === 0) {
      rows.push({
        slug,
        votes: 0,
        status: "NONE",
        winner: undefined,
        winnerFile: undefined,
        winnerPublisher: undefined
      });
      continue;
    }

    if (distinct.size === 1) {
      const winnerId = [...distinct][0]!;
      const ds = datasetById.get(winnerId);
      const publisher =
        ds?.publisherAgentId !== undefined
          ? agentById.get(ds.publisherAgentId)
          : undefined;
      rows.push({
        slug,
        votes: nonNone.length,
        status: "UNANIMOUS",
        winner: winnerId,
        winnerFile: ds?.file,
        winnerPublisher: publisher
      });
      continue;
    }

    rows.push({
      slug,
      votes: nonNone.length,
      status: "SPLIT",
      winner: undefined,
      winnerFile: undefined,
      winnerPublisher: undefined
    });
  }

  // 6. Print
  yield* Console.log("=== SERIES → DATASET EVIDENCE ===");
  for (const row of rows) {
    const status = row.status.padEnd(10);
    const votes = String(row.votes).padStart(3);
    const title = row.winnerFile ?? "(none)";
    const publisher = row.winnerPublisher ?? "";
    yield* Console.log(
      `${status} ${votes}  ${row.slug.padEnd(42)}  ${title.padEnd(40)}  ${publisher}`
    );
  }

  const unanimousCount = rows.filter((r) => r.status === "UNANIMOUS").length;
  const splitCount = rows.filter((r) => r.status === "SPLIT").length;
  const noneCount = rows.filter((r) => r.status === "NONE").length;
  yield* Console.log(
    `\nUNANIMOUS ${unanimousCount}  SPLIT ${splitCount}  NONE ${noneCount}`
  );
});

const command = Command.make({
  name: "audit-series-dataset-evidence",
  description: "Report series→dataset evidence from cold-start candidates",
  run
});

runScriptMain(command, scriptPlatformLayer);
```

Note: the script uses Effect platform `FileSystem` / `Path`, not `node:fs` / `node:path`. This is mandatory per the `feedback_platform_apis.md` memory and the `CLAUDE.md` "Effect platform APIs for IO" rule.

**Step 2: Run it and confirm it prints the decision matrix from §0.2**

Run: `bun scripts/audit-series-dataset-evidence.ts`

Expected output must contain:

```
UNANIMOUS   5  global-renewable-capacity-annual           irena-capacity-stats-dataset.json         International Renewable Energy Agency
UNANIMOUS   3  de-wholesale-electricity-price             eia-electricity-data.json                 U.S. Energy Information Administration
...
UNANIMOUS 8  SPLIT 4  NONE 13
```

If the UNANIMOUS count is not 8 or the SPLIT count is not 4, the data has drifted since the plan was written — **stop and investigate**. Do not blindly adjust the plan.

**Step 3: Commit**

```bash
git add scripts/audit-series-dataset-evidence.ts
git commit -m "SKY-317: add series→dataset evidence audit script

Reports the backfill decision matrix from cold-start candidates. Read-only;
treats the candidate corpus as ground truth.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add a checked-in backfill manifest

We've decided once, in writing, which 7 series get backfilled. Encode that decision as a checked-in JSON so (a) rerunning `scripts/generate-series.ts` produces the same output, and (b) the link from series slug → dataset ID is reviewable without scanning candidates.

**Files:**
- Create: `references/cold-start/series/.series-dataset-backfill.json`

**Step 1: Write the backfill manifest**

Use the `scripts/audit-series-dataset-evidence.ts` output from Task 1 to harvest the dataset URIs, then write this file verbatim. **Every dataset URI here must be literally copied from the audit script output, not from this plan** — the plan can go stale, the audit can't.

Exact structure:

```json
{
  "version": 1,
  "source": "SKY-317 series→dataset backfill, derived from unanimous candidate evidence",
  "generatedAt": "2026-04-13",
  "explicit": {
    "global-renewable-capacity-annual": {
      "datasetId": "<paste from audit script>",
      "datasetFile": "irena-capacity-stats-dataset.json",
      "evidence": "5 unanimous candidates, publisher IRENA"
    },
    "us-ca-solar-generation-daily": {
      "datasetId": "<paste from audit script>",
      "datasetFile": "caiso-todays-outlook.json",
      "evidence": "4 unanimous candidates, publisher CAISO"
    },
    "us-co2-emissions-by-state-annual": {
      "datasetId": "<paste from audit script>",
      "datasetFile": "eia-state-co2.json",
      "evidence": "2 unanimous candidates, publisher EIA"
    },
    "us-pjm-capacity-auction-annual": {
      "datasetId": "<paste from audit script>",
      "datasetFile": "pjm-capacity-auction.json",
      "evidence": "1 unanimous candidate, publisher PJM"
    },
    "us-pjm-load-forecast": {
      "datasetId": "<paste from audit script>",
      "datasetFile": "pjm-load-forecast.json",
      "evidence": "3 unanimous candidates, publisher PJM"
    },
    "us-tx-electricity-demand-hourly": {
      "datasetId": "<paste from audit script>",
      "datasetFile": "ercot-generation.json",
      "evidence": "4 unanimous candidates, publisher ERCOT. NOTE: dataset title says 'Generation' but ERCOT's real-time dashboard exposes both generation and demand; the variableId is electricity-demand."
    },
    "us-tx-solar-generation-daily": {
      "datasetId": "<paste from audit script>",
      "datasetFile": "ercot-solar-records.json",
      "evidence": "6 unanimous candidates (+1 NONE), publisher ERCOT"
    }
  },
  "deliberatelyOmitted": {
    "de-wholesale-electricity-price": {
      "reason": "Unanimous 3/3 candidates vote eia-electricity-data.json, but EIA does not publish German wholesale electricity prices. The candidates are a known corpus error. Fixing them is SKY-215 hygiene, not SKY-317 scope.",
      "followUpTicket": null
    },
    "eu-solar-generation-annual": {
      "reason": "Split 2/3 between entsoe-transparency and nrel-atb. Picking the majority would override the NREL candidate; fixing it is out of scope.",
      "followUpTicket": null
    },
    "global-electricity-generation-annual": {
      "reason": "Split 4/7 across ember-data-explorer, iea-data-portal, eia-electricity-data, bnef-datacenter. Multiple coherent choices.",
      "followUpTicket": null
    },
    "us-ca-electricity-price-hourly": {
      "reason": "14/17 for caiso-todays-outlook, 3/17 for iea-data-portal. Strong majority but not unanimous.",
      "followUpTicket": null
    },
    "us-electricity-generation-annual": {
      "reason": "3/5 for eia-electricity-data, 2/5 for ember-data-explorer. Both are plausible publishers of the same variable.",
      "followUpTicket": null
    }
  },
  "zeroEvidence": [
    "eu-coal-generation-annual",
    "global-battery-pack-price-annual",
    "global-clean-energy-investment-annual",
    "global-energy-transition-investment-annual",
    "global-solar-pv-capacity-annual",
    "tr-wholesale-electricity-price",
    "us-ca-battery-discharge-daily",
    "us-ca-clean-share-daily",
    "us-ca-interconnection-queue",
    "us-data-center-demand-forecast",
    "us-interconnection-queue-annual",
    "us-tx-wind-generation-daily",
    "za-clean-electricity-share-monthly"
  ]
}
```

**Step 2: Sanity-check the file**

Run: `bun -e 'JSON.parse(require("fs").readFileSync("references/cold-start/series/.series-dataset-backfill.json", "utf-8"))'`

Expected: no output, exit 0.

Then verify every URI exists:

```bash
bun -e '
import { readFileSync } from "node:fs";
const m = JSON.parse(readFileSync("references/cold-start/series/.series-dataset-backfill.json", "utf-8"));
for (const [slug, spec] of Object.entries(m.explicit)) {
  try {
    const ds = JSON.parse(readFileSync(`references/cold-start/catalog/datasets/${spec.datasetFile}`, "utf-8"));
    if (ds.id !== spec.datasetId) {
      console.error(`MISMATCH ${slug}: file ${spec.datasetFile} has id ${ds.id}, manifest says ${spec.datasetId}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`CANNOT READ ${slug}: ${spec.datasetFile}`);
    process.exit(1);
  }
}
console.log("all 7 backfill pairs verified");
'
```

Expected: `all 7 backfill pairs verified`. If anything mismatches, investigate before proceeding.

**Step 3: Commit**

```bash
git add references/cold-start/series/.series-dataset-backfill.json
git commit -m "SKY-317: check in explicit series→dataset backfill manifest

7 semantically-coherent unanimous pairings from candidate evidence,
5 split-vote and 1 corpus-error series deliberately omitted, 13 zero-evidence
series tracked for coverage audit. Hand-reviewed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Write the failing backfill integrity test

We test-first because this surface is data-heavy and we want the test to fail loudly the moment we flip the 7 fixtures in Task 4.

**Files:**
- Create: `tests/series-dataset-backfill.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { Series } from "../src/domain/data-layer";

const ROOT = "references/cold-start";
const BACKFILL_PATH = `${ROOT}/series/.series-dataset-backfill.json`;

type BackfillManifest = {
  readonly version: 1;
  readonly explicit: Record<
    string,
    {
      readonly datasetId: string;
      readonly datasetFile: string;
      readonly evidence: string;
    }
  >;
  readonly deliberatelyOmitted: Record<string, { readonly reason: string }>;
  readonly zeroEvidence: ReadonlyArray<string>;
};

const loadBackfill = (): BackfillManifest =>
  JSON.parse(readFileSync(BACKFILL_PATH, "utf-8")) as BackfillManifest;

const loadSeries = (slug: string) =>
  Schema.decodeUnknownSync(Series)(
    JSON.parse(readFileSync(`${ROOT}/series/${slug}.json`, "utf-8"))
  );

const loadDataset = (file: string): { id: string; publisherAgentId?: string } =>
  JSON.parse(
    readFileSync(`${ROOT}/catalog/datasets/${file}`, "utf-8")
  );

const loadAllCandidates = () => {
  const dir = `${ROOT}/candidates`;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .map(
      (f) =>
        JSON.parse(readFileSync(join(dir, f), "utf-8")) as {
          referencedSeriesId?: string;
          referencedDatasetId?: string;
          referencedAgentId?: string;
        }
    );
};

describe("SKY-317 series→dataset backfill", () => {
  it("every explicit backfill pair resolves to a real dataset file", () => {
    const manifest = loadBackfill();
    for (const [slug, spec] of Object.entries(manifest.explicit)) {
      const ds = loadDataset(spec.datasetFile);
      expect(ds.id, `${slug} dataset file id mismatch`).toBe(spec.datasetId);
    }
  });

  it("every explicit-backfill series file carries datasetId matching the manifest", () => {
    const manifest = loadBackfill();
    for (const [slug, spec] of Object.entries(manifest.explicit)) {
      const series = loadSeries(slug);
      expect(
        series.datasetId,
        `${slug} should have datasetId set to ${spec.datasetId}`
      ).toBe(spec.datasetId);
    }
  });

  it("deliberately-omitted series files do NOT have datasetId set", () => {
    const manifest = loadBackfill();
    for (const slug of Object.keys(manifest.deliberatelyOmitted)) {
      const series = loadSeries(slug);
      expect(
        series.datasetId,
        `${slug} is in deliberatelyOmitted and must have datasetId undefined`
      ).toBeUndefined();
    }
  });

  it("zero-evidence series files do NOT have datasetId set", () => {
    const manifest = loadBackfill();
    for (const slug of manifest.zeroEvidence) {
      const series = loadSeries(slug);
      expect(
        series.datasetId,
        `${slug} has no candidate evidence and must have datasetId undefined`
      ).toBeUndefined();
    }
  });

  it("every backfilled dataset's publisherAgentId matches all candidates' referencedAgentId", () => {
    const manifest = loadBackfill();
    const candidates = loadAllCandidates();
    for (const [slug, spec] of Object.entries(manifest.explicit)) {
      const dataset = loadDataset(spec.datasetFile);
      const series = loadSeries(slug);
      const voters = candidates.filter(
        (c) => c.referencedSeriesId === series.id && c.referencedDatasetId !== undefined
      );
      expect(
        voters.length,
        `${slug} should have at least one voting candidate`
      ).toBeGreaterThan(0);
      for (const voter of voters) {
        expect(
          voter.referencedAgentId,
          `${slug} voter ${voter.referencedSeriesId} referencedAgentId should match dataset.publisherAgentId`
        ).toBe(dataset.publisherAgentId);
      }
    }
  });

  it("for every candidate that references both a series and a dataset, the series' datasetId agrees (when present)", () => {
    const candidates = loadAllCandidates();
    // Build seriesId → datasetId map from the 25 series files
    const seriesDir = `${ROOT}/series`;
    const seriesById = new Map<string, { slug: string; datasetId?: string }>();
    for (const file of readdirSync(seriesDir)) {
      if (!file.endsWith(".json") || file.startsWith(".")) continue;
      const slug = file.replace(/\.json$/, "");
      const series = loadSeries(slug);
      seriesById.set(series.id, { slug, datasetId: series.datasetId });
    }

    const conflicts: Array<string> = [];
    for (const c of candidates) {
      if (
        typeof c.referencedSeriesId !== "string" ||
        typeof c.referencedDatasetId !== "string"
      )
        continue;
      const series = seriesById.get(c.referencedSeriesId);
      if (series?.datasetId === undefined) continue;
      if (series.datasetId !== c.referencedDatasetId) {
        conflicts.push(
          `series ${series.slug} has datasetId ${series.datasetId} but candidate votes ${c.referencedDatasetId}`
        );
      }
    }

    expect(
      conflicts,
      `no candidate may disagree with a backfilled series.datasetId:\n${conflicts.join("\n")}`
    ).toEqual([]);
  });
});
```

**Step 2: Run the test and confirm it fails in the expected way**

Run: `bun run test -- tests/series-dataset-backfill.test.ts`

Expected: test #2 fails with something like `expected undefined to be "https://id.skygest.io/dataset/..."` for each of the 7 slugs. Tests #1, #3, #4 should pass (because the manifest exists and no series has been touched yet). Test #5 should pass. Test #6 should pass (no series has `datasetId` set yet, so the cross-check vacuously succeeds).

If tests #1, #3, #4, #5, or #6 fail at this stage, the manifest is wrong — fix it before proceeding.

**Step 3: Commit the failing test**

```bash
git add tests/series-dataset-backfill.test.ts
git commit -m "SKY-317: add failing backfill integrity test

Encodes the corpus-grounding invariants: explicit pairs must be real,
omitted/zero-evidence series must stay undefined, publisher agreement, and
candidate-series consistency.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Backfill the 7 series JSON files

Edit each file in place with the `Edit` tool — **do not regenerate via `scripts/generate-series.ts`**, which would mint new ULIDs and break every reference.

**Files (modify):**
- `references/cold-start/series/global-renewable-capacity-annual.json`
- `references/cold-start/series/us-ca-solar-generation-daily.json`
- `references/cold-start/series/us-co2-emissions-by-state-annual.json`
- `references/cold-start/series/us-pjm-capacity-auction-annual.json`
- `references/cold-start/series/us-pjm-load-forecast.json`
- `references/cold-start/series/us-tx-electricity-demand-hourly.json`
- `references/cold-start/series/us-tx-solar-generation-daily.json`

**Step 1: For each file, add `datasetId` immediately after `variableId`**

Pattern — for `global-renewable-capacity-annual.json` (use the actual dataset URI from the backfill manifest):

```diff
 {
   "_tag": "Series",
   "id": "https://id.skygest.io/series/ser_01KNQEZ5XBN5CJ6XA9MTF6SE4K",
   "label": "Global renewable capacity (annual)",
   "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WMZSP4FHM71ZK9YMF9",
+  "datasetId": "https://id.skygest.io/dataset/ds_01KNQEZ5VRV0G2XWPZD8NKXBMT",
   "fixedDims": {
     "place": "GLOBAL",
     "frequency": "annual"
   },
   "aliases": [],
   "createdAt": "2026-04-08T00:00:00.000Z",
   "updatedAt": "2026-04-08T00:00:00.000Z"
 }
```

**The `datasetId` value must come from `.series-dataset-backfill.json`, not from this plan.** Use the Edit tool with `old_string` matching `  "variableId": "<uri>",\n  "fixedDims"` and `new_string` inserting the datasetId line.

Do **not** change `updatedAt` — these are reference fixtures with pinned timestamps that other tests depend on. Do not change any other field.

Do this for all 7 files.

**Step 2: Run the integrity test**

Run: `bun run test -- tests/series-dataset-backfill.test.ts`

Expected: all 6 sub-tests pass.

**Step 3: Run the whole test suite**

Run: `bun run test`

Expected: 1283 + 6 = 1289 tests pass, nothing red. Pay attention to `tests/cold-start-validation.test.ts` — the existing semantic-consistency check at line 143-153 cross-references `series.variableId == candidate.referencedVariableId`, which we didn't touch, so it should still pass. If any test that wasn't touched starts failing, stop and read the output — likely a fixture drift we missed.

**Step 4: Commit**

```bash
git add references/cold-start/series/*.json
git commit -m "SKY-317: backfill datasetId on 7 unanimous-evidence series

Populated per references/cold-start/series/.series-dataset-backfill.json:
- global-renewable-capacity-annual → IRENA
- us-ca-solar-generation-daily → CAISO
- us-co2-emissions-by-state-annual → EIA
- us-pjm-capacity-auction-annual → PJM
- us-pjm-load-forecast → PJM
- us-tx-electricity-demand-hourly → ERCOT
- us-tx-solar-generation-daily → ERCOT

Backfill derived from unanimous referencedDatasetId votes in the
cold-start candidate corpus (SKY-215). Five split-vote series, one known
corpus-error series (de-wholesale-electricity-price→EIA), and 13
zero-evidence series deliberately left unset.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Write a failing registry-shelf coverage test

Prove that `findVariablesByAgentId` now returns a non-empty shelf for the 5 publishers covered by the 7 backfills (IRENA, CAISO, EIA, PJM, ERCOT).

**Files:**
- Modify: `tests/data-layer-registry.test.ts`

**Step 1: Read the existing test file to find the right spot**

Run: `bun -e 'console.log(require("fs").readFileSync("tests/data-layer-registry.test.ts", "utf-8"))'` (or use the Read tool).

Understand how the existing tests seed a registry. Most likely they use `prepareDataLayerRegistry` with a hand-constructed `DataLayerRegistrySeed`. If there's already a checked-in-registry loader test, add the new test there; otherwise create a new describe block.

**Step 2: Write the failing test**

Expected test body (adapt names to match the existing file style):

```ts
import { Chunk, Effect } from "effect";
import { loadCheckedInDataLayerRegistry } from "../src/bootstrap/CheckedInDataLayerRegistry";
import { layer as localFileSystemLayer } from "./helpers/LocalFileSystem";

describe("SKY-317 series-backed agent shelf", () => {
  const BACKFILLED_PUBLISHERS: ReadonlyArray<{ label: string; minVariables: number }> = [
    { label: "International Renewable Energy Agency", minVariables: 1 },
    { label: "California Independent System Operator", minVariables: 1 },
    { label: "U.S. Energy Information Administration", minVariables: 1 },
    { label: "PJM Interconnection", minVariables: 1 },
    { label: "Electric Reliability Council of Texas", minVariables: 1 }
  ];

  it.effect(
    "findVariablesByAgentId is non-empty for each backfilled publisher",
    () =>
      Effect.gen(function* () {
        const prepared = yield* loadCheckedInDataLayerRegistry().pipe(
          Effect.provide(localFileSystemLayer)
        );
        // Resolve publisher label → agent id via the registry
        const agentIdByLabel = new Map<string, string>();
        for (const agent of prepared.seed.agents) {
          agentIdByLabel.set(agent.name, agent.id);
          for (const alt of agent.alternateNames ?? []) {
            agentIdByLabel.set(alt, agent.id);
          }
        }

        for (const publisher of BACKFILLED_PUBLISHERS) {
          const agentId = agentIdByLabel.get(publisher.label);
          expect(agentId, `publisher ${publisher.label} missing from agents`).toBeDefined();
          const shelf = prepared.variablesByAgentId.get(agentId!);
          const size = shelf === undefined ? 0 : Chunk.size(shelf);
          expect(
            size,
            `publisher ${publisher.label} should have at least ${publisher.minVariables} variable(s) in shelf`
          ).toBeGreaterThanOrEqual(publisher.minVariables);
        }
      }),
    30_000
  );

  it.effect(
    "duplicate series for the same variable do not double-count the agent shelf",
    () =>
      Effect.gen(function* () {
        const prepared = yield* loadCheckedInDataLayerRegistry().pipe(
          Effect.provide(localFileSystemLayer)
        );
        // For each backfilled publisher, the shelf must contain distinct variable ids
        for (const agent of prepared.seed.agents) {
          const shelf = prepared.variablesByAgentId.get(agent.id);
          if (shelf === undefined) continue;
          const ids = Array.from(shelf, (v) => v.id);
          const unique = new Set(ids);
          expect(ids.length, `agent ${agent.name} has duplicate variables in shelf`).toBe(unique.size);
        }
      }),
    30_000
  );
});
```

**Step 3: Run the test and confirm it passes**

Run: `bun run test -- tests/data-layer-registry.test.ts`

Expected: both new tests pass because Task 4 already made the series→dataset link real, and the registry's `variablesByAgentId` derivation in `src/resolution/dataLayerRegistry.ts:661-679` now picks up the series-backed linkage.

If it fails, the failure should be informative. Debug by running the audit script from Task 1 and looking for publisher name mismatches between agent files and the canonical publisher names used above.

**Step 4: Commit**

```bash
git add tests/data-layer-registry.test.ts
git commit -m "SKY-317: prove registry agent shelf is non-empty for backfilled publishers

IRENA, CAISO, EIA, PJM, ERCOT all have ≥1 variable in their shelves after
the series.datasetId backfill. Also asserts no double-counting when multiple
series reference the same variable.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Update the CQ conformance agent-variable-shelf probe

The C3 probe in `eval/cq-conformance/capabilities.ts:380-406` currently counts `dataset.variableIds`. After the backfill it still reports "0 of 1430" — structurally empty even though the series-backed shelf is real. Flip it to measure the actual shelf via `prepared.variablesByDatasetId`.

**Files:**
- Modify: `eval/cq-conformance/capabilities.ts:380-406`

**Step 1: Read the existing probe**

Open `eval/cq-conformance/capabilities.ts`, locate `C3_agentVariableShelf.runtimeData`.

**Step 2: Rewrite the probe**

Replace the body (lines ~380-406) with:

```ts
  runtimeData: ({ prepared }) => {
    const totalDatasets = prepared.seed.datasets.length;
    // Series-backed shelf is the single source of truth: a dataset contributes
    // to an agent's variable shelf iff some series.datasetId points at it and
    // its variableId resolves. After SKY-317 this union covers both legacy
    // Dataset.variableIds and series-derived membership.
    let datasetsWithShelf = 0;
    for (const dataset of prepared.seed.datasets) {
      const shelf = prepared.variablesByDatasetId.get(dataset.id);
      if (shelf !== undefined && Array.from(shelf).length > 0) {
        datasetsWithShelf++;
      }
    }

    if (datasetsWithShelf === 0) {
      return {
        status: "fail",
        summary: `0 of ${totalDatasets} datasets have a variable shelf — Dataset → Variable edge is empty`,
        detail:
          "Every Agent's variable shelf is empty in the runtime registry. " +
          "narrowCandidatesByAgent in Bind.ts is structurally a no-op until " +
          "the series→dataset backfill (SKY-317) or Dataset.variableIds is populated.",
        metric: 0
      };
    }

    return {
      status: datasetsWithShelf === totalDatasets ? "pass" : "amber",
      summary: `${datasetsWithShelf} / ${totalDatasets} datasets carry a variable shelf (series-backed or Dataset.variableIds)`,
      metric: datasetsWithShelf
    };
  },
```

Note: `Array.from(shelf).length > 0` is the right emptiness check because `shelf` is a `Chunk<Variable>`. Use `Chunk.size(shelf) > 0` if you prefer — both work.

**Step 3: Run typecheck and the eval unit tests**

Run: `bun run typecheck`
Expected: clean.

Run: `bun run test`
Expected: all green. The capabilities.ts change is not directly unit-tested in this PR, but `bun run test` will catch any type drift.

**Step 4: Re-run the CQ conformance harness and inspect the C3 row**

Run: `bun run eval:cq-conformance` (or whatever the existing harness entry point is — check `package.json` scripts; if the harness is invoked via `bun eval/cq-conformance/run.ts`, run that instead).

Expected: the harness produces a new run under `eval/cq-conformance/runs/<timestamp>/`. Open the resulting matrix/report and confirm that capability `agent-variable-shelf` runtimeData has moved from `fail` ("0 of 1430 datasets populate variableIds") to `amber` with a metric of exactly **7** (the number of series-backed dataset links we just added).

If the metric is 0, the backfill didn't land in the registry — check Task 4. If the metric is more than 7, another code path is populating the shelf and that needs investigation before we claim this change is conservative.

**Step 5: Commit**

```bash
git add eval/cq-conformance/capabilities.ts
git commit -m "SKY-317: flip agent-variable-shelf probe onto series-backed membership

The runtimeData probe now counts datasets whose variable shelf is
non-empty via prepared.variablesByDatasetId (the union of
Dataset.variableIds and series-derived membership), not the raw
Dataset.variableIds field. After the SKY-317 backfill this reports 7/1430
real shelves instead of 0/1430 structural failure.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

If the harness also produced new JSON/snapshot files under `eval/cq-conformance/runs/`, decide whether to commit the new run or not. The existing pattern (see working tree) is that runs are untracked artifacts — **do not commit run directories** unless you explicitly want a frozen baseline.

---

### Task 7: Extend `scripts/generate-series.ts` to understand the backfill manifest

Make the generator read `.series-dataset-backfill.json` and emit `datasetId` in any regenerated series file. This keeps the script idempotent: if someone reruns it, they reproduce the current checked-in state.

**Files:**
- Modify: `scripts/generate-series.ts`

**Step 1: Read the existing script**

Understand the `SeriesDef` interface and `SERIES` array. You'll be adding an optional `datasetSlug?: string` field per entry (populated only for the 7 backfilled series) and threading it through the JSON emit step.

**Step 2: Make the script read existing IDs and datasetIds**

```ts
// Near the top, after the existing varIds load:
import { existsSync } from "node:fs";

const existingSeriesIds: Record<string, string> = existsSync(
  join(ROOT, ".series-ids.json")
)
  ? JSON.parse(readFileSync(join(ROOT, ".series-ids.json"), "utf-8"))
  : {};

const backfillPath = join(ROOT, ".series-dataset-backfill.json");
const backfillManifest: {
  explicit: Record<
    string,
    { datasetId: string; datasetFile: string; evidence: string }
  >;
} = existsSync(backfillPath)
  ? JSON.parse(readFileSync(backfillPath, "utf-8"))
  : { explicit: {} };
```

Replace the `mintId()` call inside the loop with an ID-preserving version:

```ts
function idFor(slug: string): string {
  const existing = existingSeriesIds[slug];
  if (existing !== undefined) return existing;
  return `https://id.skygest.io/series/ser_${ulid()}`;
}
```

And add the datasetId to the emitted JSON:

```ts
const datasetId = backfillManifest.explicit[s.slug]?.datasetId;
const out: Record<string, unknown> = {
  _tag: "Series",
  id,
  label: s.label,
  variableId: varId
};
if (datasetId !== undefined) {
  out.datasetId = datasetId;
}
out.fixedDims = fixedDims;
out.aliases = [];
out.createdAt = TS;
out.updatedAt = TS;
writeFileSync(join(ROOT, `${s.slug}.json`), JSON.stringify(out, null, 2) + "\n");
```

Field order in the emitted JSON must exactly match the hand-edited files from Task 4 (`_tag, id, label, variableId, datasetId?, fixedDims, aliases, createdAt, updatedAt`). This is the single biggest source of diff churn — verify by eye before running the script.

**Step 3: Dry-run against a scratch directory first**

Don't let the script overwrite your 7 hand-edited files without a check. Copy them to a scratch dir, run the script pointing at that dir, and `diff` the result:

```bash
mkdir -p /tmp/sky317-scratch
cp references/cold-start/series/*.json /tmp/sky317-scratch/
cp references/cold-start/series/.series-ids.json /tmp/sky317-scratch/
cp references/cold-start/series/.series-dataset-backfill.json /tmp/sky317-scratch/
# Temporarily point the script's ROOT at the scratch dir (hand edit, revert after)
# OR: add a --out flag to the script
```

Actually — the simpler approach: add a `--dry-run` or `--out` flag via `process.argv`. Or skip the script-idempotency work for this PR entirely if it grows too big (see **Abort condition** below).

**Abort condition:** If Step 3 takes more than 20 minutes or introduces diff churn you can't quickly explain, **skip Task 7 entirely**. The script is a one-shot tool; leaving it behind with a TODO comment is acceptable. The 7 hand-edited files and the backfill manifest are the source of truth. In that case, add a comment at the top of `scripts/generate-series.ts`:

```ts
// TODO(SKY-317-followup): this script is not idempotent. It does not emit
// datasetId and will mint new ULIDs if rerun. Do NOT rerun without first
// reconciling against references/cold-start/series/.series-ids.json and
// .series-dataset-backfill.json.
```

and commit just the comment:

```bash
git add scripts/generate-series.ts
git commit -m "SKY-317: flag scripts/generate-series.ts as non-idempotent

Leaves the script alone for this PR; adds a warning comment. Updating the
script to reuse existing IDs and emit datasetId is follow-up work.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

**Step 4 (if Task 7 completes fully): Run the script and confirm zero diff**

Run: `bun scripts/generate-series.ts`

Then: `git diff references/cold-start/series/`

Expected: no diff, or only whitespace-level diffs you can justify.

**Step 5: Commit**

```bash
git add scripts/generate-series.ts
git commit -m "SKY-317: make generate-series.ts idempotent and datasetId-aware

Reuses IDs from .series-ids.json and emits datasetId from
.series-dataset-backfill.json. Rerunning the script is now a no-op against
the current checked-in state.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Add a coverage audit test

Surface the backfill gaps — the 5 split + 1 corpus-error + 13 zero-evidence series — as a visible audit, not a silent omission. This is the "audit / coverage reporting" required by SKY-317's acceptance criteria.

**Files:**
- Modify: `tests/cold-start-validation.test.ts`

**Step 1: Write the coverage audit test**

Append a new test case to the existing `describe("Cold-start validation", ...)` block:

```ts
  it("reports series→dataset backfill coverage", async () => {
    const registry = await Effect.runPromise(
      loadCheckedInDataLayerRegistry().pipe(Effect.provide(localFileSystemLayer))
    );
    const seriesEntities = registry.seed.series;
    const total = seriesEntities.length;
    const linked = seriesEntities.filter((s) => s.datasetId !== undefined).length;
    const unlinked = seriesEntities.filter((s) => s.datasetId === undefined).length;

    // Load the backfill manifest to cross-check
    const manifestRaw = await readFile(
      join(ROOT, "series", ".series-dataset-backfill.json"),
      "utf-8"
    );
    const manifest = JSON.parse(manifestRaw) as {
      explicit: Record<string, unknown>;
      deliberatelyOmitted: Record<string, unknown>;
      zeroEvidence: ReadonlyArray<string>;
    };

    const expectedLinked = Object.keys(manifest.explicit).length;
    const expectedUnlinked =
      Object.keys(manifest.deliberatelyOmitted).length + manifest.zeroEvidence.length;

    // Coverage numbers must match the manifest exactly — any drift means either
    // a fixture changed or the manifest is stale.
    expect(total).toBe(expectedLinked + expectedUnlinked);
    expect(linked).toBe(expectedLinked);
    expect(unlinked).toBe(expectedUnlinked);

    // Log the coverage for visibility in CI output
    console.log(
      `[SKY-317 coverage] series.datasetId: ${linked}/${total} linked, ${unlinked} unlinked ` +
        `(${Object.keys(manifest.deliberatelyOmitted).length} deliberately omitted, ${manifest.zeroEvidence.length} zero-evidence)`
    );
  }, coldStartValidationTimeoutMs);
```

Note: this test does **not** fail when coverage is incomplete — it asserts the observed state equals the manifest. That's the right call. Coverage can only improve by explicit manifest changes (which require human review of new candidate evidence).

**Step 2: Run the test**

Run: `bun run test -- tests/cold-start-validation.test.ts`

Expected: all existing cold-start tests pass + the new coverage audit logs `[SKY-317 coverage] series.datasetId: 7/25 linked, 18 unlinked (5 deliberately omitted, 13 zero-evidence)`.

**Step 3: Run the full suite one more time**

Run: `bun run typecheck && bun run test`

Expected: fully green.

**Step 4: Commit**

```bash
git add tests/cold-start-validation.test.ts
git commit -m "SKY-317: add series→dataset coverage audit test

Reports 7/25 linked, 18 unlinked (5 deliberately omitted, 13 zero-evidence).
Fails if the observed state diverges from the checked-in backfill manifest.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Final verification and PR prep

**Step 1: Run the whole suite once more from a clean shell**

```bash
bun run typecheck
bun run test
```

Expected: typecheck clean, ~1290 tests passing (1283 pre-SKY-317 + 2 from Task 3 that weren't there before + 2 from Task 5 + 1 from Task 8 = ~1290, depending on how you split describe blocks).

**Step 2: Review the diff end-to-end**

```bash
git log --oneline sky-321/data-layer-spine-manifest-contract...main
git diff main...HEAD --stat
```

Expected: the branch now contains two logical chunks:
1. The SKY-320 structural codegen slice (the uncommitted stuff you started with — commit it before opening the PR if it isn't already).
2. The 7-commit SKY-317 chain from this plan.

Confirm no stray edits to files outside the intended scope (especially: no changes to `src/domain/dataLayerSpineManifest.ts`, no manifest version bump, no `Series.datasetId` flipped to required).

**Step 3: Decide the PR strategy and ask the user**

Two options:

- **Option A:** Split the branch into two PRs by rebasing SKY-317 onto a separate branch. Cleaner history, matches Linear branching convention.
- **Option B:** Keep everything on `sky-321/...`, rename the branch locally to something like `sky-317/series-dataset-backfill`, and open one large PR that covers SKY-320 + SKY-317.

Do not open any PR without the user's confirmation of the split strategy.

**Step 4: Run the audit script one last time and paste its output into the PR description**

```bash
bun scripts/audit-series-dataset-evidence.ts
```

Include the full output in the PR description so reviewers can see the exact evidence matrix without re-running anything.

---

## 2. What we are deliberately NOT testing

- **No test enforces that 13 zero-evidence series eventually get linked.** That is a coverage question, not a correctness question. Making this a hard test would force fabrication.
- **No test enforces that the 5 split-vote series get resolved.** Same reason. The coverage audit logs them; resolution belongs to SKY-215 corpus hygiene.
- **No test enforces that `dataset.variableIds` is populated.** SKY-317 acceptance explicitly says "do not silently trust it over series-derived membership" and explicitly leaves `Dataset.variableIds` in place for the transition.
- **No test enforces `Series.datasetId !== undefined` globally.** That becomes a test **after** the tightening follow-up ticket (the "make mandatory" step on your item list).
- **No end-to-end gold-row eval pass.** SKY-317 acceptance specifically says "The ticket does not over-claim gold accuracy gains beyond the publishers actually covered by checked-in Series." We're restoring the *structural* non-emptiness of the shelf; gold-row gains come from parallel data work.

## 3. Rollback

Every task is a single commit and every task is independent of its successors (except the test in Task 3 which depends on the manifest in Task 2). Rollback is `git revert <sha>` on the offending commit.

The 7 series JSON edits in Task 4 are the only change that affects runtime data shape. If those need to be reverted, revert the Task 4 commit; the tests in Tasks 3, 5, 8 will start failing loudly, which is exactly what you want.

## 4. Acceptance checklist (mirrors SKY-317 Linear ticket)

- [x] Generated/runtime Series carries `datasetId` as optional — **already done in SKY-320 slice** (working tree).
- [x] Registry prepare path derives shelves from series-backed membership — **already done in SKY-320 slice**.
- [x] Missing `datasetId` is tolerated, dangling `datasetId` fails checked-in validation — **already done in SKY-320 slice** (`src/resolution/dataLayerRegistry.ts:387-390`).
- [ ] For linked publishers, `findVariablesByAgentId` returns a non-empty result — **Task 5**.
- [ ] CQ conformance harness reports real partial coverage for `agent-variable-shelf` instead of structural empty — **Task 6**.
- [ ] Ticket does not over-claim gold accuracy gains — **Task 9 PR description only claims the 5 publishers actually linked**.
- [ ] `bun run typecheck` and `bun run test` stay green — **every task**.

## 5. References

- SKY-317 Linear ticket: https://linear.app/pure-logic-industrial/issue/SKY-317
- SKY-320 structural codegen plan: `docs/plans/2026-04-13-sky-320-structural-codegen-plan.md`
- SKY-215 corpus provenance: commits `a326b9f6`, `12297719`, `1f9ba65e` (`feat: data intelligence layer schemas + canonical post survey`).
- Cold-start README: `references/cold-start/README.md`
- CQ conformance capabilities: `eval/cq-conformance/capabilities.ts:372-450` (C3 definition)
- Registry derivation logic: `src/resolution/dataLayerRegistry.ts:570-604` (series→dataset loops) and `:652-679` (agent shelf aggregation).
