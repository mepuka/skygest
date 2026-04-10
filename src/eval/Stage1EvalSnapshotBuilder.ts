import { Effect, FileSystem, Result } from "effect";
import type {
  PostEnrichmentResult,
  SourceAttributionEnrichment,
  VisionEnrichment
} from "../domain/enrichment";
import type {
  ResolverGoldSetEntry,
  ResolverGoldSetManifest,
  Stage1EvalSnapshotBuildDiagnostic,
  Stage1EvalSnapshotRow
} from "../domain/stage1Eval";
import {
  ResolverGoldSetManifest as ResolverGoldSetManifestSchema,
  Stage1EvalSnapshotBuildError,
  Stage1EvalSnapshotRow as Stage1EvalSnapshotRowSchema
} from "../domain/stage1Eval";
import { CandidatePayloadService } from "../services/CandidatePayloadService";
import { KnowledgeRepo } from "../services/KnowledgeRepo";
import { PostEnrichmentReadService } from "../services/PostEnrichmentReadService";
import {
  decodeJsonStringEitherWith,
  encodeJsonStringWith,
  formatSchemaParseError,
  stringifyUnknown,
  stripUndefined
} from "../platform/Json";
import { extractPostLinkCards } from "../enrichment/PostContextSignals";

const decodeGoldSetManifestJson = decodeJsonStringEitherWith(
  ResolverGoldSetManifestSchema
);
const encodeSnapshotRowJson = encodeJsonStringWith(Stage1EvalSnapshotRowSchema);

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);

const buildSlug = (entry: ResolverGoldSetEntry, index: number) => {
  const seed =
    entry.handle ??
    entry.publisher ??
    entry.uri.split("/").pop() ??
    `case-${index + 1}`;
  const safeSeed = slugify(seed);
  return `${String(index + 1).padStart(3, "0")}-${safeSeed || "post"}`;
};

const isTwitterUri = (postUri: string) => postUri.startsWith("x://");

const selectLatestEnrichment = <
  TKind extends PostEnrichmentResult["kind"],
  TPayload extends TKind extends "vision"
    ? VisionEnrichment
    : TKind extends "source-attribution"
      ? SourceAttributionEnrichment
      : never
>(
  enrichments: ReadonlyArray<PostEnrichmentResult>,
  kind: TKind
): TPayload | null => {
  let selected: TPayload | null = null;
  let selectedEnrichedAt = Number.NEGATIVE_INFINITY;

  for (const enrichment of enrichments) {
    if (enrichment.kind !== kind) {
      continue;
    }

    if (enrichment.enrichedAt >= selectedEnrichedAt) {
      selected = enrichment.payload as TPayload;
      selectedEnrichedAt = enrichment.enrichedAt;
    }
  }

  return selected;
};

const formatDiagnostic = (diagnostic: Stage1EvalSnapshotBuildDiagnostic) => {
  switch (diagnostic._tag) {
    case "ManifestReadDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.manifestPath}: ${diagnostic.message}`;
    case "ManifestDecodeDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.manifestPath}: ${diagnostic.message}`;
    case "SnapshotWriteDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.outputPath}: ${diagnostic.message}`;
    case "UnsupportedPostSourceDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.slug} ${diagnostic.postUri}: ${diagnostic.source} posts are not supported by the snapshot builder`;
    case "MissingStoredPostDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.slug} ${diagnostic.postUri}: no stored post row found`;
    case "MissingPostTextDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.slug} ${diagnostic.postUri}: stored post text was blank`;
    case "MissingLinksDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.slug} ${diagnostic.postUri}: stored post links were empty`;
    case "MissingCandidatePayloadDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.slug} ${diagnostic.postUri}: candidate payload was missing`;
    case "MissingLinkCardsDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.slug} ${diagnostic.postUri}: payload did not yield any link cards`;
    case "MissingVisionDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.slug} ${diagnostic.postUri}: vision enrichment was missing`;
    case "MissingSourceAttributionDiagnostic":
      return `[${diagnostic.code}] ${diagnostic.slug} ${diagnostic.postUri}: source-attribution enrichment was missing`;
  }
};

const makeBuildError = (input: {
  readonly diagnostics: ReadonlyArray<Stage1EvalSnapshotBuildDiagnostic>;
  readonly manifestPath?: string;
  readonly outputPath?: string;
}) =>
  new Stage1EvalSnapshotBuildError({
    message: `Stage 1 snapshot build failed with ${String(input.diagnostics.length)} diagnostic(s)\n${input.diagnostics.map((diagnostic) => `- ${formatDiagnostic(diagnostic)}`).join("\n")}`,
    report: stripUndefined({
      manifestPath: input.manifestPath,
      outputPath: input.outputPath,
      diagnostics: [...input.diagnostics]
    })
  });

