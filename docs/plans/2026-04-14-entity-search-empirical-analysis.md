# Entity Search Empirical Analysis — 2026-04-14

## 1. Executive Summary

| Severity | Finding | Evidence | Recommendation |
| --- | --- | --- | --- |
| High | Dataset facet scoping is completely blind in the checked-in corpus. | All 1,790 Dataset rows have NULL in all seven facet columns, and the audit found 1,790 of 1,790 datasets with no linked `variableIds` at all. | Restore dataset-to-variable links before tuning facet aggregation logic; there is no child-variable evidence to aggregate today. |
| High | Variable scope inheritance is also absent. | 9 of 25 Variable rows have no parent datasets, so `uniqueDatasetId` and `uniquePublisherId` never resolve in practice. | Treat reverse Variable ancestry as a prerequisite data-model fix, not a ranking tweak. |
| High | Series URL coverage is still a first-class quality gate. | 0 of 29 Series rows still carry zero canonical URLs, so that residual set cannot participate in exact URL evidence no matter how strong the parent source artifact is. | Keep projecting selected parent Dataset / Distribution URL and hostname surfaces onto Series rows until zero-URL Series are no longer a material blind spot. |
| Medium | A non-trivial slice of Distribution rows use raw URLs as their labels. | 229 of 3,530 Distribution rows (6.5%) fall back to raw URLs because the source has no title. | Add a better fallback label chain for API distributions so ranking snippets and UI output are readable. |
| Low | Agent ontology text is not empty, but it is low-entropy. | All 66 Agent rows emit `ontology_text = "organization"`, so the column differs from `primary_label` but adds no discrimination inside the Agent family. | Keep the column only if richer agent taxonomy is coming; otherwise it should not receive meaningful BM25 weight. |

## 2. Methodology

Data source: the checked-in cold-start catalog loaded through `src/bootstrap/CheckedInDataLayerRegistry.ts:21-223`. Projection logic: `src/search/projectEntitySearchDocs.ts:253-679`. Write path: `src/services/d1/EntitySearchRepoD1.ts:956-1000`. FTS schema: `src/search/migrations.ts:3-73`. Query normalization: `src/services/d1/EntitySearchRepoD1.ts:397-470`.

Command executed: `bun run scripts/analysis/entity-search-audit/run-audit.ts`. The script writes four stable artifacts: `/Users/pooks/Dev/skygest-cloudflare/scripts/analysis/entity-search-audit/out/projected-docs.jsonl`, `/Users/pooks/Dev/skygest-cloudflare/scripts/analysis/entity-search-audit/out/entity-search-audit.sqlite`, `/Users/pooks/Dev/skygest-cloudflare/scripts/analysis/entity-search-audit/out/analysis.json`, and `/Users/pooks/Dev/skygest-cloudflare/scripts/analysis/entity-search-audit/out/queries.sql`. The SQLite file is built locally with the same migrations and repository upsert logic used by the application, so the SQL in this report runs against an index with the real projection and FTS5 configuration.

The audit intentionally preferred the checked-in catalog over remote D1 so the measurements were deterministic and reproducible. I verified the harness by rebuilding the local SQLite index multiple times and spot-checking the generated rows against the source JSON files and the projector code paths.

## 3. Corpus Overview

### 3.1 Corpus Size

```sql
SELECT entity_type, COUNT(*) AS count
FROM entity_search_docs
WHERE deleted_at IS NULL
GROUP BY entity_type
ORDER BY entity_type ASC;

SELECT COUNT(*) AS count
FROM entity_search_docs
WHERE deleted_at IS NULL;

SELECT COUNT(*) AS count FROM entity_search_doc_urls;
SELECT COUNT(*) AS count FROM entity_search_fts;
```

| Entity type | Rows |
| --- | --- |
| Agent | 66 |
| Dataset | 1,790 |
| Distribution | 3,530 |
| Series | 29 |
| Variable | 25 |
| Total docs | 5,440 |
| Exact URL rows | 5,619 |
| FTS rows | 5,440 |

The corpus is Distribution-heavy: 3,530 Distribution rows vs 1,790 Datasets, only 29 Series, and 25 Variables. The FTS row count matches the document count exactly, which confirms the local rebuild populated the shadow table cleanly.

### 3.2 Alias Coverage

| Entity type | Docs | Docs with >=1 alias | Coverage | Top schemes |
| --- | --- | --- | --- | --- |
| Agent | 66 | 66 | 100.0 | url (66), display-alias (52), wikidata (51), ror (20) |
| Dataset | 1,790 | 1,620 | 90.5 | url (555), europa-dataset-id (497), gridstatus-dataset-id (491), eia-route (232) |
| Distribution | 3,530 | 1,397 | 39.6 | url (1,397) |
| Series | 29 | 0 | 0.0 |  |
| Variable | 25 | 2 | 8.0 | oeo (2) |

Agents are fully aliased and Dataset coverage is strong at 90.5%, but Series have no aliases at all and Variables only have two `oeo` aliases across the entire family. Distribution aliasing is effectively just URL aliasing.

### 3.3 URL Coverage

| Entity type | Docs | Docs with >=1 canonical URL | Coverage |
| --- | --- | --- | --- |
| Agent | 66 | 66 | 100.0 |
| Dataset | 1,790 | 1,535 | 85.8 |
| Distribution | 3,530 | 3,530 | 100.0 |
| Series | 29 | 29 | 100.0 |
| Variable | 25 | 0 | 0.0 |

The corpus exposes 204 unique normalized hostnames. The top ten are below; the shape is dominated by GridStatus, Europa, ODRE, EIA, and NESO hosts.

| Hostname | Docs |
| --- | --- |
| api.gridstatus.io | 983 |
| ec.europa.eu | 581 |
| data.europa.eu | 536 |
| gridstatus.io | 493 |
| odre.opendatasoft.com | 417 |
| api.eia.gov | 248 |
| ge.ch | 170 |
| api.neso.energy | 152 |
| neso.energy | 129 |
| ercot.com | 120 |

### 3.4 Column Length Distribution

The full per-(entity_type x column) length table is in Appendix D. Three headline patterns matter in the body:

| Entity type | Column | Mean bytes | P95 bytes | Primary-label-only rows |
| --- | --- | --- | --- | --- |
| Dataset | primaryText | 571.5 | 1,999.4 | 0 |
| Dataset | urlText | 120.3 | 224.0 | 255 |
| Dataset | semanticText | 951.1 | 2,408.2 | 0 |
| Distribution | aliasText | 54.4 | 131.5 | 2,133 |
| Distribution | urlText | 259.4 | 527.5 | 0 |
| Distribution | semanticText | 716.8 | 1,474.6 | 0 |
| Series | primaryText | 36.4 | 48.2 | 29 |
| Series | urlText | 110.3 | 249.4 | 0 |

Series are the starkest example of column collapse: `primary_text`, `alias_text`, and `url_text` are identical to the primary label for all 29 rows. Distribution `alias_text` is also weak: 2,133 of 3,530 rows (60.4%) have no alias content beyond the fallback label surface.

## 4. Per-Entity-Type Deep Dive

### 4.1 Agent

H2 is formally refuted but substantively still weak. `ontology_text` never falls back to `primary_label`; instead, every Agent row emits the same single token: `organization`. That makes the column non-empty but useless for discrimination. H4 is also refuted on this corpus because there are no parent links at all: 0 of 66 agents have `parentAgentId`, so the one-hop lineage projector in `src/search/projectEntitySearchDocs.ts:267-275` does not currently drop any real hierarchy.

#### Sparse Example — `https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1`

What works: alias and homepage normalization give the row solid exact-match surface area. What is surprising: `ontology_text` is just "organization", and every Agent row in this corpus emits the same value. What is missing: there is no deeper lineage to project because the current Agent catalog has no parent chains.

<details>
<summary>Source Row</summary>

```json
{
  "_tag": "Agent",
  "id": "https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1",
  "kind": "organization",
  "name": "Ember",
  "alternateNames": [
    "Ember Climate"
  ],
  "homepage": "https://ember-energy.org/",
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-14T15:25:55.593Z",
  "aliases": [
    {
      "scheme": "wikidata",
      "value": "Q7416010",
      "relation": "exactMatch"
    },
    {
      "scheme": "url",
      "value": "https://ember-climate.org/",
      "relation": "exactMatch"
    },
    {
      "scheme": "url",
      "value": "https://ember-energy.org/",
      "relation": "exactMatch"
    }
  ]
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1",
  "entityType": "Agent",
  "primaryLabel": "Ember",
  "secondaryLabel": "Ember Climate",
  "aliases": [
    {
      "scheme": "wikidata",
      "value": "Q7416010",
      "relation": "exactMatch"
    },
    {
      "scheme": "url",
      "value": "https://ember-climate.org/",
      "relation": "exactMatch"
    },
    {
      "scheme": "url",
      "value": "https://ember-energy.org/",
      "relation": "exactMatch"
    },
    {
      "scheme": "display-alias",
      "value": "Ember Climate",
      "relation": "exactMatch"
    }
  ],
  "agentId": "https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1",
  "homepageHostname": "ember-energy.org",
  "canonicalUrls": [
    "ember-energy.org",
    "ember-climate.org"
  ],
  "payloadJson": "{\"_tag\":\"Agent\",\"id\":\"https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1\",\"kind\":\"organization\",\"name\":\"Ember\",\"alternateNames\":[\"Ember Climate\"],\"homepage\":\"https://ember-energy.org/\",\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-14T15:25:55.593Z\",\"aliases\":[{\"scheme\":\"wikidata\",\"value\":\"Q7416010\",\"relation\":\"exactMatch\"},{\"scheme\":\"url\",\"value\":\"https://ember-climate.org/\",\"relation\":\"exactMatch\"},{\"scheme\":\"url\",\"value\":\"https://ember-energy.org/\",\"relation\":\"exactMatch\"}]}",
  "primaryText": "Ember\nEmber Climate",
  "aliasText": "Q7416010\nhttps://ember-climate.org/\nhttps://ember-energy.org/\nEmber Climate",
  "lineageText": "Ember",
  "urlText": "ember-energy.org\nember-climate.org",
  "ontologyText": "organization",
  "semanticText": "Ember\nEmber Climate\nQ7416010\nhttps://ember-climate.org/\nhttps://ember-energy.org/\nEmber Climate\nEmber\nember-energy.org\nember-climate.org\norganization",
  "updatedAt": "2026-04-14T15:25:55.593Z"
}
```

</details>

#### Average Example — `https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB`

What works: alias and homepage normalization give the row solid exact-match surface area. What is surprising: `ontology_text` is just "organization", and every Agent row in this corpus emits the same value. What is missing: there is no deeper lineage to project because the current Agent catalog has no parent chains.

<details>
<summary>Source Row</summary>

