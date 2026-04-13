# SKY-322 / SKY-323 — Alias and Publisher Coverage Research

Research agent output from 2026-04-13. The agent was blocked from writing this file directly due to sandbox permissions; the text below is its verbatim findings, persisted by the orchestrator.

Branch: `sky-321/data-layer-spine-manifest-contract`. Eval baselines: `eval/resolution-kernel/runs/20260413-104312-977/summary.md` (20/20 fail), `eval/cq-conformance/runs/20260413-104323-201/summary.md` (`agent-variable-shelf` AMBER 7/1430).

## 1. Critical architectural findings (read first)

Two facts changed the shape of the work substantially:

**1. Variable aliases are a structured-identifier path, not a free-text path.** The `AliasScheme` enum in `src/domain/data-layer/alias.ts` is `["oeo", "ires-siec", "iea-shortname", "ipcc", "entsoe-psr", "entsoe-eic", "entsoe-document-type", "eia-route", "eia-series", "eia-bulk-id", "energy-charts-endpoint", "ember-route", "gridstatus-dataset-id", "odre-dataset-id", "eurostat-code", "europa-dataset-id", "ror", "wikidata", "doi", "iso3166", "url", "other"]`. Stage 1's `pushStructuredAliasMatches` (`src/resolution/Stage1.ts:348-396`) tokenises text via `extractStructuredIdentifierCandidates` (uppercase / dash / underscore tokens) and looks the result up in `variableByAlias`. **Free-text phrases like "Stromerzeugung" or "wind generation" are never witnessed via the variable-alias path** — they are witnessed by the per-facet vocabulary in `references/vocabulary/*.json` through `Interpret.matchSite` (`src/resolution/kernel/Interpret.ts:155-217`).

**2. Agent surface forms come from `agent.name` and `agent.alternateNames`, not from `agent.aliases`.** The registry index (`src/resolution/dataLayerRegistry.ts:498-541`) registers `agent.name` and every entry in `agent.alternateNames` into `agentByLabel`, and registers a single normalised hostname from `agent.homepage` into `agentByHomepageDomain`. **`agent.aliases` (wikidata, ror, url, etc.) are not registered into either lookup.** Adding more entries to `agent.aliases` does nothing for `agent-resolution`.

Implication: of the 20 gold rows, **none of the chart text payloads contain a structured token from the AliasScheme namespaces**. SKY-322 in its strict scope (variable-alias backfill in JSON) **cannot move the gold eval today**. The actionable levers for the eval are (a) per-facet vocabulary expansion, (b) `agent.alternateNames` enrichment, and (c) Series additions on already-existing publishers.

## 2. Baseline — alias coverage per variable

All 25 variables in `references/cold-start/variables/*.json` currently have `aliases: []`. Highest-ROI variables (intersection of series-backed and gold-row-referenced):

| variable slug | label | series-backed | gold rows referencing |
|---|---|---|---|
| `electricity-generation` | Electricity generation | ✓ | 8 (001, 005, 014, 016, 019, 022, 024, +1 implied) |
| `wholesale-electricity-price` | Wholesale electricity price | ✓ (us-ca, de, tr) | 3 (002, 006, 009) |
| `co2-emissions-from-energy` | CO2 emissions from energy | ✗ | 4 (010, 012, 013, 020) |
| `wind-electricity-generation` | Wind electricity generation | ✗ | 1 (004) |
| `solar-electricity-generation` | Solar electricity generation | ✓ (us-ca, us-tx via SKY-317) | 1 (007) |
| `installed-renewable-capacity` | Installed renewable capacity | ✓ (IRENA via SKY-317) | 1 (003) |
| `electricity-demand` | Electricity demand | ✓ (us-tx, PJM via SKY-317) | 2 (008, 021) |
| `installed-nuclear-capacity` | Installed nuclear capacity | ✗ | 1 (018) |

Other 17 variables have empty alias arrays but are not referenced by gold rows and are not the current priority.

## 3. Gold-row failure categorisation

