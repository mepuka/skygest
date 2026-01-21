export const paperPatterns = [
  "https?://[^\\s<>\"]+\\.pdf(?:[?#][^\\s<>\"]*)?\\b",
  "arxiv\\.org/(?:abs|pdf)/\\d{4}\\.\\d{4,5}",
  "doi\\.org/10\\.\\d{4,}/"
];

export const compiledPaperPatterns = paperPatterns.map((pattern) => new RegExp(pattern, "i"));
