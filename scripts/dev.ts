/**
 * Local development server with HMR.
 *
 * Uses Bun's native HTML imports — Bun automatically bundles
 * the .tsx and .css referenced in index.html.
 * Proxies /api/* to staging.
 *
 * Usage:
 *   bun --hot scripts/dev.ts
 */

// Bun HTML import — triggers automatic bundling of referenced .tsx/.css
import homepage from "../src/web/index.html";

const STAGING_BASE = process.env.SKYGEST_STAGING_BASE_URL
  ?? "https://skygest-bi-agent-staging.kokokessy.workers.dev";

const server = Bun.serve({
  port: 3000,
  routes: {
    "/": homepage,
  },
  async fetch(req) {
    const url = new URL(req.url);

    // Proxy API requests to staging
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) {
      const target = `${STAGING_BASE}${url.pathname}${url.search}`;
      try {
        const res = await fetch(target, {
          method: req.method,
          headers: { "content-type": "application/json" },
          body: req.method !== "GET" ? req.body : undefined,
        });
        return new Response(res.body, {
          status: res.status,
          headers: {
            "content-type": res.headers.get("content-type") ?? "application/json",
            "access-control-allow-origin": "*",
          },
        });
      } catch (e) {
        console.error(`Proxy error: ${target}`, e);
        return new Response("Staging proxy error", { status: 502 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Dev server: http://localhost:${server.port}`);
console.log(`Proxying /api/* → ${STAGING_BASE}`);