```json
{
  "_tag": "Agent",
  "id": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "kind": "organization",
  "name": "U.S. Energy Information Administration",
  "alternateNames": [
    "EIA",
    "US Energy Information Administration",
    "Energy Information Administration"
  ],
  "homepage": "https://www.eia.gov/",
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-14T15:24:46.023Z",
  "aliases": [
    {
      "scheme": "ror",
      "value": "https://ror.org/01h04ms65",
      "relation": "exactMatch"
    },
    {
      "scheme": "wikidata",
      "value": "Q1133499",
      "relation": "exactMatch"
    },
    {
      "scheme": "url",
      "value": "https://www.eia.gov/",
      "relation": "exactMatch"
    }
  ]
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "entityType": "Agent",
  "primaryLabel": "U.S. Energy Information Administration",
  "secondaryLabel": "EIA",
  "aliases": [
    {
      "scheme": "ror",
      "value": "https://ror.org/01h04ms65",
      "relation": "exactMatch"
    },
    {
      "scheme": "wikidata",
      "value": "Q1133499",
      "relation": "exactMatch"
    },
    {
      "scheme": "url",
      "value": "https://www.eia.gov/",
      "relation": "exactMatch"
    },
    {
      "scheme": "display-alias",
      "value": "EIA",
      "relation": "exactMatch"
    },
    {
      "scheme": "display-alias",
      "value": "US Energy Information Administration",
      "relation": "exactMatch"
    },
    {
      "scheme": "display-alias",
      "value": "Energy Information Administration",
      "relation": "exactMatch"
    }
  ],
  "agentId": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "homepageHostname": "eia.gov",
  "canonicalUrls": [
    "eia.gov"
  ],
  "payloadJson": "{\"_tag\":\"Agent\",\"id\":\"https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB\",\"kind\":\"organization\",\"name\":\"U.S. Energy Information Administration\",\"alternateNames\":[\"EIA\",\"US Energy Information Administration\",\"Energy Information Administration\"],\"homepage\":\"https://www.eia.gov/\",\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-14T15:24:46.023Z\",\"aliases\":[{\"scheme\":\"ror\",\"value\":\"https://ror.org/01h04ms65\",\"relation\":\"exactMatch\"},{\"scheme\":\"wikidata\",\"value\":\"Q1133499\",\"relation\":\"exactMatch\"},{\"scheme\":\"url\",\"value\":\"https://www.eia.gov/\",\"relation\":\"exactMatch\"}]}",
  "primaryText": "U.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration",
  "aliasText": "https://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\nEIA\nUS Energy Information Administration\nEnergy Information Administration",
  "lineageText": "U.S. Energy Information Administration",
  "urlText": "eia.gov",
  "ontologyText": "organization",
  "semanticText": "U.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nU.S. Energy Information Administration\neia.gov\norganization",
  "updatedAt": "2026-04-14T15:24:46.023Z"
}
```

</details>

#### Rich Example — `https://id.skygest.io/agent/ag_01KNWVQMFHEZD7KVN03TEAVA1Q`

What works: alias and homepage normalization give the row solid exact-match surface area. What is surprising: `ontology_text` is just "organization", and every Agent row in this corpus emits the same value. What is missing: there is no deeper lineage to project because the current Agent catalog has no parent chains.

<details>
<summary>Source Row</summary>

```json
{
  "_tag": "Agent",
  "id": "https://id.skygest.io/agent/ag_01KNWVQMFHEZD7KVN03TEAVA1Q",
  "kind": "organization",
  "name": "Fraunhofer Institute for Solar Energy Systems ISE",
  "alternateNames": [
    "Fraunhofer ISE",
    "Energy-Charts",
    "Energy Charts",
    "Energy Charts (Fraunhofer ISE)"
  ],
  "homepage": "https://www.ise.fraunhofer.de/",
  "createdAt": "2026-04-10T23:30:44.590Z",
  "updatedAt": "2026-04-14T15:25:47.701Z",
  "aliases": [
    {
      "scheme": "url",
      "value": "https://www.ise.fraunhofer.de/",
      "relation": "exactMatch"
    }
  ]
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/agent/ag_01KNWVQMFHEZD7KVN03TEAVA1Q",
  "entityType": "Agent",
  "primaryLabel": "Fraunhofer Institute for Solar Energy Systems ISE",
  "secondaryLabel": "Fraunhofer ISE",
  "aliases": [
    {
      "scheme": "url",
      "value": "https://www.ise.fraunhofer.de/",
      "relation": "exactMatch"
    },
    {
      "scheme": "display-alias",
      "value": "Fraunhofer ISE",
      "relation": "exactMatch"
    },
    {
      "scheme": "display-alias",
      "value": "Energy-Charts",
      "relation": "exactMatch"
    },
    {
      "scheme": "display-alias",
      "value": "Energy Charts",
      "relation": "exactMatch"
    },
    {
      "scheme": "display-alias",
      "value": "Energy Charts (Fraunhofer ISE)",
      "relation": "exactMatch"
    }
  ],
  "agentId": "https://id.skygest.io/agent/ag_01KNWVQMFHEZD7KVN03TEAVA1Q",
  "homepageHostname": "ise.fraunhofer.de",
  "canonicalUrls": [
    "ise.fraunhofer.de"
  ],
  "payloadJson": "{\"_tag\":\"Agent\",\"id\":\"https://id.skygest.io/agent/ag_01KNWVQMFHEZD7KVN03TEAVA1Q\",\"kind\":\"organization\",\"name\":\"Fraunhofer Institute for Solar Energy Systems ISE\",\"alternateNames\":[\"Fraunhofer ISE\",\"Energy-Charts\",\"Energy Charts\",\"Energy Charts (Fraunhofer ISE)\"],\"homepage\":\"https://www.ise.fraunhofer.de/\",\"createdAt\":\"2026-04-10T23:30:44.590Z\",\"updatedAt\":\"2026-04-14T15:25:47.701Z\",\"aliases\":[{\"scheme\":\"url\",\"value\":\"https://www.ise.fraunhofer.de/\",\"relation\":\"exactMatch\"}]}",
  "primaryText": "Fraunhofer Institute for Solar Energy Systems ISE\nFraunhofer ISE\nEnergy-Charts\nEnergy Charts\nEnergy Charts (Fraunhofer ISE)",
  "aliasText": "https://www.ise.fraunhofer.de/\nFraunhofer ISE\nEnergy-Charts\nEnergy Charts\nEnergy Charts (Fraunhofer ISE)",
  "lineageText": "Fraunhofer Institute for Solar Energy Systems ISE",
  "urlText": "ise.fraunhofer.de",
  "ontologyText": "organization",
  "semanticText": "Fraunhofer Institute for Solar Energy Systems ISE\nFraunhofer ISE\nEnergy-Charts\nEnergy Charts\nEnergy Charts (Fraunhofer ISE)\nhttps://www.ise.fraunhofer.de/\nFraunhofer ISE\nEnergy-Charts\nEnergy Charts\nEnergy Charts (Fraunhofer ISE)\nFraunhofer Institute for Solar Energy Systems ISE\nise.fraunhofer.de\norganization",
  "updatedAt": "2026-04-14T15:25:47.701Z"
}
```

</details>

### 4.2 Dataset

H1 does not fail in the originally suspected way. I found zero multi-value conflicts because the checked-in catalog never reaches the `singleDistinctValue` conflict branch at all. Instead, every Dataset row is facet-blind because the source rows do not link Variables into Datasets. The source sample `references/cold-start/catalog/datasets/eia-electricity-data.json` has `distributionIds` but no `variableIds`, and that pattern generalizes across the corpus.

| Facet | NULL rows | Conflict rows | No linked variables | Variables present but facet empty |
| --- | --- | --- | --- | --- |
| measuredProperty | 1,771 | 2 | 1,769 | 0 |
| domainObject | 1,770 | 1 | 1,769 | 0 |
| technologyOrFuel | 1,784 | 1 | 1,769 | 14 |
| statisticType | 1,771 | 2 | 1,769 | 0 |
| aggregation | 1,773 | 2 | 1,769 | 2 |
| unitFamily | 1,771 | 2 | 1,769 | 0 |
| policyInstrument | 1,790 | 0 | 1,769 | 21 |

This means all seven Dataset facet columns are NULL for all 1,790 Dataset rows. The intended conflict pathology is masked by a more basic catalog-linking gap.

H5 is partly supported. The intentional Dataset double-count is real and measurable: every Dataset with keywords/themes has 100% keyword-token overlap with `ontology_text`, because `src/search/projectEntitySearchDocs.ts:348-353` explicitly reuses `dataset.keywords` and `dataset.themes` inside that column. Whether that inflates BM25 depends on the query. The corpus-average Dataset keyword token count is 7.0. Top-10 hit means rise to 9.1 for `electricity price`, 8.5 for `grid frequency`, and 21.0 for the only `capacity factor` hit, but fall slightly below average for `solar capacity` and `emissions`. So tagging density boosts some generic queries, but not uniformly.

| Query | Top hit count | Top-10 mean keyword tokens | Top-10 median | Corpus mean |
| --- | --- | --- | --- | --- |
| electricity price | 10 | 5.5 | 4.0 | 7.0 |
| solar capacity | 10 | 6.4 | 7.0 | 7.0 |
| emissions | 10 | 6.5 | 6.5 | 7.0 |
| grid frequency | 10 | 8.5 | 9.5 | 7.0 |
| capacity factor | 1 | 21.0 | 21.0 | 7.0 |

#### Sparse Example — `https://id.skygest.io/dataset/ds_01KP69GMWRAVVDS356DNH4CKP4`

What works: title, description, publisher lineage, and keyword/theme text all survive projection. What is surprising: every facet scope field is empty here because the source dataset links 0 variables. What is missing: `url_text` collapses to the title because there is no canonical URL.

<details>
<summary>Source Row</summary>

```json
{
  "_tag": "Dataset",
  "id": "https://id.skygest.io/dataset/ds_01KP69GMWRAVVDS356DNH4CKP4",
  "title": "Petroleum · Move · Exp",
  "description": "EIA petroleum gas survey data",
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "license": "https://www.eia.gov/about/copyrights_reuse.php",
  "temporal": "1920-01/2026-01",
  "keywords": [
    "duoarea",
    "monthly",
    "process",
    "product",
    "series"
  ],
  "themes": [
    "petroleum",
    "move"
  ],
  "distributionIds": [
    "https://id.skygest.io/distribution/dist_01KP69GMWR0GYV1SK65ECKKAZJ"
  ],
  "accessRights": "public",
  "dataServiceIds": [
    "https://id.skygest.io/data-service/svc_01KNQEZ5VHS74DM94ABW2ZM93Y"
  ],
  "createdAt": "2026-04-14T15:24:46.023Z",
  "updatedAt": "2026-04-14T15:24:46.023Z",
  "aliases": [
    {
      "scheme": "eia-route",
      "value": "petroleum/move/exp",
      "relation": "exactMatch"
    }
  ]
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/dataset/ds_01KP69GMWRAVVDS356DNH4CKP4",
  "entityType": "Dataset",
  "primaryLabel": "Petroleum · Move · Exp",
  "secondaryLabel": "EIA petroleum gas survey data",
  "aliases": [
    {
      "scheme": "eia-route",
      "value": "petroleum/move/exp",
      "relation": "exactMatch"
    }
  ],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "datasetId": "https://id.skygest.io/dataset/ds_01KP69GMWRAVVDS356DNH4CKP4",
  "canonicalUrls": [],
  "payloadJson": "{\"_tag\":\"Dataset\",\"id\":\"https://id.skygest.io/dataset/ds_01KP69GMWRAVVDS356DNH4CKP4\",\"title\":\"Petroleum · Move · Exp\",\"description\":\"EIA petroleum gas survey data\",\"publisherAgentId\":\"https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB\",\"license\":\"https://www.eia.gov/about/copyrights_reuse.php\",\"temporal\":\"1920-01/2026-01\",\"keywords\":[\"duoarea\",\"monthly\",\"process\",\"product\",\"series\"],\"themes\":[\"petroleum\",\"move\"],\"distributionIds\":[\"https://id.skygest.io/distribution/dist_01KP69GMWR0GYV1SK65ECKKAZJ\"],\"accessRights\":\"public\",\"dataServiceIds\":[\"https://id.skygest.io/data-service/svc_01KNQEZ5VHS74DM94ABW2ZM93Y\"],\"createdAt\":\"2026-04-14T15:24:46.023Z\",\"updatedAt\":\"2026-04-14T15:24:46.023Z\",\"aliases\":[{\"scheme\":\"eia-route\",\"value\":\"petroleum/move/exp\",\"relation\":\"exactMatch\"}]}",
  "primaryText": "Petroleum · Move · Exp\nEIA petroleum gas survey data\nduoarea\nmonthly\nprocess\nproduct\nseries\npetroleum\nmove",
  "aliasText": "petroleum/move/exp",
  "lineageText": "U.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\napi.eia.gov",
  "urlText": "Petroleum · Move · Exp",
  "ontologyText": "duoarea\nmonthly\nprocess\nproduct\nseries\npetroleum\nmove",
  "semanticText": "Petroleum · Move · Exp\nEIA petroleum gas survey data\nduoarea\nmonthly\nprocess\nproduct\nseries\npetroleum\nmove\npetroleum/move/exp\nU.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\napi.eia.gov\nPetroleum · Move · Exp\nduoarea\nmonthly\nprocess\nproduct\nseries\npetroleum\nmove",
  "updatedAt": "2026-04-14T15:24:46.023Z"
}
```