Source: `eval/resolution-kernel/runs/20260413-104312-977/summary.md` cross-referenced with the CQ per-row failure detail.

### 3.1 text-witnessed-nothing (Interpret produced NoMatch) — 3 rows
- **005-klstone** electricity-generation; chart says "Öffentliche Nettostromerzeugung", logo "Energy-Charts" — German-vocabulary gap.
- **008-ben-inskeep** electricity-demand; chart is a sewer schematic — gold mis-seed.
- **022-klstone** electricity-generation; same German-vocabulary gap as 005.

### 3.2 partial-facets-missing (Hypothesis with required facet missing or wrong) — 17 rows

| row | gold variable | sharedPartial | gap | aliases help? |
|---|---|---|---|---|
| 001-ember-energy | electricity-generation | dom=electricity, stat=share, mP=share, tof=solar PV | wrong stat (share vs flow) — unitFamily-inference issue | NO |
| 002-1reluctantcog | wholesale-electricity-price | mP=price, dom=electricity | missing statisticType. Chart is LBNL retail prices | NO; gold mis-seed |
| 003-janrosenow | installed-renewable-capacity | stat=share, dom=heat pump, tof=heat pump | wrong gold variable; chart is heat-pump installations | NO; gold mis-seed |
| 004-lightbucket | wind-electricity-generation | dom=electricity, tof=wind | missing mP, stat. Chart: "Wind power records" | NO — need vocabulary or compound for "wind power record" |
| 006-edcporter | wholesale-electricity-price | mP=price, uF=energy, tof=battery | missing stat. Chart: battery spreads. Gold mis-seed | NO |
| 007-aukehoekstra | solar-electricity-generation | dom=electricity | missing mP, stat. Chart: W·kg⁻¹ specific power | NO; gold mis-seed |
| 009-irena | wholesale-electricity-price | mP=price, agg=sum, uF=currency | Chart: solar module manufacturing cost. Gold mis-seed | NO |
| 010-earthsciinfo | co2-emissions-from-energy | mP=emissions, dom=natural gas, tof=natural gas | missing stat; wrong dom | NO; vocabulary needed |
| 012-hausfath | co2-emissions-from-energy | mP=emissions | missing stat. IPCC AR6 figure | NO; needs IPCC Series + statisticType compound |
| 013-weatherprof | co2-emissions-from-energy | mP=price | wrong mP — "Energy Imbalance Rate" tokenised wrong | NO; surface-form precision |
| 014-carbonbrief | electricity-generation | mP=generation, stat=flow, uF=energy | ambiguous (5 candidates: electricity, coal, solar, battery, wind) | NO direct; **SKY-323 NESO/Carbon Brief publisher narrowing unblocks** |
| 016-energy-charts | electricity-generation | uF=energy | missing mP, stat. German chart | NO; vocabulary + Fraunhofer Series |
| 018-simonmahan | installed-nuclear-capacity | dom=nuclear reactor, tof=nuclear | Chart is cooling reservoir acreage. Gold mis-seed | NO |
| 019-nicolasfulghum | electricity-generation | mP=generation, dom=natural gas, tof=solar PV, stat=flow | wrong dom — fold-precedence bug | NO; SKY-313 follow-up |
| 020-lightbucket | co2-emissions-from-energy | uF=energy | wrong unit family. Chart: "gCO2eq/kWh" — unit-family unknown | NO; vocabulary |
| 021-lightbucket | electricity-demand | mP=consumption, dom=natural gas, tof=natural gas, uF=power | wrong mP — gold mis-seed (gas consumption ≠ electricity demand) | NO |
| 024-lightbucket | electricity-generation | mP=generation, dom=electricity, stat=flow | ambiguous (5 candidates) | NO direct; **SKY-323 Fraunhofer Series unblocks** |

### 3.3 Net read

**0 of 20 rows are addressable by variable-alias additions in the strict AliasScheme sense.** SKY-322 as scoped is forward-looking infrastructure only.

