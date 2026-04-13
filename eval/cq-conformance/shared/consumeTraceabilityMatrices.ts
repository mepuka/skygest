/**
 * Lift `(stakeholder need → use case → CQ → ontology terms)` rows from the
 * vocab repo's traceability matrices.
 *
 * The vocab repo ships two CSV files:
 *
 *   - `traceability-matrix.csv`             — the original CQ-001..CQ-053 set
 *   - `traceability-matrix-dcat-extension.csv` — the DCAT extension CQ-054..CQ-068
 *
 * Format (header + body):
 *
 *     stakeholder_need,use_case_id,cq_id,ontology_terms,sparql_test
 *     "Disambiguate ...",UC-009,CQ-031,"MeasuredPropertyScheme;Generation;...",tests/cq-031.sparql
 *
 * The conformance harness uses these to surface, in the per-row matrix, *why*
 * a capability matters: every red cell links back through a CQ to the
 * stakeholder need that motivated it.
 *
 * This is a small bespoke parser rather than a CSV library because the input
 * is hand-authored and the column shape is fixed. We honour basic quoted
 * fields (with embedded commas) but do not try to handle escaped quotes —
 * none of the matrices use them.
 */

export type TraceabilityRow = {
  readonly stakeholderNeed: string;
  readonly useCaseId: string;
  readonly cqId: string;
  readonly ontologyTerms: ReadonlyArray<string>;
  readonly sparqlTest: string;
  readonly sourceMatrix: string;
};

export type TraceabilityIndex = {
  readonly all: ReadonlyArray<TraceabilityRow>;
  readonly byCqId: ReadonlyMap<string, TraceabilityRow>;
  readonly byUseCaseId: ReadonlyMap<string, ReadonlyArray<TraceabilityRow>>;
};

const splitCsvLine = (line: string): ReadonlyArray<string> => {
  const fields: Array<string> = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
};

const splitOntologyTerms = (cell: string): ReadonlyArray<string> =>
  cell
    .split(";")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

export const parseTraceabilityMatrix = (
  matrixPath: string,
  contents: string
): ReadonlyArray<TraceabilityRow> => {
  const lines = contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    return [];
  }

  // Skip the header row. We don't validate the header against an exact column
  // list — we just trust positional fields and emit warnings via the harness
  // if the row count is wrong.
  const rows: Array<TraceabilityRow> = [];
  for (let index = 1; index < lines.length; index++) {
    const fields = splitCsvLine(lines[index]!);
    if (fields.length < 5) {
      continue;
    }

    const [stakeholderNeed, useCaseId, cqId, ontologyTerms, sparqlTest] = fields as [
      string,
      string,
      string,
      string,
      string
    ];

    rows.push({
      stakeholderNeed: stakeholderNeed.trim(),
      useCaseId: useCaseId.trim(),
      cqId: cqId.trim(),
      ontologyTerms: splitOntologyTerms(ontologyTerms),
      sparqlTest: sparqlTest.trim(),
      sourceMatrix: matrixPath
    });
  }

  return rows;
};

/**
 * Combine every traceability matrix into a single index. When two matrices
 * cover the same CQ, the later one (last in the input array) wins for the
 * `byCqId` lookup but both rows are kept in `all`. The DCAT extension matrix
 * does not currently overlap with the main one, so this is mostly a safety
 * net.
 */
export const buildTraceabilityIndex = (
  matrices: ReadonlyArray<{ readonly path: string; readonly contents: string }>
): TraceabilityIndex => {
  const all: Array<TraceabilityRow> = [];
  for (const matrix of matrices) {
    for (const row of parseTraceabilityMatrix(matrix.path, matrix.contents)) {
      all.push(row);
    }
  }

  const byCqId = new Map<string, TraceabilityRow>();
  const byUseCaseId = new Map<string, Array<TraceabilityRow>>();

  for (const row of all) {
    byCqId.set(row.cqId, row);
    const bucket = byUseCaseId.get(row.useCaseId) ?? [];
    bucket.push(row);
    byUseCaseId.set(row.useCaseId, bucket);
  }

  return {
    all,
    byCqId,
    byUseCaseId: new Map(
      [...byUseCaseId.entries()].map(([key, value]) => [
        key,
        value as ReadonlyArray<TraceabilityRow>
      ])
    )
  };
};