</details>

#### Average Example — `https://id.skygest.io/dataset/ds_01KP69GMWE90WTY6GZHVVXND8H`

What works: title, description, publisher lineage, and keyword/theme text all survive projection. What is surprising: every facet scope field is empty here because the source dataset links 0 variables. What is missing: `url_text` collapses to the title because there is no canonical URL.

<details>
<summary>Source Row</summary>

```json
{
  "_tag": "Dataset",
  "id": "https://id.skygest.io/dataset/ds_01KP69GMWE90WTY6GZHVVXND8H",
  "title": "Daily Generation by Energy Source",
  "description": "Daily net generation by balancing authority and energy source.  \n    Source: Form EIA-930\n    Product: Hourly Electric Grid Monitor",
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "license": "https://www.eia.gov/about/copyrights_reuse.php",
  "temporal": "2019-01-01/2026-04-12",
  "keywords": [
    "daily",
    "fueltype",
    "respondent",
    "timezone"
  ],
  "themes": [
    "electricity",
    "rto"
  ],
  "distributionIds": [
    "https://id.skygest.io/distribution/dist_01KP69GMWEJ0YNG8EZ1XY9TXYB"
  ],
  "accessRights": "public",
  "dataServiceIds": [
    "https://id.skygest.io/data-service/svc_01KNQEZ5VHS74DM94ABW2ZM93Y"
  ],
  "createdAt": "2026-04-14T15:24:46.023Z",
  "updatedAt": "2026-04-14T15:24:46.023Z",
  "aliases": [
    {
      "scheme": "eia-route",
      "value": "electricity/rto/daily-fuel-type-data",
      "relation": "exactMatch"
    }
  ]
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/dataset/ds_01KP69GMWE90WTY6GZHVVXND8H",
  "entityType": "Dataset",
  "primaryLabel": "Daily Generation by Energy Source",
  "secondaryLabel": "Daily net generation by balancing authority and energy source.  \n    Source: Form EIA-930\n    Product: Hourly Electric Grid Monitor",
  "aliases": [
    {
      "scheme": "eia-route",
      "value": "electricity/rto/daily-fuel-type-data",
      "relation": "exactMatch"
    }
  ],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "datasetId": "https://id.skygest.io/dataset/ds_01KP69GMWE90WTY6GZHVVXND8H",
  "canonicalUrls": [],
  "payloadJson": "{\"_tag\":\"Dataset\",\"id\":\"https://id.skygest.io/dataset/ds_01KP69GMWE90WTY6GZHVVXND8H\",\"title\":\"Daily Generation by Energy Source\",\"description\":\"Daily net generation by balancing authority and energy source.  \\n    Source: Form EIA-930\\n    Product: Hourly Electric Grid Monitor\",\"publisherAgentId\":\"https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB\",\"license\":\"https://www.eia.gov/about/copyrights_reuse.php\",\"temporal\":\"2019-01-01/2026-04-12\",\"keywords\":[\"daily\",\"fueltype\",\"respondent\",\"timezone\"],\"themes\":[\"electricity\",\"rto\"],\"distributionIds\":[\"https://id.skygest.io/distribution/dist_01KP69GMWEJ0YNG8EZ1XY9TXYB\"],\"accessRights\":\"public\",\"dataServiceIds\":[\"https://id.skygest.io/data-service/svc_01KNQEZ5VHS74DM94ABW2ZM93Y\"],\"createdAt\":\"2026-04-14T15:24:46.023Z\",\"updatedAt\":\"2026-04-14T15:24:46.023Z\",\"aliases\":[{\"scheme\":\"eia-route\",\"value\":\"electricity/rto/daily-fuel-type-data\",\"relation\":\"exactMatch\"}]}",
  "primaryText": "Daily Generation by Energy Source\nDaily net generation by balancing authority and energy source.  \n    Source: Form EIA-930\n    Product: Hourly Electric Grid Monitor\ndaily\nfueltype\nrespondent\ntimezone\nelectricity\nrto",
  "aliasText": "electricity/rto/daily-fuel-type-data",
  "lineageText": "U.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\napi.eia.gov",
  "urlText": "Daily Generation by Energy Source",
  "ontologyText": "daily\nfueltype\nrespondent\ntimezone\nelectricity\nrto",
  "semanticText": "Daily Generation by Energy Source\nDaily net generation by balancing authority and energy source.  \n    Source: Form EIA-930\n    Product: Hourly Electric Grid Monitor\ndaily\nfueltype\nrespondent\ntimezone\nelectricity\nrto\nelectricity/rto/daily-fuel-type-data\nU.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\napi.eia.gov\nDaily Generation by Energy Source\ndaily\nfueltype\nrespondent\ntimezone\nelectricity\nrto",
  "updatedAt": "2026-04-14T15:24:46.023Z"
}
```

</details>

#### Rich Example — `https://id.skygest.io/dataset/ds_01KP4W1EA9PT4X1MW3E7QG3PD3`

What works: title, description, publisher lineage, and keyword/theme text all survive projection. What is surprising: every facet scope field is empty here because the source dataset links 0 variables. What is missing: The row keeps 1 canonical URL(s) and hostname prefixes.

<details>
<summary>Source Row</summary>

```json
{
  "_tag": "Dataset",
  "id": "https://id.skygest.io/dataset/ds_01KP4W1EA9PT4X1MW3E7QG3PD3",
  "title": "Transmission Network Use of System (TNUoS) Tariffs",
  "description": "This dataset contains a breakdown of all the Transmission Network Use of System (TNUoS) tariff elements of which are forecasted and set by the revenue team at National Grid ESO. These files will be updated on a quarterly basis (when tariffs are published), to receive automatic updates please register and subscribe to this dataset.",
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KP172ZRBS4Z4NGY24XA7YX6D",
  "landingPage": "https://www.neso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs",
  "license": "https://www.neso.energy/data-portal/ngeso-open-licence",
  "keywords": [
    "Charging",
    "Demand",
    "Demand Residual Banded Charges",
    "Embedded",
    "Export",
    "Generator",
    "Revenue",
    "Subscribable",
    "TNUOS",
    "Tarifs",
    "Network charges",
    "Quarterly"
  ],
  "themes": [
    "electricity",
    "market",
    "grid",
    "planning"
  ],
  "distributionIds": [
    "https://id.skygest.io/distribution/dist_01KP4W1EADJJ1RKV2YYT43GM6V"
  ],
  "accessRights": "public",
  "dataServiceIds": [
    "https://id.skygest.io/data-service/svc_01KP4W1DWZG3S96C6XZD3YG71N"
  ],
  "createdAt": "2026-04-14T02:09:59.759Z",
  "updatedAt": "2026-04-14T15:25:34.063Z",
  "aliases": [
    {
      "scheme": "url",
      "value": "https://www.neso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs",
      "relation": "exactMatch"
    }
  ]
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/dataset/ds_01KP4W1EA9PT4X1MW3E7QG3PD3",
  "entityType": "Dataset",
  "primaryLabel": "Transmission Network Use of System (TNUoS) Tariffs",
  "secondaryLabel": "This dataset contains a breakdown of all the Transmission Network Use of System (TNUoS) tariff elements of which are forecasted and set by the revenue team at National Grid ESO. These files will be updated on a quarterly basis (when tariffs are published), to receive automatic updates please register and subscribe to this dataset.",
  "aliases": [
    {
      "scheme": "url",
      "value": "https://www.neso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs",
      "relation": "exactMatch"
    }
  ],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KP172ZRBS4Z4NGY24XA7YX6D",
  "datasetId": "https://id.skygest.io/dataset/ds_01KP4W1EA9PT4X1MW3E7QG3PD3",
  "landingPageHostname": "neso.energy",
  "canonicalUrls": [
    "neso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs"
  ],
  "payloadJson": "{\"_tag\":\"Dataset\",\"id\":\"https://id.skygest.io/dataset/ds_01KP4W1EA9PT4X1MW3E7QG3PD3\",\"title\":\"Transmission Network Use of System (TNUoS) Tariffs\",\"description\":\"This dataset contains a breakdown of all the Transmission Network Use of System (TNUoS) tariff elements of which are forecasted and set by the revenue team at National Grid ESO. These files will be updated on a quarterly basis (when tariffs are published), to receive automatic updates please register and subscribe to this dataset.\",\"publisherAgentId\":\"https://id.skygest.io/agent/ag_01KP172ZRBS4Z4NGY24XA7YX6D\",\"landingPage\":\"https://www.neso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs\",\"license\":\"https://www.neso.energy/data-portal/ngeso-open-licence\",\"keywords\":[\"Charging\",\"Demand\",\"Demand Residual Banded Charges\",\"Embedded\",\"Export\",\"Generator\",\"Revenue\",\"Subscribable\",\"TNUOS\",\"Tarifs\",\"Network charges\",\"Quarterly\"],\"themes\":[\"electricity\",\"market\",\"grid\",\"planning\"],\"distributionIds\":[\"https://id.skygest.io/distribution/dist_01KP4W1EADJJ1RKV2YYT43GM6V\"],\"accessRights\":\"public\",\"dataServiceIds\":[\"https://id.skygest.io/data-service/svc_01KP4W1DWZG3S96C6XZD3YG71N\"],\"createdAt\":\"2026-04-14T02:09:59.759Z\",\"updatedAt\":\"2026-04-14T15:25:34.063Z\",\"aliases\":[{\"scheme\":\"url\",\"value\":\"https://www.neso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs\",\"relation\":\"exactMatch\"}]}",
  "primaryText": "Transmission Network Use of System (TNUoS) Tariffs\nThis dataset contains a breakdown of all the Transmission Network Use of System (TNUoS) tariff elements of which are forecasted and set by the revenue team at National Grid ESO. These files will be updated on a quarterly basis (when tariffs are published), to receive automatic updates please register and subscribe to this dataset.\nCharging\nDemand\nDemand Residual Banded Charges\nEmbedded\nExport\nGenerator\nRevenue\nSubscribable\nTNUOS\nTarifs\nNetwork charges\nQuarterly\nelectricity\nmarket\ngrid\nplanning",
  "aliasText": "https://www.neso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs",
  "lineageText": "National Energy System Operator (NESO)\nNESO\nNational Energy System Operator\nhttps://www.neso.energy/\nQ130538498\nTransmission Demand Residual (TDR) Tariffs\napi.neso.energy",
  "urlText": "neso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs\nneso.energy\nneso.energy/data-portal",
  "ontologyText": "Charging\nDemand\nDemand Residual Banded Charges\nEmbedded\nExport\nGenerator\nRevenue\nSubscribable\nTNUOS\nTarifs\nNetwork charges\nQuarterly\nelectricity\nmarket\ngrid\nplanning",
  "semanticText": "Transmission Network Use of System (TNUoS) Tariffs\nThis dataset contains a breakdown of all the Transmission Network Use of System (TNUoS) tariff elements of which are forecasted and set by the revenue team at National Grid ESO. These files will be updated on a quarterly basis (when tariffs are published), to receive automatic updates please register and subscribe to this dataset.\nCharging\nDemand\nDemand Residual Banded Charges\nEmbedded\nExport\nGenerator\nRevenue\nSubscribable\nTNUOS\nTarifs\nNetwork charges\nQuarterly\nelectricity\nmarket\ngrid\nplanning\nhttps://www.neso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs\nNational Energy System Operator (NESO)\nNESO\nNational Energy System Operator\nhttps://www.neso.energy/\nQ130538498\nTransmission Demand Residual (TDR) Tariffs\napi.neso.energy\nneso.energy/data-portal/transmission-network-use-of-system-tnuos-tariffs\nneso.energy\nneso.energy/data-portal\nCharging\nDemand\nDemand Residual Banded Charges\nEmbedded\nExport\nGenerator\nRevenue\nSubscribable\nTNUOS\nTarifs\nNetwork charges\nQuarterly\nelectricity\nmarket\ngrid\nplanning",
  "updatedAt": "2026-04-14T15:25:34.063Z"
}
```