## 4. SKY-322 proposal — 24 forward-looking aliases

These add the canonical structured identifiers each variable carries in upstream data systems. All 25 variables have empty alias arrays today, so no `(scheme, value)` collision is possible against the existing `variableByAlias` map (`src/resolution/dataLayerRegistry.ts:502-602`). All proposed entries use `relation: "exactMatch"`.

| # | priority | variable slug | scheme | value | source / evidence |
|---|---|---|---|---|---|
| 1 | P1 | electricity-generation | oeo | https://w3id.org/oeo/ontology/OEO_00000293 (electric energy generation) | OEO concept; **needs human verification of exact suffix against `oeo-full.owl` at repo root** |
| 2 | P1 | electricity-generation | eia-bulk-id | ELEC.GEN.ALL-US.A | EIA Open Data API v2 |
| 3 | P1 | electricity-generation | ember-route | electricity-generation/yearly | matches existing alias on `references/cold-start/catalog/datasets/ember-electricity-generation-yearly.json` (separate map, no collision) |
| 4 | P1 | electricity-generation | eurostat-code | nrg_bal_c | Eurostat "Complete energy balances" |
| 5 | P2 | wholesale-electricity-price | oeo | https://w3id.org/oeo/ontology/OEO_00040037 (wholesale market price) | OEO; **needs IRI verification** |
| 6 | P2 | wholesale-electricity-price | eia-bulk-id | ELEC.PRICE.US-ALL.A | EIA |
| 7 | P2 | wholesale-electricity-price | entsoe-document-type | A44 | ENTSO-E Transparency Platform "Day-ahead prices" doc type |
| 8 | P2 | co2-emissions-from-energy | oeo | https://w3id.org/oeo/ontology/OEO_00010007 (carbon dioxide emission) | OEO; **needs IRI verification** |
| 9 | P2 | co2-emissions-from-energy | ipcc | AR6 WG3 Annex III | citation under the ipcc scheme |
| 10 | P2 | co2-emissions-from-energy | eurostat-code | env_air_gge | Eurostat "GHG by source sector" |
| 11 | P3 | wind-electricity-generation | oeo | https://w3id.org/oeo/ontology/OEO_00010240 (wind energy generation) | OEO; **verify** |
| 12 | P3 | wind-electricity-generation | entsoe-psr | B19 | ENTSO-E Production Type "Wind Onshore" |
| 13 | P3 | wind-electricity-generation | entsoe-psr | B18 | ENTSO-E Production Type "Wind Offshore" |
| 14 | P3 | solar-electricity-generation | oeo | https://w3id.org/oeo/ontology/OEO_00010239 (solar energy generation) | OEO; **verify** |
| 15 | P3 | solar-electricity-generation | entsoe-psr | B16 | ENTSO-E Production Type "Solar" |
| 16 | P3 | solar-electricity-generation | eia-bulk-id | ELEC.GEN.SUN-US.A | EIA |
| 17 | P3 | installed-renewable-capacity | oeo | https://w3id.org/oeo/ontology/OEO_00010238 | OEO; **verify** |
| 18 | P3 | installed-renewable-capacity | eia-bulk-id | ELEC.GEN.AOR-US.A | EIA all-renewables |
| 19 | P3 | installed-renewable-capacity | iea-shortname | RECAP | IEA Renewables Capacity Statistics |
| 20 | P3 | electricity-demand | oeo | https://w3id.org/oeo/ontology/OEO_00040038 | OEO; **verify** |
| 21 | P3 | electricity-demand | eia-bulk-id | EBA.US48-ALL.D.H | EIA hourly US-48 demand |
| 22 | P3 | electricity-demand | entsoe-document-type | A65 | ENTSO-E "System total load" |
| 23 | P4 | installed-nuclear-capacity | oeo | https://w3id.org/oeo/ontology/OEO_00010247 | OEO; **verify** |
| 24 | P4 | installed-nuclear-capacity | entsoe-psr | B14 | ENTSO-E "Nuclear" |

