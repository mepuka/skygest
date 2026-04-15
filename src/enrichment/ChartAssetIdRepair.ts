import { Result, Schema } from "effect";
import { parseFeedImageUrl } from "../bluesky/BskyCdn";
import {
  chartAssetIdFromBluesky,
  mintPostSkygestUri,
  parseChartAssetId,
  parsePostSkygestUri,
  type ChartAssetId
} from "../domain/data-layer/post-ids";
import {
  EnrichmentOutput
} from "../domain/enrichment";
import type { PostUri } from "../domain/types";
import { formatSchemaParseError } from "../platform/Json";

const decodeEnrichmentOutput = Schema.decodeUnknownResult(EnrichmentOutput);
type EnrichmentOutputValue = Schema.Schema.Type<typeof EnrichmentOutput>;

const LEGACY_ASSET_KEY_PATTERN = /^(embed|media):(\d+):(.+)$/u;
const SERIES_ITEM_KEY_MARKER = ":series:";

type AssetReferenceScan = {
  readonly sawAssetReferenceField: boolean;
  readonly legacyAssetKeys: ReadonlySet<string>;
};

export type ChartAssetIdRepairReplacement = {
  readonly legacyAssetKey: string;
  readonly chartAssetId: ChartAssetId;
};

export type ChartAssetIdRepairResult =
  | {
      readonly _tag: "repaired";
      readonly payload: EnrichmentOutputValue;
      readonly replacements: ReadonlyArray<ChartAssetIdRepairReplacement>;
    }
  | {
      readonly _tag: "unchanged";
      readonly reason: "no-asset-references" | "already-canonical";
      readonly payload: EnrichmentOutputValue;
    }
  | {
      readonly _tag: "failed";
      readonly reason:
        | "invalid-payload"
        | "unsupported-post-uri"
        | "unparseable-legacy-asset-key"
        | "did-mismatch"
        | "invalid-rewritten-payload"
        | "legacy-references-remain";
      readonly message: string;
      readonly legacyAssetKeys: ReadonlyArray<string>;
    };

type ParsedLegacyAssetKey = {
  readonly source: "embed" | "media";
  readonly index: number;
  readonly stableRef: string;
};

const parseLegacyAssetKey = (value: string): ParsedLegacyAssetKey | null => {
  const match = LEGACY_ASSET_KEY_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const source = match[1];
  const rawIndex = match[2];
  const stableRef = match[3];
  if (
    (source !== "embed" && source !== "media") ||
    rawIndex === undefined ||
    stableRef === undefined ||
    stableRef.length === 0 ||
    stableRef === "missing-ref"
  ) {
    return null;
  }

  return {
    source,
    index: Number.parseInt(rawIndex, 10),
    stableRef
  };
};

const extractLegacyAssetKeyFromItemKey = (value: string): string | null => {
  const markerIndex = value.indexOf(SERIES_ITEM_KEY_MARKER);
  if (markerIndex <= 0) {
    return null;
  }

  const candidate = value.slice(0, markerIndex);
  return parseLegacyAssetKey(candidate) === null ? null : candidate;
};

const collectAssetReferenceScan = (value: unknown): AssetReferenceScan => {
  const legacyAssetKeys = new Set<string>();
  let sawAssetReferenceField = false;

  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }

    if (typeof current !== "object" || current === null) {
      return;
    }

    for (const [key, child] of Object.entries(current)) {
      if (key === "assetKey" && typeof child === "string") {
        sawAssetReferenceField = true;
        if (parseLegacyAssetKey(child) !== null) {
          legacyAssetKeys.add(child);
        }
      } else if (key === "assetKeys" && Array.isArray(child)) {
        sawAssetReferenceField = true;
        for (const entry of child) {
          if (typeof entry === "string" && parseLegacyAssetKey(entry) !== null) {
            legacyAssetKeys.add(entry);
          }
        }
      } else if (key === "itemKey" && typeof child === "string") {
        const legacyAssetKey = extractLegacyAssetKeyFromItemKey(child);
        if (legacyAssetKey !== null) {
          sawAssetReferenceField = true;
          legacyAssetKeys.add(legacyAssetKey);
        }
      }

      visit(child);
    }
  };

  visit(value);

  return {
    sawAssetReferenceField,
    legacyAssetKeys
  };
};

const replaceItemKeyPrefix = (
  value: string,
  replacements: ReadonlyMap<string, ChartAssetId>
): string => {
  for (const [legacyAssetKey, chartAssetId] of replacements.entries()) {
    if (value === legacyAssetKey) {
      return chartAssetId;
    }

    if (value.startsWith(`${legacyAssetKey}:`)) {
      return `${chartAssetId}${value.slice(legacyAssetKey.length)}`;
    }
  }

  return value;
};

const rewriteAssetReferences = (
  value: unknown,
  replacements: ReadonlyMap<string, ChartAssetId>
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteAssetReferences(item, replacements));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const next: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "assetKey" && typeof child === "string") {
      next[key] = replacements.get(child) ?? child;
      continue;
    }

    if (key === "assetKeys" && Array.isArray(child)) {
      next[key] = child.map((entry) =>
        typeof entry === "string" ? (replacements.get(entry) ?? entry) : entry
      );
      continue;
    }

    if (key === "itemKey" && typeof child === "string") {
      next[key] = replaceItemKeyPrefix(child, replacements);
      continue;
    }

    next[key] = rewriteAssetReferences(child, replacements);
  }

  return next;
};