</details>

### 4.3 Distribution

Distribution projection is the strongest URL surface in the corpus, but it has a readability problem. 229 of 3,530 rows (6.5%) use a raw source URL as `primary_label` because `src/search/projectEntitySearchDocs.ts:418-422` falls back from `title` to `accessURL` or `downloadURL`. The sparse and average EIA API examples below show exactly what that looks like.

#### Sparse Example — `https://id.skygest.io/distribution/dist_01KNQEZ5VJP009416G2GQ4XDMD`

What works: download and access URLs expand into normalized host and prefix text, which is useful for exact and hostname probes. What is surprising: the title is strong enough that the row reads like a real named document. What is missing: dataset-derived variable facets are empty because the current catalog never links Variables back into Datasets.

<details>
<summary>Source Row</summary>

```json
{
  "_tag": "Distribution",
  "id": "https://id.skygest.io/distribution/dist_01KNQEZ5VJP009416G2GQ4XDMD",
  "datasetId": "https://id.skygest.io/dataset/ds_01KNQEZ5VJN9W80ZWZRJX6EYW7",
  "kind": "landing-page",
  "title": "RECS data tables",
  "accessURL": "https://www.eia.gov/consumption/residential/data/",
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z",
  "aliases": []
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/distribution/dist_01KNQEZ5VJP009416G2GQ4XDMD",
  "entityType": "Distribution",
  "primaryLabel": "RECS data tables",
  "secondaryLabel": "EIA Residential Energy Consumption Survey",
  "aliases": [],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "datasetId": "https://id.skygest.io/dataset/ds_01KNQEZ5VJN9W80ZWZRJX6EYW7",
  "accessHostname": "eia.gov",
  "canonicalUrls": [
    "eia.gov/consumption/residential/data"
  ],
  "payloadJson": "{\"_tag\":\"Distribution\",\"id\":\"https://id.skygest.io/distribution/dist_01KNQEZ5VJP009416G2GQ4XDMD\",\"datasetId\":\"https://id.skygest.io/dataset/ds_01KNQEZ5VJN9W80ZWZRJX6EYW7\",\"kind\":\"landing-page\",\"title\":\"RECS data tables\",\"accessURL\":\"https://www.eia.gov/consumption/residential/data/\",\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-08T00:00:00.000Z\",\"aliases\":[]}",
  "primaryText": "RECS data tables\nlanding-page",
  "aliasText": "RECS data tables",
  "lineageText": "EIA Residential Energy Consumption Survey\nU.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/",
  "urlText": "eia.gov/consumption/residential/data\neia.gov\neia.gov/consumption\neia.gov/consumption/residential",
  "ontologyText": "landing-page",
  "semanticText": "RECS data tables\nlanding-page\nRECS data tables\nEIA Residential Energy Consumption Survey\nU.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\neia.gov/consumption/residential/data\neia.gov\neia.gov/consumption\neia.gov/consumption/residential\nlanding-page",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

</details>

#### Average Example — `https://id.skygest.io/distribution/dist_01KP69GMWHRQ0SCCPMXGGFV3BX`

What works: download and access URLs expand into normalized host and prefix text, which is useful for exact and hostname probes. What is surprising: the primary label is a raw URL because the source distribution has no title. What is missing: dataset-derived variable facets are empty because the current catalog never links Variables back into Datasets.

<details>
<summary>Source Row</summary>

```json
{
  "_tag": "Distribution",
  "id": "https://id.skygest.io/distribution/dist_01KP69GMWHRQ0SCCPMXGGFV3BX",
  "datasetId": "https://id.skygest.io/dataset/ds_01KP69GMWHK5MV6XQ20ENJW3WM",
  "kind": "api-access",
  "accessURL": "https://api.eia.gov/v2/natural-gas/prod/oilwells/",
  "createdAt": "2026-04-14T15:24:46.023Z",
  "updatedAt": "2026-04-14T15:24:46.023Z",
  "aliases": []
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/distribution/dist_01KP69GMWHRQ0SCCPMXGGFV3BX",
  "entityType": "Distribution",
  "primaryLabel": "https://api.eia.gov/v2/natural-gas/prod/oilwells/",
  "secondaryLabel": "Natural Gas · Prod · Oilwells",
  "aliases": [],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "datasetId": "https://id.skygest.io/dataset/ds_01KP69GMWHK5MV6XQ20ENJW3WM",
  "accessHostname": "api.eia.gov",
  "canonicalUrls": [
    "api.eia.gov/v2/natural-gas/prod/oilwells"
  ],
  "payloadJson": "{\"_tag\":\"Distribution\",\"id\":\"https://id.skygest.io/distribution/dist_01KP69GMWHRQ0SCCPMXGGFV3BX\",\"datasetId\":\"https://id.skygest.io/dataset/ds_01KP69GMWHK5MV6XQ20ENJW3WM\",\"kind\":\"api-access\",\"accessURL\":\"https://api.eia.gov/v2/natural-gas/prod/oilwells/\",\"createdAt\":\"2026-04-14T15:24:46.023Z\",\"updatedAt\":\"2026-04-14T15:24:46.023Z\",\"aliases\":[]}",
  "primaryText": "api-access",
  "aliasText": "https://api.eia.gov/v2/natural-gas/prod/oilwells/",
  "lineageText": "Natural Gas · Prod · Oilwells\nU.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/",
  "urlText": "api.eia.gov/v2/natural-gas/prod/oilwells\napi.eia.gov\napi.eia.gov/v2\napi.eia.gov/v2/natural-gas\napi.eia.gov/v2/natural-gas/prod",
  "ontologyText": "api-access",
  "semanticText": "api-access\nhttps://api.eia.gov/v2/natural-gas/prod/oilwells/\nNatural Gas · Prod · Oilwells\nU.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\napi.eia.gov/v2/natural-gas/prod/oilwells\napi.eia.gov\napi.eia.gov/v2\napi.eia.gov/v2/natural-gas\napi.eia.gov/v2/natural-gas/prod",
  "updatedAt": "2026-04-14T15:24:46.023Z"
}
```

</details>

#### Rich Example — `https://id.skygest.io/distribution/dist_01KP4W1EB6W8D338JZ1ADNF66M`

What works: download and access URLs expand into normalized host and prefix text, which is useful for exact and hostname probes. What is surprising: the title is strong enough that the row reads like a real named document. What is missing: dataset-derived variable facets are empty because the current catalog never links Variables back into Datasets.

<details>
<summary>Source Row</summary>

```json
{
  "_tag": "Distribution",
  "id": "https://id.skygest.io/distribution/dist_01KP4W1EB6W8D338JZ1ADNF66M",
  "datasetId": "https://id.skygest.io/dataset/ds_01KP4W1EB3WEEP73H8EMT1AKVM",
  "kind": "download",
  "title": "Road Transport Summary (ED5) 2025",
  "description": "One of the FES outputs is an agreed set of data tables containing the GB FES values for road transport which are included in this dataset. The file is the 2025 version of the dataset.",
  "downloadURL": "https://api.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv",
  "mediaType": "text/csv",
  "format": "csv",
  "accessRights": "public",
  "license": "https://www.neso.energy/data-portal/ngeso-open-licence",
  "accessServiceId": "https://id.skygest.io/data-service/svc_01KP4W1DWZG3S96C6XZD3YG71N",
  "createdAt": "2026-04-14T02:09:59.759Z",
  "updatedAt": "2026-04-14T15:25:34.063Z",
  "aliases": [
    {
      "scheme": "url",
      "value": "https://api.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv",
      "relation": "exactMatch"
    }
  ]
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/distribution/dist_01KP4W1EB6W8D338JZ1ADNF66M",
  "entityType": "Distribution",
  "primaryLabel": "Road Transport Summary (ED5) 2025",
  "secondaryLabel": "One of the FES outputs is an agreed set of data tables containing the GB FES values for road transport which are included in this dataset. The file is the 2025 version of the dataset.",
  "aliases": [
    {
      "scheme": "url",
      "value": "https://api.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv",
      "relation": "exactMatch"
    }
  ],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KP172ZRBS4Z4NGY24XA7YX6D",
  "datasetId": "https://id.skygest.io/dataset/ds_01KP4W1EB3WEEP73H8EMT1AKVM",
  "downloadHostname": "api.neso.energy",
  "canonicalUrls": [
    "api.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv"
  ],
  "payloadJson": "{\"_tag\":\"Distribution\",\"id\":\"https://id.skygest.io/distribution/dist_01KP4W1EB6W8D338JZ1ADNF66M\",\"datasetId\":\"https://id.skygest.io/dataset/ds_01KP4W1EB3WEEP73H8EMT1AKVM\",\"kind\":\"download\",\"title\":\"Road Transport Summary (ED5) 2025\",\"description\":\"One of the FES outputs is an agreed set of data tables containing the GB FES values for road transport which are included in this dataset. The file is the 2025 version of the dataset.\",\"downloadURL\":\"https://api.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv\",\"mediaType\":\"text/csv\",\"format\":\"csv\",\"accessRights\":\"public\",\"license\":\"https://www.neso.energy/data-portal/ngeso-open-licence\",\"accessServiceId\":\"https://id.skygest.io/data-service/svc_01KP4W1DWZG3S96C6XZD3YG71N\",\"createdAt\":\"2026-04-14T02:09:59.759Z\",\"updatedAt\":\"2026-04-14T15:25:34.063Z\",\"aliases\":[{\"scheme\":\"url\",\"value\":\"https://api.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv\",\"relation\":\"exactMatch\"}]}",
  "primaryText": "Road Transport Summary (ED5) 2025\nOne of the FES outputs is an agreed set of data tables containing the GB FES values for road transport which are included in this dataset. The file is the 2025 version of the dataset.\ndownload\ntext/csv\ncsv",
  "aliasText": "https://api.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv",
  "lineageText": "FES: Pathways to Net Zero – Road Transport Summary Data table (ED5)\nNational Energy System Operator (NESO)\nNESO\nNational Energy System Operator\nhttps://www.neso.energy/\nQ130538498",
  "urlText": "api.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv\napi.neso.energy\napi.neso.energy/dataset\napi.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb\napi.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource\napi.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4\napi.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download",
  "ontologyText": "download\ntext/csv\ncsv",
  "semanticText": "Road Transport Summary (ED5) 2025\nOne of the FES outputs is an agreed set of data tables containing the GB FES values for road transport which are included in this dataset. The file is the 2025 version of the dataset.\ndownload\ntext/csv\ncsv\nhttps://api.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv\nFES: Pathways to Net Zero – Road Transport Summary Data table (ED5)\nNational Energy System Operator (NESO)\nNESO\nNational Energy System Operator\nhttps://www.neso.energy/\nQ130538498\napi.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download/fes2025_ed5_v006.csv\napi.neso.energy\napi.neso.energy/dataset\napi.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb\napi.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource\napi.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4\napi.neso.energy/dataset/28303fe9-62d4-46c5-ad15-a1d0e59f98cb/resource/ce76da34-6eb0-43a1-8e93-3cc833d6d1b4/download\ndownload\ntext/csv\ncsv",
  "updatedAt": "2026-04-14T15:25:34.063Z"
}
```

