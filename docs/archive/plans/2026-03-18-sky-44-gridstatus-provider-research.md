# SKY-44 — GridStatus.io Platform Research

Research on GridStatus.io as an archetypical **platform/content-source** in the Skygest attribution model, not as a provider registry entry.

---

## 1. What Is GridStatus.io?

GridStatus (Grid Status, Inc.) is a data platform that provides unified access to electricity grid data across major North American ISOs and RTOs. It offers both an open-source Python library and a commercial hosted API.

The important modeling point is:

- **GridStatus is a serving platform and application layer**
- **ERCOT, CAISO, PJM, EIA, ISO New England, and similar entities are the underlying data originators**

That means GridStatus is highly relevant to attribution, but not in the same role as the provider registry.

### Covered ISOs/RTOs

| ISO/RTO | Region | Live Dashboard |
|---------|--------|----------------|
| ERCOT | Texas | gridstatus.io/live/ercot |
| CAISO | California | gridstatus.io/live/caiso |
| PJM | Mid-Atlantic / Midwest | gridstatus.io/live/pjm |
| MISO | Midcontinent | gridstatus.io/live/miso |
| NYISO | New York | gridstatus.io/live/nyiso |
| ISO-NE | New England | gridstatus.io/live/isone |
| SPP | Southwest / Central | gridstatus.io/live/spp |
| IESO | Ontario, Canada | gridstatus.io/live/ieso |
| AESO | Alberta, Canada | gridstatus.io/live/aeso |
| EIA | US-wide (aggregate) | — |

### Data Categories

GridStatus provides minimally processed access to categories such as:

- Load
- Load forecast
- Fuel mix
- LMP data
- Grid status
- Storage
- Interconnection queue

### Web Application URL Patterns

| Pattern | Description |
|---------|-------------|
| `gridstatus.io/live` | National overview dashboard |
| `gridstatus.io/live/{iso}` | ISO-specific live dashboard |
| `gridstatus.io/map` | Nodal LMP price map |
| `gridstatus.io/graph` | Graph Builder |
| `gridstatus.io/datasets` | Data catalog |
| `gridstatus.io/dashboards` | Custom dashboards |

### Bluesky Presence

GridStatus has an official Bluesky account: `@gridstatus.io`. This matters for Skygest because posts from that account are strong **social provenance**, even when they do not identify the underlying provider cleanly.

---

## 2. How Skygest Should Model GridStatus

### Canonical role in the domain model

GridStatus fits into the current domain model like this:

| Concept | Should GridStatus occupy this role? | Why |
|---------|-------------------------------------|-----|
| `provider` | No | Provider means the organization that originated the underlying data |
| `contentSource` | Yes | A post may explicitly share a GridStatus dashboard or chart page |
| `socialProvenance` | Yes | A post may come directly from `@gridstatus.io` |
| Grounding backend | Yes, later | Future grounding may query GridStatus APIs while still attributing provider to ERCOT, CAISO, etc. |

### Why GridStatus is not a provider

Under the SKY-43 model, `provider` answers:

> Who produced the underlying data being cited?

For a GridStatus ERCOT dashboard, the answer is still ERCOT. GridStatus is the delivery surface, not the originator.

### What to do if the post only shows GridStatus

If a post links to or screenshots GridStatus but does not expose an upstream provider clearly:

- `contentSource` can still be GridStatus
- `socialProvenance` can still be the posting account
- `provider` should stay `null`

That is better than forcing GridStatus into the provider field and muddying the ontology.

---

## 3. How Would Skygest Detect a GridStatus Reference?

Detection should identify GridStatus as a **platform/content source signal**, not as a provider signal.

### Tier 1: Domain matching

Match URLs in post text, link facets, or embed URLs against known GridStatus domains:

```
gridstatus.io
www.gridstatus.io
app.gridstatus.io
api.gridstatus.io
opensource.gridstatus.io
docs.gridstatus.io
```

These domains help populate `contentSource` or future platform metadata. They do **not** create a provider match by themselves.

### Tier 2: Chart footer / source-line references

Vision may extract lines like:

```
"Source: Grid Status"
"Source: gridstatus.io"
"Data: Grid Status"
"via Grid Status"
```

These indicate the chart was served or assembled through GridStatus. They are useful platform hints, but still do not establish the underlying originator unless the chart also cites ERCOT, EIA, CAISO, or another provider.

### Tier 3: Post-text mention

Mentions such as:

```
"Grid Status"
"GridStatus"
"gridstatus.io"
```

should be treated as platform mentions. They may help explain where the chart came from, but they are not originator matches.

### Tier 4: Social provenance

If the poster handle resolves to `gridstatus.io`, that is strong evidence of who posted the content. It remains `socialProvenance`, not `provider`.

### Tier 5: Visual style heuristics

Recognizing a “GridStatus look” from styling alone is too soft for deterministic attribution and should stay out of the provider-matching contract.

---

## 4. Matching Outcomes In Practice

### GridStatus link + explicit provider mention

Post links to `gridstatus.io/live/ercot` and says `"ERCOT demand is near peak"`.

- `contentSource` = GridStatus URL
- `provider` = ERCOT
- `socialProvenance` = posting account

### GridStatus chart + explicit source line

Chart footer says `"Source: ERCOT"` and also contains `gridstatus.io`.