**Cap**: 24 ≤ 30. All OEO IRIs must be verified against `oeo-full.owl` (root-level untracked) before commit. The scheme split between `eia-series` (legacy v1) and `eia-bulk-id` (v2 routes) should be sanity-checked against existing `eia-*` dataset files.

**Expected gold-row movement: 0 / 20.** None of the gold-row chart payloads carry any of these tokens.

### 4.1 Out-of-scope-for-SKY-322 vocabulary additions that DO move the eval

The actionable lever is `references/vocabulary/*.json`, not variable aliases. Highest-leverage additions (track in a sibling ticket; the SKY-322 PR should call out this trade-off):

- **measured-property.json**: `stromerzeugung → generation` (German), `nettostromerzeugung → generation`, `electricity production → generation`, `gas-fired generation → generation`.
- **domain-object.json**: `strom → electricity`, `electricity mix → electricity`, `power mix → electricity`.
- **unit-family.json**: `gCO2eq/kWh → carbon_intensity` (or `mass_co2_per_energy`); requires adding a new canonical to `unit-family` literal set. Without this, row 020 cannot succeed.
- **compound-concepts.json**: `retail electricity price → {measuredProperty: "price", domainObject: "electricity", statisticType: "price"}` (row 002), `carbon intensity of electricity → {measuredProperty: "emissions", statisticType: "intensity", domainObject: "electricity"}` (row 020), `wind power record → {measuredProperty: "generation", aggregation: "max"}` (row 004).

## 5. Gold-row publishers and Stage-1 resolution status

Pulled from `eval/resolution-stage1/snapshot.jsonl` (`sourceAttribution`, `vision.assets[].analysis.{logoText,organizationMentions,sourceLines}`).

| row | gold expects | provider.label | content domain | logoText | orgMentions | sourceLines | Stage 1 pins agent? |
|---|---|---|---|---|---|---|---|
| 001-ember | Ember | — | ember-energy.org | EMBER | EPİAŞ, TEİAŞ, EMBER | "Source: EPİAŞ, TEİAŞ" | ✓ Ember |
| 002-1reluctantcog | EIA | EIA | — | — | LBNL, Brattle, EIA, Datawrapper | "Source: EIA" | ✓ EIA |
| 003-janrosenow | — | — | — | — | "BDH (Federal Association of the German Heating Industry)", BWP, TGA-Praxis | "BDH …" | ✗ |
| 004-lightbucket | — | — | — | GB Renewables Map | National Energy System Operator (NESO) | NESO | ✗ |
| 005-klstone | — | — | — | Energy-Charts | Energy-Charts | "Energy-Charts.info - letztes Update…" | ✗ |
| 006-edcporter | ENTSO-E | ENTSO-E | — | MODO ENERGY | Modo Energy, ENTSO-E, N2EX | "Source: ENTSO-E, N2EX, Modo Energy" | ✓ ENTSO-E |
| 007-aukehoekstra | — | — | — | — | — | — | ✗ (no attribution) |
| 008-ben-inskeep | — | — | — | — | AEP | "Refer to 327 IAC 3-6-11…" | ✗ |
| 009-irena | IRENA | — | www.irena.org | IRENA, International Renewable Energy Agency | IRENA, International Renewable Energy Agency | (notes only) | ✓ IRENA |
| 010-earthsciinfo | — | — | — | — | — | — | ✗ |
| 012-hausfath | — | — | — | — | — | — | ✗ |
| 013-weatherprof | — | — | — | WMO | WMO | — | ✗ (WMO not in registry) |
| 014-carbonbrief | — | — | buff.ly | CarbonBrief | NESO, Carbon Brief | "Source: NESO, Carbon Brief analysis" | ✗ |
| 016-energy-charts | — | — | — | Energy-Charts, Fraunhofer ISE | Energy-Charts, Fraunhofer ISE | "Energy-Charts.info - letztes Update…" | partial — Fraunhofer ISE may match via alternateName but Energy-Charts label fails |
| 018-simonmahan | — | — | — | — | — | — | ✗ |
| 019-nicolasfulghum | Ember | — | — | EMBER | NESO, EMBER | "Source: NESO" | partial — Ember ✓, NESO ✗ |
| 020-lightbucket | — | — | — | — | — | — | ✗ |
| 021-lightbucket | — | — | — | Our World in Data | Our World in Data, Energy Institute | "Energy Institute - Statistical Review of World Energy (2025)" | likely ✓ for both — investigate trace |
| 022-klstone | — | — | — | Energy-Charts | Energy-Charts, Energy-Charts.info | "Energy-Charts.info" | ✗ |
| 024-lightbucket | — | — | — | — | — | — | ✗ |