</details>

### 4.4 Series

H3 remains the right check, but the projector is now broader than the original version: Series rows can inherit canonical URLs from their own aliases plus parent Dataset / Distribution surfaces (`src/search/projectEntitySearchDocs.ts:485-575`). The remaining blind spot is the residual set with no inherited or native URL evidence. In this corpus, 0 of 29 Series rows (0.0%) still have no canonical URL surface at all.

The concrete probe used here was Distribution `https://id.skygest.io/distribution/dist_01KNQEZ5VH6D2AT4HKRTB707PR` (State CO2 data portal) from Dataset `https://id.skygest.io/dataset/ds_01KNQEZ5VHGV1ZECFSTCKW0B2R`. The raw URL was "https://www.eia.gov/environment/emissions/state/" and the normalized URL stored in the exact-URL table was "eia.gov/environment/emissions/state".

```sql
SELECT d.entity_id, d.entity_type, d.primary_label
FROM entity_search_docs d
WHERE EXISTS (
  SELECT 1
  FROM entity_search_doc_urls exact_url
  WHERE exact_url.entity_id = d.entity_id
    AND exact_url.canonical_url = 'eia.gov/environment/emissions/state'
)
ORDER BY d.updated_at DESC, d.entity_id ASC
LIMIT 10;
```

| Rank | Entity type | Entity ID | Label |
| --- | --- | --- | --- |
| 1 | Dataset | https://id.skygest.io/dataset/ds_01KNQEZ5VHGV1ZECFSTCKW0B2R | EIA State CO2 Emissions |
| 2 | Distribution | https://id.skygest.io/distribution/dist_01KNQEZ5VH6D2AT4HKRTB707PR | State CO2 data portal |
| 3 | Series | https://id.skygest.io/series/ser_01KNQEZ5XABVZJXM3Y5TJHFJCP | U.S. CO2 emissions by state (annual) |

```sql
SELECT d.entity_id, d.entity_type, d.primary_label
FROM entity_search_docs d
WHERE d.homepage_hostname = 'eia.gov'
   OR d.landing_page_hostname = 'eia.gov'
   OR d.access_hostname = 'eia.gov'
   OR d.download_hostname = 'eia.gov'
ORDER BY d.updated_at DESC, d.entity_id ASC
LIMIT 10;
```

| Rank | Entity type | Entity ID | Label |
| --- | --- | --- | --- |
| 1 | Agent | https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB | U.S. Energy Information Administration |
| 2 | Dataset | https://id.skygest.io/dataset/ds_01KNQEZ5VHCC948KABFB2VQA15 | Short Term Energy Outlook |
| 3 | Dataset | https://id.skygest.io/dataset/ds_01KNQEZ5VJGMGDN5DWN3P10VNB | International |
| 4 | Dataset | https://id.skygest.io/dataset/ds_01KNQSXEPT4PS668K7WZ4QAY80 | Total Energy |
| 5 | Dataset | https://id.skygest.io/dataset/ds_01KNQEZ5VHCC3BMQX00JTTGNMH | EIA Electricity Data |
| 6 | Dataset | https://id.skygest.io/dataset/ds_01KNQEZ5VHGV1ZECFSTCKW0B2R | EIA State CO2 Emissions |
| 7 | Dataset | https://id.skygest.io/dataset/ds_01KNQEZ5VHP6M9Z732WJY61H35 | EIA Today in Energy |
| 8 | Dataset | https://id.skygest.io/dataset/ds_01KNQEZ5VJ4G7F7NP1DKQ57CQV | EIA Annual Energy Outlook |
| 9 | Dataset | https://id.skygest.io/dataset/ds_01KNQEZ5VJ626BQSJJ7JETCR44 | EIA U.S. Electricity Generation |
| 10 | Dataset | https://id.skygest.io/dataset/ds_01KNQEZ5VJGV0QA4D64977EPXY | EIA Petroleum Navigator |

Related Series candidate(s): `https://id.skygest.io/series/ser_01KNQEZ5XABVZJXM3Y5TJHFJCP` (U.S. CO2 emissions by state (annual)). Result: no related Series surfaced in the exact URL hits and none surfaced in the exact hostname hits.

#### Sparse Example — `https://id.skygest.io/series/ser_01KNQEZ5XCD2DKK1WG2KHWVR99`

What works: fixed dimensions and variable ontology land cleanly in `lineage_text` and `ontology_text`, and parent dataset/distribution URL surfaces can now be projected onto the Series row. What is surprising: `primary_text` and `alias_text` still collapse quickly when Series rows have little native alias coverage. What is missing: any Series row that still has zero canonical URLs remains unreachable from exact URL evidence.

<details>
<summary>Source Row</summary>

```json
{
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z",
  "aliases": [],
  "_tag": "Series",
  "id": "https://id.skygest.io/series/ser_01KNQEZ5XCD2DKK1WG2KHWVR99",
  "label": "Global clean energy investment (annual)",
  "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WN17BV79YERCQWG27E",
  "datasetId": "https://id.skygest.io/dataset/ds_01KNQEZ5VKBNWTX6A3DEP1JRWT",
  "fixedDims": {
    "place": "GLOBAL",
    "frequency": "annual"
  }
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/series/ser_01KNQEZ5XCD2DKK1WG2KHWVR99",
  "entityType": "Series",
  "primaryLabel": "Global clean energy investment (annual)",
  "secondaryLabel": "IEA World Energy Investment",
  "aliases": [],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5VEXGPY479BCNJPJZMS",
  "datasetId": "https://id.skygest.io/dataset/ds_01KNQEZ5VKBNWTX6A3DEP1JRWT",
  "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WN17BV79YERCQWG27E",
  "seriesId": "https://id.skygest.io/series/ser_01KNQEZ5XCD2DKK1WG2KHWVR99",
  "measuredProperty": "investment",
  "domainObject": "clean energy",
  "statisticType": "flow",
  "aggregation": "sum",
  "unitFamily": "currency",
  "frequency": "annual",
  "place": "GLOBAL",
  "landingPageHostname": "iea.org",
  "accessHostname": "iea.org",
  "canonicalUrls": [
    "iea.org/reports/world-energy-investment"
  ],
  "payloadJson": "{\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-08T00:00:00.000Z\",\"aliases\":[],\"_tag\":\"Series\",\"id\":\"https://id.skygest.io/series/ser_01KNQEZ5XCD2DKK1WG2KHWVR99\",\"label\":\"Global clean energy investment (annual)\",\"variableId\":\"https://id.skygest.io/variable/var_01KNQEZ5WN17BV79YERCQWG27E\",\"datasetId\":\"https://id.skygest.io/dataset/ds_01KNQEZ5VKBNWTX6A3DEP1JRWT\",\"fixedDims\":{\"place\":\"GLOBAL\",\"frequency\":\"annual\"}}",
  "primaryText": "Global clean energy investment (annual)",
  "aliasText": "Global clean energy investment (annual)",
  "lineageText": "IEA World Energy Investment\nInternational Energy Agency\nIEA\nhttps://ror.org/020frhs78\nQ826700\nhttps://www.iea.org/\nClean energy investment\nCapital invested in clean energy supply including renewables, nuclear, and grids\nGLOBAL\nannual\nWorld Energy Investment report\niea.org",
  "urlText": "iea.org/reports/world-energy-investment\niea.org/reports",
  "ontologyText": "GLOBAL\nannual\ninvestment\nclean energy\nflow\nsum\ncurrency",
  "semanticText": "Global clean energy investment (annual)\nIEA World Energy Investment\nInternational Energy Agency\nIEA\nhttps://ror.org/020frhs78\nQ826700\nhttps://www.iea.org/\nClean energy investment\nCapital invested in clean energy supply including renewables, nuclear, and grids\nGLOBAL\nannual\nWorld Energy Investment report\niea.org\niea.org/reports/world-energy-investment\niea.org/reports\nGLOBAL\nannual\ninvestment\nclean energy\nflow\nsum\ncurrency",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

</details>

#### Average Example — `https://id.skygest.io/series/ser_01KNQEZ5XCD9GTJ99N6J4AYRK6`

What works: fixed dimensions and variable ontology land cleanly in `lineage_text` and `ontology_text`, and parent dataset/distribution URL surfaces can now be projected onto the Series row. What is surprising: `primary_text` and `alias_text` still collapse quickly when Series rows have little native alias coverage. What is missing: any Series row that still has zero canonical URLs remains unreachable from exact URL evidence.

<details>
<summary>Source Row</summary>