type RowBuildOutcome = {
  readonly row: Stage1EvalSnapshotRow | null;
  readonly diagnostics: ReadonlyArray<Stage1EvalSnapshotBuildDiagnostic>;
};

const unsupportedPostSourceDiagnostic = (
  slug: string,
  postUri: ResolverGoldSetEntry["uri"]
): Stage1EvalSnapshotBuildDiagnostic => ({
  _tag: "UnsupportedPostSourceDiagnostic",
  code: "unsupported-post-source",
  slug,
  postUri,
  source: "twitter"
});

const missingStoredPostDiagnostic = (
  slug: string,
  postUri: ResolverGoldSetEntry["uri"]
): Stage1EvalSnapshotBuildDiagnostic => ({
  _tag: "MissingStoredPostDiagnostic",
  code: "missing-stored-post",
  slug,
  postUri
});

const missingPostTextDiagnostic = (
  slug: string,
  postUri: ResolverGoldSetEntry["uri"]
): Stage1EvalSnapshotBuildDiagnostic => ({
  _tag: "MissingPostTextDiagnostic",
  code: "missing-post-text",
  slug,
  postUri
});

const missingLinksDiagnostic = (
  slug: string,
  postUri: ResolverGoldSetEntry["uri"]
): Stage1EvalSnapshotBuildDiagnostic => ({
  _tag: "MissingLinksDiagnostic",
  code: "missing-links",
  slug,
  postUri
});

const missingCandidatePayloadDiagnostic = (
  slug: string,
  postUri: ResolverGoldSetEntry["uri"]
): Stage1EvalSnapshotBuildDiagnostic => ({
  _tag: "MissingCandidatePayloadDiagnostic",
  code: "missing-candidate-payload",
  slug,
  postUri
});

const missingLinkCardsDiagnostic = (
  slug: string,
  postUri: ResolverGoldSetEntry["uri"]
): Stage1EvalSnapshotBuildDiagnostic => ({
  _tag: "MissingLinkCardsDiagnostic",
  code: "missing-link-cards",
  slug,
  postUri
});

const missingVisionDiagnostic = (
  slug: string,
  postUri: ResolverGoldSetEntry["uri"]
): Stage1EvalSnapshotBuildDiagnostic => ({
  _tag: "MissingVisionDiagnostic",
  code: "missing-vision",
  slug,
  postUri
});

const missingSourceAttributionDiagnostic = (
  slug: string,
  postUri: ResolverGoldSetEntry["uri"]
): Stage1EvalSnapshotBuildDiagnostic => ({
  _tag: "MissingSourceAttributionDiagnostic",
  code: "missing-source-attribution",
  slug,
  postUri
});

const buildSnapshotRow = Effect.fn(
  "Stage1EvalSnapshotBuilder.buildSnapshotRow"
)(
  function* (entry: ResolverGoldSetEntry, index: number) {
    const knowledgeRepo = yield* KnowledgeRepo;
    const payloadService = yield* CandidatePayloadService;
    const enrichmentReadService = yield* PostEnrichmentReadService;

    const slug = buildSlug(entry, index);

    if (isTwitterUri(entry.uri)) {
      return {
        row: null,
        diagnostics: [unsupportedPostSourceDiagnostic(slug, entry.uri)]
      };
    }

    const post = yield* knowledgeRepo.getPostByUri(entry.uri);
    if (post === null) {
      return {
        row: null,
        diagnostics: [missingStoredPostDiagnostic(slug, entry.uri)]
      };
    }

    const diagnostics: Array<Stage1EvalSnapshotBuildDiagnostic> = [];

    if (post.text.trim().length === 0) {
      diagnostics.push(missingPostTextDiagnostic(slug, entry.uri));
    }

    const links = yield* knowledgeRepo.getLinksByPostUri(entry.uri);
    if (links.length === 0) {
      diagnostics.push(missingLinksDiagnostic(slug, entry.uri));
    }

    const payload = yield* payloadService.getPayload(entry.uri);
    const linkCards =
      payload === null ? [] : extractPostLinkCards(payload.embedPayload);

    if (payload === null) {
      diagnostics.push(missingCandidatePayloadDiagnostic(slug, entry.uri));
    } else if (linkCards.length === 0) {
      diagnostics.push(missingLinkCardsDiagnostic(slug, entry.uri));
    }

    const enrichmentState = yield* enrichmentReadService.getPost(entry.uri);
    const vision = selectLatestEnrichment(enrichmentState.enrichments, "vision");
    const sourceAttribution = selectLatestEnrichment(
      enrichmentState.enrichments,
      "source-attribution"
    );

    if (vision === null) {
      diagnostics.push(missingVisionDiagnostic(slug, entry.uri));
    }

    if (sourceAttribution === null) {
      diagnostics.push(missingSourceAttributionDiagnostic(slug, entry.uri));
    }

    if (diagnostics.length > 0) {
      return { row: null, diagnostics };
    }

    return {
      row: {
        slug,
        postUri: entry.uri,
        metadata: stripUndefined({
          handle: entry.handle ?? post.handle ?? null,
          publisher: entry.publisher ?? null,
          includesLanes: entry.includesLanes,
          notes: entry.notes ?? null
        }),
        postContext: {
          postUri: entry.uri,
          text: post.text,
          links,
          linkCards,
          threadCoverage: "focus-only" as const
        },
        vision,
        sourceAttribution
      },
      diagnostics: []
    };
  }
);

