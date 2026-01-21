import {
  compiledPaperPatterns,
  compiledContentPatterns,
  pdfExclusions
} from "./paperPatterns";

export const buildSearchText = (record: Record<string, any>): string => {
  const text = String(record.text ?? "").toLowerCase();
  const urls = Array.isArray(record.urls) ? record.urls.map((u: string) => u.toLowerCase()).join(" ") : "";
  const tags = Array.isArray(record.tags) ? record.tags.map((t: string) => t.toLowerCase()).join(" ") : "";
  const labels = Array.isArray(record.label_values) ? record.label_values.map((t: string) => t.toLowerCase()).join(" ") : "";
  const embed = record.embed ?? {};
  const external = embed.external ?? {};
  const externalUri = String(external.uri ?? "").toLowerCase();
  const externalTitle = String(external.title ?? "").toLowerCase();
  const externalDescription = String(external.description ?? "").toLowerCase();
  const quoted = embed.record ?? {};
  const quotedText = String(quoted.text ?? "").toLowerCase();
  const quotedUri = String(quoted.uri ?? "").toLowerCase();

  return [
    text,
    urls,
    tags,
    labels,
    externalUri,
    externalTitle,
    externalDescription,
    quotedText,
    quotedUri
  ].join(" ");
};

const isExcludedPdf = (match: string) =>
  Array.from(pdfExclusions).some((domain) => match.includes(domain));

export const containsPaperLink = (searchText: string): boolean => {
  const hasPaperLink = compiledPaperPatterns.some((pattern) => {
    const match = pattern.exec(searchText);
    if (!match) return false;
    if (match[0].includes(".pdf") && isExcludedPdf(match[0])) return false;
    return true;
  });

  const contentMatches = compiledContentPatterns.filter((pattern) =>
    pattern.test(searchText)
  ).length;

  return hasPaperLink || contentMatches >= 3;
};
