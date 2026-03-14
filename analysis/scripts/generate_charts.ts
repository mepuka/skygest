/**
 * Generate pre-rendered SVG charts using Observable Plot.
 *
 * Usage: cd analysis && bun run scripts/generate_charts.ts
 */

import * as Plot from "@observablehq/plot";
import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dir, "..", "output", "data");
const OUT_DIR = join(import.meta.dir, "..", "output", "charts");

mkdirSync(OUT_DIR, { recursive: true });

const jsdom = new JSDOM("");
const document = jsdom.window.document;

// Palette derived from site CSS (navy/teal theme)
const C = {
  text: "#3d4852",
  muted: "#6b7280",
  blue: "#4a7fa5",
  coral: "#c5614a",
  amber: "#d4924b",
  sage: "#6a9e8e",
};

function extractSvg(plot: any): string {
  const html = plot.outerHTML;
  const match = html.match(/<svg[\s\S]*<\/svg>/);
  if (!match) throw new Error("No <svg> found in plot output");
  let svg = match[0];
  if (!svg.includes("xmlns="))
    svg = svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
}

function addLegend(
  svg: string,
  items: { label: string; color: string }[],
  opts: { x?: number; y?: number; gap?: number } = {}
): string {
  const x = opts.x ?? 20;
  const y = opts.y ?? 12;
  const gap = opts.gap ?? 100;

  const entries = items
    .map((item, i) => {
      const ix = x + i * gap;
      return [
        `<rect x="${ix}" y="${y}" width="12" height="12" rx="2" fill="${item.color}"/>`,
        `<text x="${ix + 16}" y="${y + 10}" text-anchor="start" font-size="12" font-family="system-ui, sans-serif" fill="${C.text}">${item.label}</text>`,
      ].join("");
    })
    .join("\n");

  return svg.replace("</svg>", `<g>\n${entries}\n</g>\n</svg>`);
}

function save(name: string, svg: string) {
  const path = join(OUT_DIR, `${name}.svg`);
  writeFileSync(path, svg);
  console.log(`  ${name}.svg`);
}

function cleanTitle(title: string, maxLen: number): string {
  let t = title.replace(/^\[(nature|biorxiv|arxiv)\]\s*/i, "");
  t = t.replace(/@[\w.-]+/g, "").trim();
  t = t.replace(/\s*\.\.\.?\s*$/, "").trim();
  if (t.length > maxLen) t = t.slice(0, maxLen - 1).trimEnd() + "\u2026";
  return t;
}

const STYLE = {
  fontFamily: "system-ui, sans-serif",
  fontSize: 12,
  background: "transparent",
  color: C.text,
};

// ── Hourly posting volume ──

function hourlySpike() {
  const raw: { hour: string; count: number }[] = JSON.parse(
    readFileSync(join(DATA_DIR, "posts_over_time.json"), "utf-8")
  );

  const byHour = new Map<number, number[]>();
  for (const d of raw) {
    const h = parseInt(d.hour.slice(11, 13), 10);
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(d.count);
  }

  const data = Array.from(byHour.entries())
    .map(([hour, counts]) => ({
      hour,
      mean: counts.reduce((a, b) => a + b, 0) / counts.length,
    }))
    .sort((a, b) => a.hour - b.hour);

  const plot = Plot.plot({
    document,
    width: 680,
    height: 340,
    marginLeft: 50,
    marginBottom: 36,
    marginTop: 16,
    marginRight: 16,
    x: {
      label: "Hour (UTC)",
      ticks: [0, 3, 6, 9, 12, 15, 18, 21],
      tickFormat: (d: number) => `${d.toString().padStart(2, "0")}:00`,
    },
    y: { label: "Mean posts / hour", grid: true },
    marks: [
      Plot.ruleY([0]),
      Plot.barY(data, {
        x: "hour",
        y: "mean",
        fill: (d: any) => (d.hour === 6 ? C.coral : C.blue),
        rx: 2,
      }),
      Plot.text(data.filter((d) => d.hour === 6), {
        x: "hour",
        y: "mean",
        dy: -10,
        text: (d: any) => `${Math.round(d.mean)}`,
        fontSize: 13,
        fontWeight: "bold",
        fill: C.coral,
      }),
    ],
    style: STYLE,
  });

  save("hourly_spike", extractSvg(plot));
}

// ── Source distribution ──