```json
{
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z",
  "aliases": [],
  "_tag": "Series",
  "id": "https://id.skygest.io/series/ser_01KNQEZ5XCD9GTJ99N6J4AYRK6",
  "label": "Global electricity generation (annual)",
  "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH",
  "datasetId": "https://id.skygest.io/dataset/ds_01KNX53R149V3QYRSNC9SVJ8NF",
  "fixedDims": {
    "place": "GLOBAL",
    "frequency": "annual"
  }
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/series/ser_01KNQEZ5XCD9GTJ99N6J4AYRK6",
  "entityType": "Series",
  "primaryLabel": "Global electricity generation (annual)",
  "secondaryLabel": "Ember Electricity Generation Yearly",
  "aliases": [],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1",
  "datasetId": "https://id.skygest.io/dataset/ds_01KNX53R149V3QYRSNC9SVJ8NF",
  "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH",
  "seriesId": "https://id.skygest.io/series/ser_01KNQEZ5XCD9GTJ99N6J4AYRK6",
  "measuredProperty": "generation",
  "domainObject": "electricity",
  "statisticType": "flow",
  "aggregation": "sum",
  "unitFamily": "energy",
  "frequency": "annual",
  "place": "GLOBAL",
  "accessHostname": "api.ember-energy.org",
  "canonicalUrls": [
    "api.ember-energy.org/v1/electricity-generation/yearly"
  ],
  "payloadJson": "{\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-08T00:00:00.000Z\",\"aliases\":[],\"_tag\":\"Series\",\"id\":\"https://id.skygest.io/series/ser_01KNQEZ5XCD9GTJ99N6J4AYRK6\",\"label\":\"Global electricity generation (annual)\",\"variableId\":\"https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH\",\"datasetId\":\"https://id.skygest.io/dataset/ds_01KNX53R149V3QYRSNC9SVJ8NF\",\"fixedDims\":{\"place\":\"GLOBAL\",\"frequency\":\"annual\"}}",
  "primaryText": "Global electricity generation (annual)",
  "aliasText": "Global electricity generation (annual)",
  "lineageText": "Ember Electricity Generation Yearly\nEmber\nEmber Climate\nQ7416010\nhttps://ember-climate.org/\nhttps://ember-energy.org/\nElectricity generation\nTotal electrical energy produced by all sources\nGLOBAL\nannual\nEmber Electricity Generation Yearly API\napi.ember-energy.org",
  "urlText": "api.ember-energy.org/v1/electricity-generation/yearly\napi.ember-energy.org/v1\napi.ember-energy.org/v1/electricity-generation",
  "ontologyText": "GLOBAL\nannual\ngeneration\nelectricity\nflow\nsum\nenergy",
  "semanticText": "Global electricity generation (annual)\nEmber Electricity Generation Yearly\nEmber\nEmber Climate\nQ7416010\nhttps://ember-climate.org/\nhttps://ember-energy.org/\nElectricity generation\nTotal electrical energy produced by all sources\nGLOBAL\nannual\nEmber Electricity Generation Yearly API\napi.ember-energy.org\napi.ember-energy.org/v1/electricity-generation/yearly\napi.ember-energy.org/v1\napi.ember-energy.org/v1/electricity-generation\nGLOBAL\nannual\ngeneration\nelectricity\nflow\nsum\nenergy",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

</details>

#### Rich Example — `https://id.skygest.io/series/ser_01KNQEZ5XA1FY6T4MMQ075S84B`

What works: fixed dimensions and variable ontology land cleanly in `lineage_text` and `ontology_text`, and parent dataset/distribution URL surfaces can now be projected onto the Series row. What is surprising: `primary_text` and `alias_text` still collapse quickly when Series rows have little native alias coverage. What is missing: any Series row that still has zero canonical URLs remains unreachable from exact URL evidence.

<details>
<summary>Source Row</summary>

```json
{
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z",
  "aliases": [],
  "_tag": "Series",
  "id": "https://id.skygest.io/series/ser_01KNQEZ5XA1FY6T4MMQ075S84B",
  "label": "U.S. electricity generation (annual)",
  "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH",
  "datasetId": "https://id.skygest.io/dataset/ds_01KNQEZ5VJ626BQSJJ7JETCR44",
  "fixedDims": {
    "place": "US",
    "frequency": "annual"
  }
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/series/ser_01KNQEZ5XA1FY6T4MMQ075S84B",
  "entityType": "Series",
  "primaryLabel": "U.S. electricity generation (annual)",
  "secondaryLabel": "EIA U.S. Electricity Generation",
  "aliases": [],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB",
  "datasetId": "https://id.skygest.io/dataset/ds_01KNQEZ5VJ626BQSJJ7JETCR44",
  "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH",
  "seriesId": "https://id.skygest.io/series/ser_01KNQEZ5XA1FY6T4MMQ075S84B",
  "measuredProperty": "generation",
  "domainObject": "electricity",
  "statisticType": "flow",
  "aggregation": "sum",
  "unitFamily": "energy",
  "frequency": "annual",
  "place": "US",
  "landingPageHostname": "eia.gov",
  "canonicalUrls": [
    "eia.gov/electricity/monthly",
    "api.eia.gov/v2/electricity/electric-power-operational-data"
  ],
  "payloadJson": "{\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-08T00:00:00.000Z\",\"aliases\":[],\"_tag\":\"Series\",\"id\":\"https://id.skygest.io/series/ser_01KNQEZ5XA1FY6T4MMQ075S84B\",\"label\":\"U.S. electricity generation (annual)\",\"variableId\":\"https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH\",\"datasetId\":\"https://id.skygest.io/dataset/ds_01KNQEZ5VJ626BQSJJ7JETCR44\",\"fixedDims\":{\"place\":\"US\",\"frequency\":\"annual\"}}",
  "primaryText": "U.S. electricity generation (annual)",
  "aliasText": "U.S. electricity generation (annual)",
  "lineageText": "EIA U.S. Electricity Generation\nU.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\nElectricity generation\nTotal electrical energy produced by all sources\nUS\nannual\nEIA Open Data API — U.S. Electricity Generation\napi.eia.gov\nElectric Power Monthly\neia.gov",
  "urlText": "eia.gov/electricity/monthly\napi.eia.gov/v2/electricity/electric-power-operational-data\neia.gov/electricity\napi.eia.gov/v2\napi.eia.gov/v2/electricity",
  "ontologyText": "US\nannual\ngeneration\nelectricity\nflow\nsum\nenergy",
  "semanticText": "U.S. electricity generation (annual)\nEIA U.S. Electricity Generation\nU.S. Energy Information Administration\nEIA\nUS Energy Information Administration\nEnergy Information Administration\nhttps://ror.org/01h04ms65\nQ1133499\nhttps://www.eia.gov/\nElectricity generation\nTotal electrical energy produced by all sources\nUS\nannual\nEIA Open Data API — U.S. Electricity Generation\napi.eia.gov\nElectric Power Monthly\neia.gov\neia.gov/electricity/monthly\napi.eia.gov/v2/electricity/electric-power-operational-data\neia.gov/electricity\napi.eia.gov/v2\napi.eia.gov/v2/electricity\nUS\nannual\ngeneration\nelectricity\nflow\nsum\nenergy",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

</details>

### 4.5 Variable

The requested multi-parent analysis also bottoms out on missing parent links. All 25 Variable rows currently have zero parent datasets, so `uniqueDatasetId` and `uniquePublisherId` in `src/search/projectEntitySearchDocs.ts:243-251` and :624-625 are never able to resolve. There are no true multi-parent conflicts in the checked-in corpus because there are no parent links to compare.

| Summary | Count |
| --- | --- |
| Total Variables | 25 |
| No parent datasets | 9 |
| Multiple datasets | 7 |
| Multiple publishers | 0 |

#### Sparse Example — `https://id.skygest.io/variable/var_01KNQEZ5WMARTRPG4KZMWMZ82Y`

What works: the variable definition and ontology facets survive intact. What is surprising: lineage depends entirely on reverse links from Datasets and Series, so rows with no linked Dataset parents collapse toward the label. What is missing: there is no resolved parent dataset or publisher scope on any Variable row in this corpus.

<details>
<summary>Source Row</summary>

```json
{
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z",
  "aliases": [],
  "_tag": "Variable",
  "id": "https://id.skygest.io/variable/var_01KNQEZ5WMARTRPG4KZMWMZ82Y",
  "label": "Installed nuclear capacity",
  "definition": "Nameplate capacity of operational nuclear reactors",
  "measuredProperty": "capacity",
  "domainObject": "nuclear reactor",
  "technologyOrFuel": "nuclear",
  "statisticType": "stock",
  "aggregation": "end_of_period",
  "unitFamily": "power"
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/variable/var_01KNQEZ5WMARTRPG4KZMWMZ82Y",
  "entityType": "Variable",
  "primaryLabel": "Installed nuclear capacity",
  "secondaryLabel": "Nameplate capacity of operational nuclear reactors",
  "aliases": [],
  "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WMARTRPG4KZMWMZ82Y",
  "measuredProperty": "capacity",
  "domainObject": "nuclear reactor",
  "technologyOrFuel": "nuclear",
  "statisticType": "stock",
  "aggregation": "end_of_period",
  "unitFamily": "power",
  "canonicalUrls": [],
  "payloadJson": "{\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-08T00:00:00.000Z\",\"aliases\":[],\"_tag\":\"Variable\",\"id\":\"https://id.skygest.io/variable/var_01KNQEZ5WMARTRPG4KZMWMZ82Y\",\"label\":\"Installed nuclear capacity\",\"definition\":\"Nameplate capacity of operational nuclear reactors\",\"measuredProperty\":\"capacity\",\"domainObject\":\"nuclear reactor\",\"technologyOrFuel\":\"nuclear\",\"statisticType\":\"stock\",\"aggregation\":\"end_of_period\",\"unitFamily\":\"power\"}",
  "primaryText": "Installed nuclear capacity\nNameplate capacity of operational nuclear reactors",
  "aliasText": "Installed nuclear capacity",
  "lineageText": "Installed nuclear capacity",
  "urlText": "Installed nuclear capacity",
  "ontologyText": "capacity\nnuclear reactor\nnuclear\nstock\nend_of_period\npower",
  "semanticText": "Installed nuclear capacity\nNameplate capacity of operational nuclear reactors\nInstalled nuclear capacity\ncapacity\nnuclear reactor\nnuclear\nstock\nend_of_period\npower",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

</details>

#### Average Example — `https://id.skygest.io/variable/var_01KNQEZ5WN17BV79YERCQWG27E`

What works: the variable definition and ontology facets survive intact. What is surprising: lineage depends entirely on reverse links from Datasets and Series, so rows with no linked Dataset parents collapse toward the label. What is missing: there is no resolved parent dataset or publisher scope on any Variable row in this corpus.

<details>
<summary>Source Row</summary>

```json
{
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z",
  "aliases": [],
  "_tag": "Variable",
  "id": "https://id.skygest.io/variable/var_01KNQEZ5WN17BV79YERCQWG27E",
  "label": "Clean energy investment",
  "definition": "Capital invested in clean energy supply including renewables, nuclear, and grids",
  "measuredProperty": "investment",
  "domainObject": "clean energy",
  "statisticType": "flow",
  "aggregation": "sum",
  "unitFamily": "currency"
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/variable/var_01KNQEZ5WN17BV79YERCQWG27E",
  "entityType": "Variable",
  "primaryLabel": "Clean energy investment",
  "secondaryLabel": "Capital invested in clean energy supply including renewables, nuclear, and grids",
  "aliases": [],
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQEZ5VEXGPY479BCNJPJZMS",
  "datasetId": "https://id.skygest.io/dataset/ds_01KNQEZ5VKBNWTX6A3DEP1JRWT",
  "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WN17BV79YERCQWG27E",
  "measuredProperty": "investment",
  "domainObject": "clean energy",
  "statisticType": "flow",
  "aggregation": "sum",
  "unitFamily": "currency",
  "canonicalUrls": [],
  "payloadJson": "{\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-08T00:00:00.000Z\",\"aliases\":[],\"_tag\":\"Variable\",\"id\":\"https://id.skygest.io/variable/var_01KNQEZ5WN17BV79YERCQWG27E\",\"label\":\"Clean energy investment\",\"definition\":\"Capital invested in clean energy supply including renewables, nuclear, and grids\",\"measuredProperty\":\"investment\",\"domainObject\":\"clean energy\",\"statisticType\":\"flow\",\"aggregation\":\"sum\",\"unitFamily\":\"currency\"}",
  "primaryText": "Clean energy investment\nCapital invested in clean energy supply including renewables, nuclear, and grids",
  "aliasText": "Clean energy investment",
  "lineageText": "IEA World Energy Investment\nGlobal clean energy investment (annual)\nInternational Energy Agency\nIEA\nhttps://ror.org/020frhs78\nQ826700\nhttps://www.iea.org/\niea.org",
  "urlText": "Clean energy investment",
  "ontologyText": "investment\nclean energy\nflow\nsum\ncurrency",
  "semanticText": "Clean energy investment\nCapital invested in clean energy supply including renewables, nuclear, and grids\nClean energy investment\nIEA World Energy Investment\nGlobal clean energy investment (annual)\nInternational Energy Agency\nIEA\nhttps://ror.org/020frhs78\nQ826700\nhttps://www.iea.org/\niea.org\ninvestment\nclean energy\nflow\nsum\ncurrency",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

</details>

#### Rich Example — `https://id.skygest.io/variable/var_01KNQEZ5WN50KM85CVJQWYFMTY`