## 6. Missing publisher inventory

**Every "missing publisher" in the reviewer's list already has an Agent record.** The actual gap is Series records (and in some cases Dataset records and `alternateNames`).

| publisher | Agent | alternateNames covers chart-text surface? | Dataset(s) | Series? |
|---|---|---|---|---|
| Carbon Brief (`ag_01KNR1N2T77SZEH0K9ZFWKNSR1`) | ✓ | ✗ — `alternateNames: []`, chart text says `CarbonBrief` (no space) | ✓ `carbon-brief-data-explorer` (`ds_01KNR1N2TG2BD68J5MXNVGTFHE`) | ✗ |
| NESO (`ag_01KP172ZRBS4Z4NGY24XA7YX6D`) | ✓ | ✗ — name is `"National Energy System Operator (NESO)"`, alternateNames empty | ✗ | ✗ |
| Energy Institute (`ag_01KNR1N2T8A3TGX28327SR4GPS`) | ✓ | ✓ — chart text uses `Energy Institute` (matches `name`) | ✗ | ✗ |
| OWID (`ag_01KNQS8K72YVH1PX36P720SHYT`) | ✓ | ✓ — alternateNames=["OWID"] | ✓ `owid-energy-data` (`ds_01KNQTFC41FK1N5SSJDEZYSCA0`) | ✗ |
| Fraunhofer ISE (`ag_01KNWVQMFHEZD7KVN03TEAVA1Q`) | ✓ | ✗ — alternateNames=["Fraunhofer ISE"]. Chart text: `Energy-Charts`, `Energy Charts`, `Energy-Charts.info` | ✓ 17 energy-charts datasets (e.g. `ds_01KNWVQMFJY7ACRKH6WTJM07HD`) | ✗ |
| Climate TRACE (`ag_01KNQS8K72JR8T5H7T3ZAWREX8`) | ✓ | partial — no alternateNames | ✓ `climate-trace-inventory` (`ds_01KNQTFC42S8R3P0M38NWJJVGA`) | ✗ |
| IPCC (`ag_01KNQXP4PGX7832CEREKYHC9Z0`) | ✓ | ✓ alternateNames=["IPCC"] | ✓ `ipcc-ar6` (`ds_01KNQXP4PM3HQBQ8F6MD4BMMJ7`) | ✗ |
| BDH (`ag_01KP172ZREZAZPB9EQH2Z7TYN5`) | ✓ | ✗ — name `"BDH — Bundesverband der Deutschen Heizungsindustrie"`, alternateNames empty | ✗ | ✗ |
| LBNL (`ag_01KNQEZ5VGGB17ME67T092E96S`) | ✓ | ✓ alternateNames=["LBNL", "Berkeley Lab"] | ✓ `lbnl-queue` (`ds_01KNQEZ5VSKXDY6EA8XC38PWHJ`) — but it's about interconnection queues, not retail prices | ✗ |

## 7. SKY-323 proposal — 7 publisher additions

