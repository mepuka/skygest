/**
 * Lift CQ verdicts from the ontology_skill validation reports.
 *
 * The skygest-energy-vocab repo runs SPARQL/SHACL CQ tests offline and writes
 * the results into markdown tables (see
 * `ontology_skill/ontologies/skygest-energy-vocab/docs/validation-report*.md`).
 * The conformance harness consumes those reports verbatim — it does not
 * re-evaluate SPARQL. A CQ that the vocab repo says PASS is the
 * `vocabulary` lane verdict for the capability that depends on it.
 *
 * Row format we parse:
 *
 *     | CQ-058 | PASS | EnergyDataset has dct:publisher restriction ... |
 *     | CQ-006 | Collision query returns 0 (build prevents collisions) | Revisit CQ |
 *
 * The first form is "result tables" (status in column 2). The second form is
 * "pre-existing failures" tables where the very presence of the row implies
 * `fail` and column 2 is the reason. We detect which form a row is in by
 * looking at column 2 — a known status word means form 1, anything else means
 * form 2.
 *
 * If a CQ appears in multiple reports the latest verdict wins, where "latest"
 * means processed last; the harness passes report contents in chronological
 * order.
 */

export type VocabVerdictStatus = "pass" | "fail" | "unknown";

export type VocabVerdict = {
  readonly cqId: string;
  readonly status: VocabVerdictStatus;
  readonly reason: string;
  readonly sourceReport: string;
};

export type VocabVerdictIndex = ReadonlyMap<string, VocabVerdict>;

const STATUS_WORDS: ReadonlyMap<string, VocabVerdictStatus> = new Map([
  ["pass", "pass"],
  ["fail", "fail"],
  ["✅", "pass"],
  ["❌", "fail"]
]);

const CQ_ROW_PATTERN = /^\|\s*(CQ-\d+(?:\/\d+)*)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/u;

const parseStatusCell = (
  cell: string
): { status: VocabVerdictStatus; usedAsStatus: boolean } => {
  const normalized = cell.trim().toLowerCase();
  const known = STATUS_WORDS.get(normalized);
  if (known !== undefined) {
    return { status: known, usedAsStatus: true };
  }

  return { status: "fail", usedAsStatus: false };
};

const expandSlashedIds = (rawId: string): ReadonlyArray<string> => {
  // Some pre-existing-failure rows pack multiple CQs into one cell:
  // `CQ-012/013/014`. Each one gets the same verdict.
  if (!rawId.includes("/")) {
    return [rawId];
  }

  const parts = rawId.split("/");
  const head = parts[0]!;
  const prefix = head.slice(0, head.lastIndexOf("-") + 1);
  return parts.map((part) => (part.includes("-") ? part : `${prefix}${part}`));
};

/**
 * Parse one validation-report markdown file into per-CQ verdicts.
 *
 * Returns one verdict per CQ row found. Tables we don't recognize are
 * silently skipped — only rows starting with `| CQ-NNN` and matching the
 * three-column pipe shape are considered.
 */
export const parseValidationReport = (
  reportPath: string,
  contents: string
): ReadonlyArray<VocabVerdict> => {
  const verdicts: Array<VocabVerdict> = [];

  for (const rawLine of contents.split(/\r?\n/u)) {
    const match = CQ_ROW_PATTERN.exec(rawLine);
    if (match === null) {
      continue;
    }

    const [, rawId, statusCell, descriptionCell] = match;
    if (rawId === undefined || statusCell === undefined || descriptionCell === undefined) {
      continue;
    }

    const parsed = parseStatusCell(statusCell);
    const reason = parsed.usedAsStatus ? descriptionCell.trim() : statusCell.trim();

    for (const cqId of expandSlashedIds(rawId)) {
      verdicts.push({
        cqId,
        status: parsed.status,
        reason,
        sourceReport: reportPath
      });
    }
  }

  return verdicts;
};

/**
 * Merge per-report verdicts into a single CQ → verdict index. The merge rule
 * is "later wins": when the same CQ is reported in multiple files, the entry
 * appearing last in `reports` overrides the earlier ones. The harness passes
 * reports in chronological order so a regression in a newer report supersedes
 * a stale pass in an older one.
 */
export const mergeVocabVerdicts = (
  reports: ReadonlyArray<{ readonly path: string; readonly contents: string }>
): VocabVerdictIndex => {
  const index = new Map<string, VocabVerdict>();
  for (const report of reports) {
    for (const verdict of parseValidationReport(report.path, report.contents)) {
      index.set(verdict.cqId, verdict);
    }
  }
  return index;
};