const deriveReplacementMap = (
  postUri: PostUri,
  legacyAssetKeys: ReadonlySet<string>
):
  | {
      readonly _tag: "success";
      readonly replacements: ReadonlyMap<string, ChartAssetId>;
    }
  | {
      readonly _tag: "failure";
      readonly reason:
        | "unsupported-post-uri"
        | "unparseable-legacy-asset-key"
        | "did-mismatch";
      readonly message: string;
      readonly legacyAssetKeys: ReadonlyArray<string>;
    } => {
  const parsedPost = (() => {
    try {
      return parsePostSkygestUri(mintPostSkygestUri(postUri));
    } catch {
      return null;
    }
  })();

  if (parsedPost === null || parsedPost.platform !== "bluesky") {
    return {
      _tag: "failure",
      reason: "unsupported-post-uri",
      message: `Expected a Bluesky post URI, received ${postUri}`,
      legacyAssetKeys: [...legacyAssetKeys]
    };
  }

  const replacements = new Map<string, ChartAssetId>();

  for (const legacyAssetKey of legacyAssetKeys) {
    const parsedLegacy = parseLegacyAssetKey(legacyAssetKey);
    if (parsedLegacy === null) {
      return {
        _tag: "failure",
        reason: "unparseable-legacy-asset-key",
        message: `Could not parse legacy asset key ${legacyAssetKey}`,
        legacyAssetKeys: [legacyAssetKey]
      };
    }

    const imageUrl = parseFeedImageUrl(parsedLegacy.stableRef);
    if (imageUrl === null) {
      return {
        _tag: "failure",
        reason: "unparseable-legacy-asset-key",
        message: `Legacy asset key does not contain a parseable Bluesky feed image URL: ${legacyAssetKey}`,
        legacyAssetKeys: [legacyAssetKey]
      };
    }

    if (imageUrl.did !== parsedPost.did) {
      return {
        _tag: "failure",
        reason: "did-mismatch",
        message: `Legacy asset key DID ${imageUrl.did} does not match post URI DID ${parsedPost.did}`,
        legacyAssetKeys: [legacyAssetKey]
      };
    }

    replacements.set(
      legacyAssetKey,
      chartAssetIdFromBluesky(postUri, imageUrl.blobCid)
    );
  }

  return {
    _tag: "success",
    replacements
  };
};

export const repairChartAssetIdsForBlueskyPost = ({
  postUri,
  payload
}: {
  readonly postUri: PostUri;
  readonly payload: unknown;
}): ChartAssetIdRepairResult => {
  const scan = collectAssetReferenceScan(payload);

  if (scan.legacyAssetKeys.size === 0) {
    const decodedPayload = decodeEnrichmentOutput(payload);
    if (Result.isFailure(decodedPayload)) {
      return {
        _tag: "failed",
        reason: "invalid-payload",
        message: formatSchemaParseError(decodedPayload.failure),
        legacyAssetKeys: []
      };
    }

    return {
      _tag: "unchanged",
      reason: scan.sawAssetReferenceField
        ? "already-canonical"
        : "no-asset-references",
      payload: decodedPayload.success
    };
  }

  const replacementMap = deriveReplacementMap(postUri, scan.legacyAssetKeys);
  if (replacementMap._tag === "failure") {
    return {
      _tag: "failed",
      reason: replacementMap.reason,
      message: replacementMap.message,
      legacyAssetKeys: replacementMap.legacyAssetKeys
    };
  }

  const rewritten = rewriteAssetReferences(
    payload,
    replacementMap.replacements
  );

  const remainingLegacy = collectAssetReferenceScan(rewritten);
  if (remainingLegacy.legacyAssetKeys.size > 0) {
    return {
      _tag: "failed",
      reason: "legacy-references-remain",
      message: "Legacy asset references remain after rewrite",
      legacyAssetKeys: [...remainingLegacy.legacyAssetKeys]
    };
  }

  const decodedRewritten = decodeEnrichmentOutput(rewritten);
  if (Result.isFailure(decodedRewritten)) {
    return {
      _tag: "failed",
      reason: "invalid-rewritten-payload",
      message: formatSchemaParseError(decodedRewritten.failure),
      legacyAssetKeys: [...scan.legacyAssetKeys]
    };
  }

  for (const chartAssetId of replacementMap.replacements.values()) {
    if (parseChartAssetId(chartAssetId) === null) {
      return {
        _tag: "failed",
        reason: "invalid-rewritten-payload",
        message: `Rewritten chart asset id did not round-trip: ${chartAssetId}`,
        legacyAssetKeys: [...scan.legacyAssetKeys]
      };
    }
  }

  return {
    _tag: "repaired",
    payload: decodedRewritten.success,
    replacements: [...replacementMap.replacements.entries()].map(
      ([legacyAssetKey, chartAssetId]) => ({
        legacyAssetKey,
        chartAssetId
      })
    )
  };
};