### 7.1 P1 — Fraunhofer ISE / Energy-Charts (gold rows: 005, 016, 022, 024)
- **alternateNames**: add `"Energy-Charts"`, `"Energy Charts"`, `"Energy Charts (Fraunhofer ISE)"` to the Fraunhofer ISE agent.
- **datasets**: already exist; reuse `ds_01KNWVQMFJY7ACRKH6WTJM07HD` (energy-charts public_power) and `energy-charts-installed-power.json` for capacity.
- **series additions** (2):
  1. `de-public-electricity-generation-daily.json` — variableId=electricity-generation (`var_01KNQEZ5WN5TNH2HCGMHA2T3YH`), datasetId=`ds_01KNWVQMFJY7ACRKH6WTJM07HD`, fixedDims `{place: "DE", frequency: "daily"}`. Source: https://api.energy-charts.info/public_power?country=de
  2. `eu-public-electricity-generation-quarterly.json` — same variable + dataset, fixedDims `{place: "EU", frequency: "quarterly"}` (matches row 016 chart).
- **prerequisite vocabulary additions** (out of scope but called out): `stromerzeugung → generation`, `nettostromerzeugung → generation`. Without these, even with the Series in place, Interpret cannot pin `measuredProperty=generation` on rows 005/016/022.
- **homepage-domain caveat**: agent.homepage is `https://www.ise.fraunhofer.de/`; chart text uses `energy-charts.info`. There is no clean way to register a second hostname for an agent under the current registry build (`agentByHomepageDomain` only reads `agent.homepage`). Either accept that label-only matching covers this, or open a follow-up ticket to harvest hostnames from `agent.aliases[].url` entries during registry build. **Flag for human review**.

### 7.2 P2 — NESO + Carbon Brief joint (gold rows: 004, 014, 019)
- **agents**:
  - NESO: add `"NESO"`, `"National Energy System Operator"` to alternateNames. Confirm whether `findAgentByLabel` exact-matches `"National Energy System Operator (NESO)"` or whether normalisation strips parens (`normalizeLookupText` lowercases + collapses whitespace, parens stay).
  - Carbon Brief: add `"CarbonBrief"`, `"Carbon Brief analysis"` to alternateNames.
- **dataset (new)**: `neso-historic-generation-mix.json`
  - title: "NESO Historic GB Electricity Generation Mix"
  - publisherAgentId: `ag_01KP172ZRBS4Z4NGY24XA7YX6D`
  - landingPage: `https://www.neso.energy/data-portal/historic-generation-mix`
  - license: NESO Open Data Licence — **needs human review for exact URL**
  - keywords: `["generation", "GB", "electricity", "fuel mix", "wind"]`, themes: `["electricity"]`
- **series additions** (2):
  1. `gb-electricity-generation-mix.json` — variableId=electricity-generation, datasetId=new NESO, `{place: "GB", frequency: "halfhourly"}`
  2. `gb-monthly-generation-summary.json` — variableId=electricity-generation, datasetId=new NESO, `{place: "GB", frequency: "monthly"}` (row 014)

### 7.3 P3 — Ember Series for global-electricity-generation (gold rows: 001, 014, 019)
- **agent**: Ember exists with adequate alternateNames=["Ember Climate"]. No change.
- **dataset**: `ember-electricity-generation-yearly.json` (`ds_01KNX53R149V3QYRSNC9SVJ8NF`) and `ember-turkiye.json` (`ds_01KNQEZ5VN7VR6AYRJ5NCDMHTR`) already exist.
- **series additions** (2):
  1. **Reopen** `global-electricity-generation-annual` from the SKY-317 `deliberatelyOmitted` list (`references/cold-start/series/.series-dataset-backfill.json:51-54`). Pin `datasetId = ds_01KNX53R149V3QYRSNC9SVJ8NF` (Ember Electricity Generation Yearly). The 4/7 split among Ember/IEA/EIA/BNEF is a candidate-quality issue, not a data-truth issue; Ember publishes the canonical multi-country yearly generation table.
  2. New `tr-electricity-generation-by-fuel-annual.json` — variableId=electricity-generation, datasetId=`ds_01KNQEZ5VN7VR6AYRJ5NCDMHTR` (ember-turkiye), `{place: "TR", frequency: "annual"}`. Pairs with row 001's chart precisely.

