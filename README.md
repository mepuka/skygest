# skygest-cloudflare

To install dependencies:

```bash
bun install
```

This triggers a `postinstall` hook that fetches the pinned ingest-artifacts
snapshot into `.generated/cold-start/`. You need SSH access to the private
`skygest-ingest-artifacts` repo (see
[`docs/contributor/adding-a-data-adapter.md`](docs/contributor/adding-a-data-adapter.md#prerequisites)).

To run:

```bash
bun run index.ts
```

## Contributor docs

- [Adding a new data adapter](docs/contributor/adding-a-data-adapter.md) —
  end-to-end runbook for onboarding a new DCAT data source under the
  git-backed snapshots regime (SKY-361).

This project was created using `bun init` in bun v1.3.4. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