What works: the variable definition and ontology facets survive intact. What is surprising: lineage depends entirely on reverse links from Datasets and Series, so rows with no linked Dataset parents collapse toward the label. What is missing: there is no resolved parent dataset or publisher scope on any Variable row in this corpus.

<details>
<summary>Source Row</summary>

```json
{
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z",
  "aliases": [],
  "_tag": "Variable",
  "id": "https://id.skygest.io/variable/var_01KNQEZ5WN50KM85CVJQWYFMTY",
  "label": "Clean electricity share",
  "definition": "Proportion of electricity generation from non-fossil sources",
  "measuredProperty": "share",
  "domainObject": "electricity",
  "statisticType": "share",
  "unitFamily": "dimensionless"
}
```

</details>

<details>
<summary>Projection Output</summary>

```json
{
  "entityId": "https://id.skygest.io/variable/var_01KNQEZ5WN50KM85CVJQWYFMTY",
  "entityType": "Variable",
  "primaryLabel": "Clean electricity share",
  "secondaryLabel": "Proportion of electricity generation from non-fossil sources",
  "aliases": [],
  "variableId": "https://id.skygest.io/variable/var_01KNQEZ5WN50KM85CVJQWYFMTY",
  "measuredProperty": "share",
  "domainObject": "electricity",
  "statisticType": "share",
  "unitFamily": "dimensionless",
  "canonicalUrls": [],
  "payloadJson": "{\"createdAt\":\"2026-04-08T00:00:00.000Z\",\"updatedAt\":\"2026-04-08T00:00:00.000Z\",\"aliases\":[],\"_tag\":\"Variable\",\"id\":\"https://id.skygest.io/variable/var_01KNQEZ5WN50KM85CVJQWYFMTY\",\"label\":\"Clean electricity share\",\"definition\":\"Proportion of electricity generation from non-fossil sources\",\"measuredProperty\":\"share\",\"domainObject\":\"electricity\",\"statisticType\":\"share\",\"unitFamily\":\"dimensionless\"}",
  "primaryText": "Clean electricity share\nProportion of electricity generation from non-fossil sources",
  "aliasText": "Clean electricity share",
  "lineageText": "CAISO Today's Outlook\nEmber Electricity Generation Monthly\nCAISO clean electricity share (daily)\nSouth Africa clean electricity share (monthly)\nCalifornia Independent System Operator\nCAISO\nCalifornia ISO\nCalifornia Independent System Operator Corporation\nQ16850559\nhttps://www.caiso.com/\nhttps://oasis.caiso.com\nEmber\nEmber Climate\nQ7416010\nhttps://ember-climate.org/\nhttps://ember-energy.org/\ncaiso.com\noasis.caiso.com\napi.ember-energy.org",
  "urlText": "Clean electricity share",
  "ontologyText": "share\nelectricity\ndimensionless",
  "semanticText": "Clean electricity share\nProportion of electricity generation from non-fossil sources\nClean electricity share\nCAISO Today's Outlook\nEmber Electricity Generation Monthly\nCAISO clean electricity share (daily)\nSouth Africa clean electricity share (monthly)\nCalifornia Independent System Operator\nCAISO\nCalifornia ISO\nCalifornia Independent System Operator Corporation\nQ16850559\nhttps://www.caiso.com/\nhttps://oasis.caiso.com\nEmber\nEmber Climate\nQ7416010\nhttps://ember-climate.org/\nhttps://ember-energy.org/\ncaiso.com\noasis.caiso.com\napi.ember-energy.org\nshare\nelectricity\ndimensionless",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

</details>

## 5. Cross-Cutting Findings

H6 is refuted: the query path does use the same normalization rule as projection time. Projection normalizes canonical URLs and hostnames in `src/search/projectEntitySearchDocs.ts:173-181` plus `src/search/searchSignals.ts:75-118`, and query-side exact URL / hostname probes normalize inputs in `src/services/d1/EntitySearchRepoD1.ts:397-470`. The probe `exactHostnames = ["www.eia.gov"]` returned the same `eia.gov` hits as the normalized form, and `exactCanonicalUrls = ["https://www.eia.gov/electricity/monthly/"]` returned the expected Dataset and Distribution rows.

H7 is also refuted in its original form. `semantic_text` is not in the FTS schema (`src/search/migrations.ts:51-61`), but it is not 5-6x larger than the searchable columns either. Mean `semantic_text` size is 784.4 bytes versus 781.3 bytes for the five indexed text columns combined, a ratio of 1.00x. The important sizing takeaway is different: `semantic_text` is effectively a second full copy of the lexical surface, not a tiny reserved appendix.

Three additional empirical findings not explicitly requested:

| Finding | Evidence | Why it matters |
| --- | --- | --- |
| Distribution URL labels | 229 Distribution rows fall back to raw URLs as labels, heavily concentrated in EIA API access rows. | These rows will look broken in ranked snippets and any debugging UI. |
| Series URL lane is completely empty | 0 of 29 Series rows have zero canonical URLs. | Exact URL evidence cannot retrieve Series rows no matter how good the query compiler gets. |
| Dataset/Variable linkage is absent | 1,790 of 1,790 Datasets and 9 of 25 Variables have no cross-linking ancestry. | This blocks facet scoping, Variable lineage, and several of the typed exact-match fields all at once. |

FTS tokenization sanity notes from the local SQLite vocab table:

1. `unicode61` splits punctuation aggressively. `U.S.` becomes `u` + `s`, and `Energy-Charts` becomes `energy` + `charts`. See the EIA and Fraunhofer Agent samples in Appendix A.
2. URL aliases contribute many path tokens. For example, the NESO CSV distribution surfaces `dataset`, UUID fragments, `download`, and `csv` from its alias and URL columns.
3. Prefix matching is real: `sol*` matched 475 rows vs 285 for exact `solar`.
4. There is no stemming: `emissions` matched 113 rows while singular `emission` matched only 33.

## 6. Prioritized Recommendations

| Finding | Severity | Fix shape | Effort | Tradeoffs |
| --- | --- | --- | --- | --- |
| Dataset/Variable links are missing | High | Restore or generate Dataset -> Variable ancestry in the checked-in catalog before changing projection logic. | M | Requires catalog rebuild work, but unlocks seven facet fields plus Variable scope. |
| Series have no URL surface | High | Project selected Distribution canonical URLs or hostnames onto Series rows when a Dataset/Series relationship exists. | S | May widen Series recall; BM25 weights will need retuning to avoid URL over-dominance. |
| Raw URL fallback labels on Distributions | Medium | Use a friendlier fallback chain for title-less API distributions, e.g. dataset title + endpoint slug. | S | Improves readability without changing recall; requires a deterministic naming rule. |
| Agent ontology_text is constant | Low | Either add richer agent taxonomy or give Agent ontology negligible weight. | S | If taxonomy expands later, current neutral weighting avoids overfitting to a constant token. |
| semantic_text duplicates the lexical footprint | Low | Keep it out of FTS, but budget for near-2x text storage if embeddings are added later. | S | No immediate ranking risk; mostly a storage and embedding-cost consideration. |

## 7. Appendices

### A. SQL and Scripts Used

`bun run scripts/analysis/entity-search-audit/run-audit.ts`

```sql
-- Corpus size
SELECT entity_type, COUNT(*) AS count
FROM entity_search_docs
WHERE deleted_at IS NULL
GROUP BY entity_type
ORDER BY entity_type ASC;

SELECT COUNT(*) AS count
FROM entity_search_docs
WHERE deleted_at IS NULL;

SELECT COUNT(*) AS count FROM entity_search_doc_urls;
SELECT COUNT(*) AS count FROM entity_search_fts;

-- H3 exact URL probe
SELECT d.entity_id, d.entity_type, d.primary_label
FROM entity_search_docs d
WHERE EXISTS (
  SELECT 1
  FROM entity_search_doc_urls exact_url
  WHERE exact_url.entity_id = d.entity_id
    AND exact_url.canonical_url = 'eia.gov/environment/emissions/state'
)
ORDER BY d.updated_at DESC, d.entity_id ASC
LIMIT 10;

-- H3 exact hostname probe
SELECT d.entity_id, d.entity_type, d.primary_label
FROM entity_search_docs d
WHERE d.homepage_hostname = 'eia.gov'
   OR d.landing_page_hostname = 'eia.gov'
   OR d.access_hostname = 'eia.gov'
   OR d.download_hostname = 'eia.gov'
ORDER BY d.updated_at DESC, d.entity_id ASC
LIMIT 10;

-- FTS tokenization sanity
SELECT rowid, entity_id, entity_type, primary_text, alias_text, lineage_text, url_text, ontology_text
FROM entity_search_fts
WHERE entity_id IN ('https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1', 'https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB', 'https://id.skygest.io/agent/ag_01KNWVQMFHEZD7KVN03TEAVA1Q', 'https://id.skygest.io/dataset/ds_01KP69GMWRAVVDS356DNH4CKP4', 'https://id.skygest.io/dataset/ds_01KP69GMWE90WTY6GZHVVXND8H', 'https://id.skygest.io/dataset/ds_01KP4W1EA9PT4X1MW3E7QG3PD3', 'https://id.skygest.io/distribution/dist_01KNQEZ5VJP009416G2GQ4XDMD', 'https://id.skygest.io/distribution/dist_01KP69GMWHRQ0SCCPMXGGFV3BX', 'https://id.skygest.io/distribution/dist_01KP4W1EB6W8D338JZ1ADNF66M', 'https://id.skygest.io/series/ser_01KNQEZ5XCD2DKK1WG2KHWVR99')
ORDER BY entity_id ASC;