### 7.4 P4 — IPCC AR6 (gold row 012)
- **agent**: IPCC exists; alternateNames covers IPCC. No change.
- **dataset**: `ipcc-ar6.json` (`ds_01KNQXP4PM3HQBQ8F6MD4BMMJ7`) exists.
- **series addition** (1): `global-energy-co2-emissions-ar6-annual.json` — variableId=co2-emissions-from-energy (`var_01KNQEZ5WN7HAKBFJ3TZ09VA4H`), datasetId=`ds_01KNQXP4PM3HQBQ8F6MD4BMMJ7`, `{place: "GLOBAL", frequency: "annual"}`. Series label: "Global energy-sector CO2 emissions, IPCC AR6 WG3 Annex III".
- **caveat**: row 012 still needs Interpret to pin `statisticType` (currently missing); the Series gives Bind a shelf to narrow on once Interpret produces a complete partial.

### 7.5 P5 — Energy Institute / OWID Statistical Review (gold row 021, soft-scoring blocker)
- **agent**: Energy Institute already exists; chart text matches `name` directly. OWID alternateNames=["OWID"] already covers it.
- **dataset (new)**: `energy-institute-statistical-review.json`
  - title: "Energy Institute Statistical Review of World Energy"
  - publisherAgentId: `ag_01KNR1N2T8A3TGX28327SR4GPS`
  - landingPage: `https://www.energyinst.org/statistical-review`
  - license: **needs human review for exact string**
- **series addition** (1): `global-natural-gas-consumption-annual.json` — variableId=`natural-gas-consumption` (NOT electricity-demand; **flag the gold-seed mismatch** — the row 021 gold expects electricity-demand but the chart is gas consumption), datasetId=new EI, `{place: "GLOBAL", frequency: "annual"}`.

### 7.6 P6 — BDH heat-pump installations (gold row 003, mis-seeded)
- **agent**: BDH exists. **Add `alternateNames`**: `"BDH"`, `"Federal Association of the German Heating Industry"`, `"Bundesverband der Deutschen Heizungsindustrie"`.
- **dataset (new)**: `bdh-heating-market-statistics.json`
  - publisherAgentId: `ag_01KP172ZREZAZPB9EQH2Z7TYN5`
  - landingPage: `https://www.bdh-industrie.de/presse/marktentwicklung-deutschland/`
  - license: **needs human review** (BDH does not publish under a clean open license)
- **series addition** (1): `de-heat-pump-installations-annual.json` — variableId=`heat-pump-installations`, datasetId=new BDH, `{place: "DE", frequency: "annual"}`.
- **caveat**: row 003 gold seed says `installed-renewable-capacity` but the chart is heat-pump installations. The Series is correctly authored; the gold row needs re-seeding (separate work).

### 7.7 P7 — LBNL retail electricity rates (gold row 002, mis-seeded + needs new variable)
- **agent**: LBNL exists with adequate alternateNames. No change.
- **dataset (new)**: `lbnl-retail-electricity-prices.json`
  - publisherAgentId: `ag_01KNQEZ5VGGB17ME67T092E96S`
  - landingPage: `https://emp.lbl.gov/projects/retail-electricity-prices`
  - license: `https://creativecommons.org/licenses/by/4.0/`
- **prerequisite variable addition**: there is no `retail-electricity-price` variable in the 25 cold-start variables. Either grow the variable inventory or accept that this entry can't fully bind row 002.
- **flag for human review** — this priority is the weakest because it requires a variable-inventory decision.

### 7.8 Cap totals
7 publishers, ≤ cap. Climate TRACE deferred to second-pass (none of the 20 gold rows reference it).

## 8. Ordering and expected eval movement

### 8.1 First — pure alias work (SKY-322) where publisher is already pinned