export const loadResolverGoldSetManifest = Effect.fn(
  "Stage1EvalSnapshotBuilder.loadResolverGoldSetManifest"
)(
  function* (manifestPath: string) {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(manifestPath).pipe(
      Effect.mapError((error) =>
        makeBuildError({
          manifestPath,
          diagnostics: [
            {
              _tag: "ManifestReadDiagnostic",
              code: "manifest-read-failed",
              manifestPath,
              message: stringifyUnknown(error)
            }
          ]
        })
      )
    );

    const decoded = decodeGoldSetManifestJson(raw);
    if (Result.isFailure(decoded)) {
      return yield* makeBuildError({
        manifestPath,
        diagnostics: [
          {
            _tag: "ManifestDecodeDiagnostic",
            code: "manifest-decode-failed",
            manifestPath,
            message: formatSchemaParseError(decoded.failure)
          }
        ]
      });
    }

    return decoded.success;
  }
);

export const buildStage1EvalSnapshotRows = Effect.fn(
  "Stage1EvalSnapshotBuilder.buildStage1EvalSnapshotRows"
)(
  function* (input: {
    readonly goldSet: ResolverGoldSetManifest;
    readonly manifestPath?: string;
    readonly outputPath?: string;
  }) {
    const outcomes = yield* Effect.forEach(input.goldSet, (entry, index) =>
      buildSnapshotRow(entry, index)
    );

    const diagnostics = outcomes.flatMap((outcome) => outcome.diagnostics);
    if (diagnostics.length > 0) {
      return yield* makeBuildError({
        diagnostics,
        ...(input.manifestPath === undefined
          ? {}
          : { manifestPath: input.manifestPath }),
        ...(input.outputPath === undefined
          ? {}
          : { outputPath: input.outputPath })
      });
    }

    return outcomes.flatMap((outcome) =>
      outcome.row === null ? [] : [outcome.row]
    );
  }
);

export const writeStage1EvalSnapshotRows = Effect.fn(
  "Stage1EvalSnapshotBuilder.writeStage1EvalSnapshotRows"
)(
  function* (
    outputPath: string,
    rows: ReadonlyArray<Stage1EvalSnapshotRow>
  ) {
    const fs = yield* FileSystem.FileSystem;
    const payload = rows.map((row) => encodeSnapshotRowJson(row)).join("\n");

    yield* fs.writeFileString(
      outputPath,
      payload.length === 0 ? "" : `${payload}\n`
    ).pipe(
      Effect.mapError((error) =>
        makeBuildError({
          outputPath,
          diagnostics: [
            {
              _tag: "SnapshotWriteDiagnostic",
              code: "snapshot-write-failed",
              outputPath,
              message: stringifyUnknown(error)
            }
          ]
        })
      )
    );
  }
);

export const buildStage1EvalSnapshot = Effect.fn(
  "Stage1EvalSnapshotBuilder.buildStage1EvalSnapshot"
)(
  function* (input: {
    readonly manifestPath: string;
    readonly outputPath: string;
  }) {
    const goldSet = yield* loadResolverGoldSetManifest(input.manifestPath);
    const rows = yield* buildStage1EvalSnapshotRows({
      goldSet,
      manifestPath: input.manifestPath,
      outputPath: input.outputPath
    });

    yield* writeStage1EvalSnapshotRows(input.outputPath, rows);

    return {
      rows,
      rowCount: rows.length,
      manifestPath: input.manifestPath,
      outputPath: input.outputPath
    } as const;
  }
);