function sourceDistribution() {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, "source_breakdown.json"), "utf-8")
  );
  const total = raw.sources.reduce((a: number, s: any) => a + s.count, 0);
  const sorted = [...raw.sources].sort((a: any, b: any) => b.count - a.count);
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7).reduce((a: number, s: any) => a + s.count, 0);

  const data = [
    ...top.map((s: any) => ({
      source: s.name,
      count: s.count,
      pct: ((s.count / total) * 100).toFixed(1),
    })),
    { source: "others", count: rest, pct: ((rest / total) * 100).toFixed(1) },
  ];

  const plot = Plot.plot({
    document,
    width: 680,
    height: 320,
    marginLeft: 72,
    marginRight: 50,
    marginTop: 12,
    marginBottom: 30,
    x: {
      label: "Posts shared",
      grid: true,
      tickFormat: (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(0)}k` : `${d}`),
    },
    y: { label: null },
    marks: [
      Plot.barX(data, {
        y: "source",
        x: "count",
        fill: C.blue,
        sort: { y: "-x" },
        rx: 2,
      }),
      Plot.text(data, {
        y: "source",
        x: "count",
        text: (d: any) => `${d.pct}%`,
        dx: 4,
        textAnchor: "start",
        fontSize: 12,
        fontWeight: "600",
        fill: C.text,
      }),
    ],
    style: STYLE,
  });

  save("source_distribution", extractSvg(plot));
}

// ── Bot vs Human engagement ──
// No legend needed — x-axis labels identify each group

function botVsHuman() {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, "top_papers_analysis.json"), "utf-8")
  );
  const stats = raw.bot_vs_human.group_statistics;
  const order = ["Human", "Aggregator", "Bot"];
  const colorMap: Record<string, string> = {
    Human: C.blue,
    Aggregator: C.sage,
    Bot: C.coral,
  };

  const data = order.flatMap((label) => {
    const key = label.toLowerCase();
    const s = stats[key];
    if (!s) return [];
    return [
      { type: label, metric: "Mean", value: s.mean_engagement },
      { type: label, metric: "Median", value: s.median_engagement },
    ];
  });

  const plot = Plot.plot({
    document,
    width: 680,
    height: 360,
    marginLeft: 50,
    marginBottom: 36,
    marginTop: 40,
    marginRight: 16,
    x: { label: null, domain: order },
    y: { label: "Engagement", grid: true },
    fx: { label: null, padding: 0.2 },
    color: { domain: order, range: [C.blue, C.sage, C.coral] },
    marks: [
      Plot.barY(data, {
        fx: "metric",
        x: "type",
        y: "value",
        fill: "type",
        rx: 2,
      }),
      Plot.text(data, {
        fx: "metric",
        x: "type",
        y: "value",
        text: (d: any) =>
          d.value % 1 === 0 ? `${d.value}` : `${d.value.toFixed(1)}`,
        dy: -10,
        fontSize: 13,
        fontWeight: "bold",
        fill: C.text,
      }),
      Plot.ruleY([0]),
    ],
    style: STYLE,
  });

  save("bot_vs_human", extractSvg(plot));
}

// ── Top papers by engagement ──

function topPapers() {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, "top_papers_analysis.json"), "utf-8")
  );
  const papers = raw.top_papers.overall_top_25.slice(0, 10);

  const data = papers.map((p: any) => ({
    title: cleanTitle(p.title, 48),
    likes: p.likes,
    reposts: p.reposts,
    replies: p.replies,
    quotes: p.quotes,
    total: p.total_engagement,
  }));

  const stacked = data.flatMap((d: any) => [
    { title: d.title, metric: "Likes", value: d.likes },
    { title: d.title, metric: "Reposts", value: d.reposts },
    { title: d.title, metric: "Replies", value: d.replies },
    { title: d.title, metric: "Quotes", value: d.quotes },
  ]);

  const plot = Plot.plot({
    document,
    width: 680,
    height: 440,
    marginLeft: 290,
    marginRight: 45,
    marginTop: 30,
    marginBottom: 30,
    x: { label: "Total engagement", grid: true },
    y: { label: null },
    color: {
      domain: ["Likes", "Reposts", "Replies", "Quotes"],
      range: [C.blue, C.amber, C.coral, C.sage],
    },
    marks: [
      Plot.barX(stacked, {
        y: "title",
        x: "value",
        fill: "metric",
        sort: { y: "-x", reduce: "sum" },
        rx: 2,
      }),
      Plot.text(data, {
        y: "title",
        x: "total",
        text: (d: any) => `${d.total}`,
        dx: 4,
        textAnchor: "start",
        fontSize: 11,
        fill: C.muted,
      }),
    ],
    style: { ...STYLE, fontSize: 11 },
  });

  let svg = extractSvg(plot);
  svg = addLegend(
    svg,
    [
      { label: "Likes", color: C.blue },
      { label: "Reposts", color: C.amber },
      { label: "Replies", color: C.coral },
      { label: "Quotes", color: C.sage },
    ],
    { x: 300, y: 6, gap: 95 }
  );

  save("top_papers", svg);
}

// ── Top papers table ──

function topPapersTable() {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, "top_papers_analysis.json"), "utf-8")
  );
  const papers = raw.top_papers.overall_top_25.slice(0, 10);

  const W = 680;
  const rowH = 28;
  const headerH = 30;
  const topPad = 4;
  const rows = papers.length;
  const H = topPad + headerH + rows * rowH + 4;

  // Column positions (x) and widths
  const cols = {
    rank: { x: 12, w: 22 },
    title: { x: 36, w: 260 },
    source: { x: 300, w: 52 },
    likes: { x: 366, w: 44 },
    reposts: { x: 418, w: 52 },
    replies: { x: 476, w: 46 },
    quotes: { x: 528, w: 46 },
    total: { x: 580, w: 42 },
    author: { x: 628, w: 48 },
  };

  const font = `font-family="system-ui, sans-serif"`;
  const hdrY = topPad + 16;
  const stripe = "#f5f4f1";

  // Header
  const header = [
    `<text x="${cols.rank.x}" y="${hdrY}" ${font} font-size="10" font-weight="600" fill="${C.muted}" text-anchor="start">#</text>`,
    `<text x="${cols.title.x}" y="${hdrY}" ${font} font-size="10" font-weight="600" fill="${C.muted}" text-anchor="start">Paper</text>`,
    `<text x="${cols.source.x}" y="${hdrY}" ${font} font-size="10" font-weight="600" fill="${C.muted}" text-anchor="start">Source</text>`,
    `<text x="${cols.likes.x + cols.likes.w}" y="${hdrY}" ${font} font-size="10" font-weight="600" fill="${C.muted}" text-anchor="end">Likes</text>`,
    `<text x="${cols.reposts.x + cols.reposts.w}" y="${hdrY}" ${font} font-size="10" font-weight="600" fill="${C.muted}" text-anchor="end">Reposts</text>`,
    `<text x="${cols.replies.x + cols.replies.w}" y="${hdrY}" ${font} font-size="10" font-weight="600" fill="${C.muted}" text-anchor="end">Replies</text>`,
    `<text x="${cols.quotes.x + cols.quotes.w}" y="${hdrY}" ${font} font-size="10" font-weight="600" fill="${C.muted}" text-anchor="end">Quotes</text>`,
    `<text x="${cols.total.x + cols.total.w}" y="${hdrY}" ${font} font-size="10" font-weight="600" fill="${C.muted}" text-anchor="end">Total</text>`,
    `<text x="${cols.author.x}" y="${hdrY}" ${font} font-size="10" font-weight="600" fill="${C.muted}" text-anchor="start">By</text>`,
  ].join("\n");

  // Header underline
  const headerLine = `<line x1="8" x2="${W - 8}" y1="${topPad + headerH - 6}" y2="${topPad + headerH - 6}" stroke="${C.muted}" stroke-opacity="0.3"/>`;

  // Rows
  const rowEls = papers.map((p: any, i: number) => {
    const y0 = topPad + headerH + i * rowH;
    const ty = y0 + 18;
    const title = cleanTitle(p.title, 38);
    const source = p.source;
    const author = p.author.replace(/\.bsky\.social$/, "").replace(/\.bskyverified\.social$/, "");

    const bg =
      i % 2 === 1
        ? `<rect x="8" y="${y0}" width="${W - 16}" height="${rowH}" rx="3" fill="${stripe}"/>`
        : "";

    return [
      bg,
      `<text x="${cols.rank.x}" y="${ty}" ${font} font-size="11" fill="${C.muted}" text-anchor="start">${i + 1}</text>`,
      `<text x="${cols.title.x}" y="${ty}" ${font} font-size="11" fill="${C.text}" text-anchor="start">${title}</text>`,
      `<text x="${cols.source.x}" y="${ty}" ${font} font-size="10" fill="${C.muted}" text-anchor="start">${source}</text>`,
      `<text x="${cols.likes.x + cols.likes.w}" y="${ty}" ${font} font-size="11" fill="${C.text}" text-anchor="end" font-variant="tabular-nums">${p.likes}</text>`,
      `<text x="${cols.reposts.x + cols.reposts.w}" y="${ty}" ${font} font-size="11" fill="${C.text}" text-anchor="end" font-variant="tabular-nums">${p.reposts}</text>`,
      `<text x="${cols.replies.x + cols.replies.w}" y="${ty}" ${font} font-size="11" fill="${C.text}" text-anchor="end" font-variant="tabular-nums">${p.replies}</text>`,
      `<text x="${cols.quotes.x + cols.quotes.w}" y="${ty}" ${font} font-size="11" fill="${C.text}" text-anchor="end" font-variant="tabular-nums">${p.quotes}</text>`,
      `<text x="${cols.total.x + cols.total.w}" y="${ty}" ${font} font-size="11" font-weight="600" fill="${C.text}" text-anchor="end" font-variant="tabular-nums">${p.total_engagement}</text>`,
      `<text x="${cols.author.x}" y="${ty}" ${font} font-size="10" fill="${C.blue}" text-anchor="start">${author}</text>`,
    ].join("\n");
  });

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background: transparent;">`,
    header,
    headerLine,
    ...rowEls,
    `</svg>`,
  ].join("\n");

  save("top_papers_table", svg);
}

// ── Run ──

console.log("Generating charts...");
hourlySpike();
sourceDistribution();
botVsHuman();
topPapers();
topPapersTable();
console.log("Done.");