Of the 4 rows where Stage 1 already pins an agent (001 Ember, 002 EIA, 006 ENTSO-E, 009 IRENA), **none are addressable by alias additions**:
- 001: wrong `statisticType` (share vs flow) — unit-family-inference (CQ-008 worker FAIL)
- 002: gold mis-seed (LBNL retail vs wholesale)
- 006: gold mis-seed (battery spreads vs wholesale electricity price)
- 009: gold mis-seed (solar module manufacturing cost vs wholesale electricity price)

**Expected gold-row movement from SKY-322 alias-only: 0/20.**

### 8.2 Second — SKY-323 publisher additions + alternateNames + Series (with prerequisite vocabulary)

Best-case after SKY-323 + the vocabulary additions called out in §4.1:

| row | gold variable | unblocked by | confidence |
|---|---|---|---|
| 004-lightbucket | wind-electricity-generation | NESO alternateNames + Series + `wind power record` compound | medium |
| 014-carbonbrief | electricity-generation | NESO + Carbon Brief alternateNames + NESO/Ember Series — narrows the 5-way ambiguity to one | medium-high |
| 016-energy-charts | electricity-generation | Fraunhofer alternateNames + EU Series + German vocabulary | medium |
| 005, 022 — klstone | electricity-generation | Same as 016 | low-medium (vocabulary is dominant blocker) |
| 024-lightbucket | electricity-generation | Fraunhofer alternateNames + Series — narrows 5-way ambiguity | medium |
| 012-hausfath | co2-emissions-from-energy | IPCC AR6 Series + statisticType compound | low |

**Best-case eval movement from SKY-323 + vocabulary work: 5–6/20.**
**SKY-323 standalone (no vocabulary): 1–2/20** — only rows 014 and 024 can succeed today, because their Hypothesis is already correct and the only blocker is candidate ambiguity that publisher narrowing breaks.

### 8.3 Third — rows that still won't resolve

- **001**: needs unit-family→stat inference (CQ-008 FAIL / SKY-328).
- **002, 006, 009**: gold seeds reference variables the chart isn't actually about; re-seed.
- **003**: gold-seed mismatch — should map to `heat-pump-installations`.
- **007**: chart is mass-specific power; re-seed.
- **008, 010, 018, 020**: bundles have no source attribution; pure vocabulary problem (esp. 020's `gCO2eq/kWh` unit family).
- **013**: surface-form precision — `Energy Imbalance Rate → price` is wrong.
- **019**: shared-partial fold-precedence bug — SKY-313 follow-up.
- **021**: `consumption vs demand` mismatch; possibly gold mis-seed.

## 9. Known limitations and out-of-scope

- **Wrong-facet pins (rows 001, 010, 013, 019, 020, 021)**: soft-scoring / fold-precedence work (SKY-326 / SKY-313), not alias work.
- **Missing variables (row 002 retail-electricity-price)**: variable inventory growth, not alias work.
- **Vocabulary expansion (rows 004, 005, 012, 014, 016, 020, 022, 024 partial)**: belongs in `references/vocabulary/*.json`, not `references/cold-start/variables/*.json`. SKY-322's stated "Out of Scope: Broad lexicon redesign" excludes this lever, but it is the lever that actually moves the eval. Recommend a sibling ticket.
- **`agentByHomepageDomain` is single-hostname**: Fraunhofer ISE cannot have both `ise.fraunhofer.de` and `energy-charts.info` registered without a registry-build extension (harvest hostnames from `agent.aliases[].url`). Defer; flag as architectural follow-up.
- **OEO IRI verification**: every OEO entry in §4 must be cross-checked against `oeo-full.owl` before commit.
- **Gold-row mis-seeds**: rows 002, 003, 006, 007, 008, 009, 018, 021 either reference the wrong variable or are about something the variable inventory can't model. SKY-322/323 cannot fix these; they need a gold-set audit.

## 10. Verification status

- `bun run typecheck` — green on the current branch.
- `bun run test` — 134 files / 1292 tests passing on the current branch.
- No source / fixture / test files were modified in the course of this research.