- `contentSource` = GridStatus page if shared
- `provider` = ERCOT
- GridStatus remains the platform, not the provider

### GridStatus chart with no upstream source

Chart shows only `gridstatus.io` watermark and no clear upstream provider.

- `contentSource` = GridStatus page or null if no URL is shared
- `provider` = null
- `socialProvenance` = posting account if known

### Direct post from `@gridstatus.io`

If GridStatus posts a chart directly on Bluesky:

- `socialProvenance` = GridStatus account
- `provider` depends on whether the post or chart also identifies the originator
- if no originator is exposed, `provider = null`

---

## 5. Registry Implications

### What belongs in the provider registry

The provider registry should contain the canonical data originators that GridStatus aggregates, such as:

- ERCOT
- CAISO
- PJM
- MISO
- NYISO
- ISO New England
- SPP
- IESO
- AESO
- EIA

### What does not belong in the provider registry

These should stay out of `ProviderRegistryEntry` under the current design:

- GridStatus
- Utility Dive
- Reuters
- Electricity Maps
- Yes Energy

### If first-class platform modeling is needed later

If the product later needs a formal platform layer, add a separate construct such as:

- `PlatformRegistryEntry`
- domain classification table
- richer `contentSource` taxonomy

Do **not** overload the provider registry to carry both originators and platforms.

---

## 6. What Does Grounding Look Like? (Future)

GridStatus is still very useful for grounding, even though it is not a provider.

### Example: "ERCOT load hit 85 GW"

A post claims ERCOT load peaked at 85 GW on a specific date. That claim could be checked against a GridStatus dataset such as `ercot_load`.

That produces the following semantic split:

- **Provider:** ERCOT
- **Grounding backend:** GridStatus API
- **Content source:** possibly a GridStatus dashboard or dataset page

This is a good example of why provider and grounding backend should not be conflated.

### Grounding assessment

GridStatus looks strong for:

- load claims
- fuel-mix claims
- status or emergency claims
- price claims when location context is available

GridStatus is harder for:

- historical record claims
- forecast-accuracy claims
- location-specific claims without location metadata
- claims mixed with heavy editorial interpretation

---

## 7. Registry And Seed Recommendations

### Recommendation for SKY-44

Do **not** add GridStatus as a `ProviderRegistryEntry`.

Instead:

1. Keep the provider registry focused on originators.
2. Make sure GridStatus domains are recognized by content-source or publication lookup.
3. Use GridStatus as the archetype for future platform/content-source modeling.

### Recommended provider seeds

The provider registry should continue to prioritize originators such as:

- `eia`
- `ercot`
- `caiso`
- `iso-new-england`
- `bc-hydro`

These are all consistent with the current originator-only registry semantics.

### Recommended platform examples

Useful platform/content-source examples for future work:

- GridStatus
- Electricity Maps
- Yes Energy

These are useful research subjects, but they should not be mixed into the provider registry today.

---

## 8. Entity Classes To Keep Separate

| Class | Examples | Current Skygest slot |
|-------|----------|----------------------|
| Data originators | ERCOT, EIA, BC Hydro, ISO New England, ENTSO-E | `provider` / provider registry |
| Platforms / aggregators | GridStatus, Electricity Maps, Yes Energy | `contentSource` today, possible future platform registry |
| Publications | Utility Dive, Reuters | `contentSource` / publication lookup |
| Social accounts | `@gridstatus.io`, expert analyst accounts | `socialProvenance` |

This separation is the main modeling lesson from the GridStatus research.

---

## 9. Canonical ID Notes

Where this document references provider IDs, they should align with the current checked-in registry, for example:

- `iso-new-england` rather than `isone`
- `entso-e` rather than `entsoe`

This document should not be treated as the source of truth for provider IDs. The checked-in registry remains canonical.

---

## Sources

- [GridStatus open-source library (GitHub)](https://github.com/gridstatus/gridstatus)
- [GridStatus Python API client (GitHub)](https://github.com/gridstatus/gridstatusio)
- [GridStatus PyPI package](https://pypi.org/project/gridstatus/)
- [GridStatus API documentation](https://docs.gridstatus.io/developers)
- [GridStatus API usage reference](https://docs.gridstatus.io/developers/api-reference/api-usage)
- [GridStatus data catalog](https://www.gridstatus.io/datasets)
- [GridStatus live dashboards](https://www.gridstatus.io/live)
- [GridStatus Graph Builder](https://www.gridstatus.io/graph)
- [GridStatus LMP data guides](https://docs.gridstatus.io/data-guides)
- [GridStatus data exporter](https://docs.gridstatus.io/data/data-exporter)
- [GridStatus pricing](https://www.gridstatus.io/pricing)
- [GridStatus on Bluesky](https://bsky.app/profile/gridstatus.io)
- [GridStatusClient DeepWiki](https://deepwiki.com/gridstatus/gridstatusio/2.1-gridstatusclient)
- [EIA Open Data API](https://www.eia.gov/opendata/)
- [EIA API documentation](https://www.eia.gov/opendata/documentation.php)
- [ENTSO-E Transparency Platform](https://www.entsoe.eu/data/)
- [Electricity Maps data sources](https://github.com/electricitymaps/electricitymaps-contrib/blob/master/DATA_SOURCES.md)