-- Prefix and stemming probes
SELECT COUNT(*) AS count FROM entity_search_fts WHERE entity_search_fts MATCH 'sol*';
SELECT COUNT(*) AS count FROM entity_search_fts WHERE entity_search_fts MATCH 'solar';
SELECT COUNT(*) AS count FROM entity_search_fts WHERE entity_search_fts MATCH 'emission';
SELECT COUNT(*) AS count FROM entity_search_fts WHERE entity_search_fts MATCH 'emissions';
```

### B. File:Line Citations

- `src/search/migrations.ts:3-73` — entity-search tables and FTS5 schema.
- `src/search/projectEntitySearchDocs.ts:173-181` — URL normalization helper used by the projector.
- `src/search/projectEntitySearchDocs.ts:253-302` — Agent projector.
- `src/search/projectEntitySearchDocs.ts:304-390` — Dataset projector.
- `src/search/projectEntitySearchDocs.ts:392-482` — Distribution projector.
- `src/search/projectEntitySearchDocs.ts:484-571` — Series projector.
- `src/search/projectEntitySearchDocs.ts:573-651` — Variable projector.
- `src/search/projectEntitySearchDocs.ts:671-679` — projection entrypoint.
- `src/search/searchSignals.ts:30-96` — text dedupe and URL normalization helpers.
- `src/services/d1/EntitySearchRepoD1.ts:397-470` — query normalization for exact URLs and hostnames.
- `src/services/d1/EntitySearchRepoD1.ts:956-1000` — overwrite-style upsert path.
- `src/services/d1/EntitySearchRepoD1.ts:1053-1194` — exact URL and hostname SQL paths.
- `src/services/d1/EntitySearchRepoD1.ts:1197-1381` — lexical FTS query and merge path.
- `scripts/rebuild-search-db.ts:71-164` — search DB rebuild and verification script.
- `src/bootstrap/CheckedInDataLayerRegistry.ts:21-223` — checked-in catalog loader used by the audit.

### C. Entity IDs Cited

- `https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB`
- `https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1`
- `https://id.skygest.io/agent/ag_01KNWVQMFHEZD7KVN03TEAVA1Q`
- `https://id.skygest.io/dataset/ds_01KNQEZ5VHCC3BMQX00JTTGNMH`
- `https://id.skygest.io/dataset/ds_01KNQEZ5VHCC948KABFB2VQA15`
- `https://id.skygest.io/dataset/ds_01KNQEZ5VHGV1ZECFSTCKW0B2R`
- `https://id.skygest.io/dataset/ds_01KNQEZ5VHP6M9Z732WJY61H35`
- `https://id.skygest.io/dataset/ds_01KNQEZ5VJ4G7F7NP1DKQ57CQV`
- `https://id.skygest.io/dataset/ds_01KNQEZ5VJ626BQSJJ7JETCR44`
- `https://id.skygest.io/dataset/ds_01KNQEZ5VJGMGDN5DWN3P10VNB`
- `https://id.skygest.io/dataset/ds_01KNQEZ5VJGV0QA4D64977EPXY`
- `https://id.skygest.io/dataset/ds_01KNQSXEPT4PS668K7WZ4QAY80`
- `https://id.skygest.io/dataset/ds_01KP4W1EA9PT4X1MW3E7QG3PD3`
- `https://id.skygest.io/dataset/ds_01KP69GMWE90WTY6GZHVVXND8H`
- `https://id.skygest.io/dataset/ds_01KP69GMWRAVVDS356DNH4CKP4`
- `https://id.skygest.io/distribution/dist_01KNQEZ5VH6D2AT4HKRTB707PR`
- `https://id.skygest.io/distribution/dist_01KNQEZ5VJB0QE6WEN9HJD5G5A`
- `https://id.skygest.io/distribution/dist_01KNQEZ5VJP009416G2GQ4XDMD`
- `https://id.skygest.io/distribution/dist_01KP4W1EB6W8D338JZ1ADNF66M`
- `https://id.skygest.io/distribution/dist_01KP69GMW914ANN2SD11HAZM7J`
- `https://id.skygest.io/distribution/dist_01KP69GMW9B41465PC577P1ZSS`
- `https://id.skygest.io/distribution/dist_01KP69GMWA3C40D3P4KCPADXR8`
- `https://id.skygest.io/distribution/dist_01KP69GMWA3PCJTRGJHSBFM8QA`
- `https://id.skygest.io/distribution/dist_01KP69GMWA3XJCH3RR0KRT0SKC`
- `https://id.skygest.io/distribution/dist_01KP69GMWAGCRWDGTEYKCH5BMZ`
- `https://id.skygest.io/distribution/dist_01KP69GMWAGGFGAHTP11MMTN2G`
- `https://id.skygest.io/distribution/dist_01KP69GMWAMP28P2XNKAME4T9Z`
- `https://id.skygest.io/distribution/dist_01KP69GMWAN3TCQADRHSJVFTFK`
- `https://id.skygest.io/distribution/dist_01KP69GMWAQXZMTCJ6QBPZ3FMV`
- `https://id.skygest.io/distribution/dist_01KP69GMWHRQ0SCCPMXGGFV3BX`
- `https://id.skygest.io/series/ser_01KNQEZ5XA1FY6T4MMQ075S84B`
- `https://id.skygest.io/series/ser_01KNQEZ5XABVZJXM3Y5TJHFJCP`
- `https://id.skygest.io/series/ser_01KNQEZ5XCD2DKK1WG2KHWVR99`
- `https://id.skygest.io/series/ser_01KNQEZ5XCD9GTJ99N6J4AYRK6`
- `https://id.skygest.io/variable/var_01KNQEZ5WMARTRPG4KZMWMZ82Y`
- `https://id.skygest.io/variable/var_01KNQEZ5WN17BV79YERCQWG27E`
- `https://id.skygest.io/variable/var_01KNQEZ5WN50KM85CVJQWYFMTY`

### D. Full Column Length Distribution Table (UTF-8 bytes)

| Entity type | Column | Count | Min | P25 | Median | P75 | P95 | Max | Mean | Primary-label-only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Agent | primaryText | 66 | 4.0 | 22.5 | 37.5 | 48.5 | 102.5 | 154.0 | 40.0 | 14 |
| Agent | aliasText | 66 | 20.0 | 35.3 | 53.0 | 71.0 | 124.5 | 130.0 | 56.5 | 0 |
| Agent | lineageText | 66 | 3.0 | 14.0 | 24.5 | 37.8 | 51.3 | 65.0 | 26.3 | 66 |
| Agent | urlText | 66 | 7.0 | 9.0 | 13.0 | 18.0 | 40.8 | 132.0 | 17.5 | 1 |
| Agent | ontologyText | 66 | 12.0 | 12.0 | 12.0 | 12.0 | 12.0 | 12.0 | 12.0 | 0 |
| Agent | semanticText | 66 | 51.0 | 109.8 | 139.5 | 172.0 | 307.8 | 370.0 | 152.6 | 0 |
| Dataset | primaryText | 1,790 | 27.0 | 146.0 | 279.0 | 560.8 | 1,999.4 | 11,847.0 | 571.5 | 0 |
| Dataset | aliasText | 1,790 | 2.0 | 22.0 | 39.0 | 73.0 | 113.0 | 320.0 | 51.7 | 171 |
| Dataset | lineageText | 1,790 | 38.0 | 120.0 | 160.0 | 181.0 | 223.5 | 438.0 | 153.0 | 0 |
| Dataset | urlText | 1,790 | 7.0 | 79.0 | 129.0 | 159.8 | 224.0 | 417.0 | 120.3 | 255 |
| Dataset | ontologyText | 1,790 | 4.0 | 25.0 | 52.0 | 67.0 | 103.5 | 424.0 | 50.8 | 0 |
| Dataset | semanticText | 1,790 | 159.0 | 446.5 | 689.0 | 1,044.8 | 2,408.2 | 12,309.0 | 951.1 | 0 |
| Distribution | primaryText | 3,530 | 10.0 | 38.0 | 48.0 | 244.0 | 834.1 | 11,841.0 | 250.8 | 0 |
| Distribution | aliasText | 3,530 | 8.0 | 16.0 | 29.0 | 95.0 | 131.5 | 441.0 | 54.4 | 2,133 |
| Distribution | lineageText | 3,530 | 53.0 | 99.0 | 112.0 | 142.0 | 196.0 | 372.0 | 124.0 | 0 |
| Distribution | urlText | 3,530 | 7.0 | 155.0 | 231.0 | 341.0 | 527.5 | 911.0 | 259.4 | 0 |
| Distribution | ontologyText | 3,530 | 8.0 | 17.0 | 21.0 | 32.0 | 37.0 | 393.0 | 24.9 | 0 |
| Distribution | semanticText | 3,530 | 140.0 | 395.0 | 573.0 | 757.0 | 1,474.6 | 12,584.0 | 716.8 | 0 |
| Series | primaryText | 29 | 17.0 | 33.0 | 36.0 | 39.0 | 48.2 | 49.0 | 36.4 | 29 |
| Series | aliasText | 29 | 17.0 | 33.0 | 36.0 | 39.0 | 48.2 | 49.0 | 36.4 | 29 |
| Series | lineageText | 29 | 228.0 | 263.0 | 303.0 | 335.0 | 387.6 | 412.0 | 303.6 | 0 |
| Series | urlText | 29 | 14.0 | 48.0 | 112.0 | 125.0 | 249.4 | 489.0 | 110.3 | 0 |
| Series | ontologyText | 29 | 42.0 | 52.0 | 61.0 | 65.0 | 77.2 | 80.0 | 60.1 | 0 |
| Series | semanticText | 29 | 362.0 | 445.0 | 480.0 | 575.0 | 723.4 | 921.0 | 513.4 | 0 |
| Variable | primaryText | 25 | 64.0 | 80.0 | 92.0 | 103.0 | 124.8 | 129.0 | 92.4 | 0 |
| Variable | aliasText | 25 | 12.0 | 22.0 | 25.0 | 28.0 | 31.8 | 34.0 | 24.0 | 23 |
| Variable | lineageText | 25 | 18.0 | 31.0 | 162.0 | 283.0 | 631.0 | 837.0 | 217.6 | 9 |
| Variable | urlText | 25 | 17.0 | 23.0 | 26.0 | 28.0 | 31.8 | 34.0 | 25.1 | 25 |
| Variable | ontologyText | 25 | 30.0 | 39.0 | 47.0 | 56.0 | 65.2 | 70.0 | 47.1 | 0 |
| Variable | semanticText | 25 | 140.0 | 193.0 | 331.0 | 418.0 | 791.0 | 970.0 | 376.4 | 0 |

### E. Variable Parent Resolution Table

| Variable ID | Label | Parent dataset count | Reason |
| --- | --- | --- | --- |
| https://id.skygest.io/variable/var_01KNQEZ5WM6DKQ71AGT8CVF53B | Installed offshore wind capacity | 0 | no-parent-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WMARTRPG4KZMWMZ82Y | Installed nuclear capacity | 0 | no-parent-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WMM5YKEQCPBX960YXC | Installed battery storage capacity | 0 | no-parent-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WMYHSF2J4JJFAY5DWD | Installed wind capacity | 0 | no-parent-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WMZSP4FHM71ZK9YMF9 | Installed renewable capacity | 2 | multiple-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WN50KM85CVJQWYFMTY | Clean electricity share | 2 | multiple-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH | Electricity generation | 4 | multiple-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WN7HAKBFJ3TZ09VA4H | CO2 emissions from energy | 2 | multiple-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WN8PY5KZKS91E7QVTB | Solar electricity generation | 3 | multiple-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WNMWFT32DHZE32VG71 | Wholesale electricity price | 3 | multiple-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WNTF139XKP1XD29BF8 | Offshore wind capital cost | 0 | no-parent-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WNWKAAZZ5NF377NDYX | Installed electrolyzer capacity | 0 | no-parent-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WNXB2JR47T4ZEV0VQG | Electricity demand | 2 | multiple-datasets |
| https://id.skygest.io/variable/var_01KNQEZ5WP0PD1A7H3TA56PTAG | Heat pump installations | 0 | no-parent-datasets |
| https://id.skygest.io/variable/var_01KP172ZREQSTR3BEW29TQJ7HY | Lignite production | 0 | no-parent-datasets |
| https://id.skygest.io/variable/var_01KP172ZRES5RNDND1J224XNS7 | Natural gas consumption | 0 | no-parent-datasets |
