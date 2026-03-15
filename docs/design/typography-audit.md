# Typography Audit Report

**Date:** 2026-03-15
**File:** Scratchpad (Paper)
**Artboards audited:** Search, Home Feed, Topic Detail

## Summary

Audited all text nodes across the three page artboards against the established type scale. Found and corrected 6 categories of drift across 38 text nodes total.

## Issues Found and Fixed

### 1. Expert names missing letter-spacing: -0.01em

All expert name nodes (Inter 600, 13px/16px) were missing the required `-0.01em` letter-spacing.

| Artboard | Nodes | Names |
|---|---|---|
| Search | F7-0, FK-0, FX-0 | Ember Energy, Doug Lewin, Ethan Howl |
| Home Feed | DA-0, DK-0, DU-0 | Startup Ideas, Kevin Lee Caster, Aster Verite |
| Topic Detail | I8-0, IK-0 | Canary Media, Terrawatts |

**Fix:** Added `letterSpacing: -0.01em` to all 8 nodes.

### 2. Search snippet line-height: 24px instead of 23px

Post body text (Newsreader 15px) had `lineHeight: 24px` instead of the spec's `23px`.

| Artboard | Nodes |
|---|---|
| Search | FA-0, FN-0, G0-0 |
| Home Feed | DD-0, DN-0, DX-0 |
| Topic Detail | IB-0, IN-0 |

**Fix:** Changed `lineHeight` from `24px` to `23px` on all 8 nodes.

### 3. Section labels "RECENT" at 11px instead of 10px

The "RECENT" section labels on Home Feed and Topic Detail had drifted to `11px/14px` instead of the spec's `10px/12px`.

| Artboard | Node | Label |
|---|---|---|
| Home Feed | D5-0 | RECENT |
| Topic Detail | I3-0 | RECENT |

**Fix:** Changed `fontSize` to `10px` and `lineHeight` to `12px` on both nodes. (Note: "ONTOLOGY", "TRENDING", "TOPIC", and "CONCEPTS" section labels were already correct.)

### 4. Section labels with letter-spacing 0.08em instead of 0.1em

The "MATCHING TERMS" and "DOMAINS" section labels on Topic Detail had `letterSpacing: 0.08em` instead of the spec's `0.1em`.

| Node | Label |
|---|---|
| HV-0 | MATCHING TERMS |
| HZ-0 | DOMAINS |

**Fix:** Changed `letterSpacing` from `0.08em` to `0.1em` on both nodes.

### 5. Topic tag labels missing letter-spacing: 0.02em

Topic tag labels (Inter 500, 11px/14px, #6B6B63) were missing the required `0.02em` letter-spacing across all artboards.

| Artboard | Nodes | Examples |
|---|---|---|
| Search | FD-0, FQ-0, G3-0, G5-0, EO-0, EQ-0 | Energy Storage, Hydrogen, breadcrumb items |
| Home Feed | DG-0, DQ-0, E0-0, E2-0 | Solar, Wind, Offshore Wind |
| Topic Detail | IY-0, IQ-0, IS-0, IU-0, J3-0, HB-0 | Grid and Infrastructure, Offshore Wind, Wind, Energy Policy, grid-and-infrastructure |

**Fix:** Added `letterSpacing: 0.02em` to all 16 nodes.

Additionally, the "Related:" related topic pills on the Search artboard (EU-0, EW-0, EY-0) were at `10px/13px` with no letter-spacing. Fixed to `11px/14px` with `letterSpacing: 0.02em` and `fontWeight: 500` to match the topic tag label spec.

### 6. Ontology match concept text at 10px instead of 11px

On Topic Detail, the ontology row match concepts ("interconnection", "legislation") were at `10px/12px` instead of the match value spec's `11px/14px`.

| Node | Text |
|---|---|
| J0-0 | interconnection |
| J5-0 | legislation |

**Fix:** Changed `fontSize` to `11px` and `lineHeight` to `14px` on both nodes.

### 7. Topic description line-height drift

The topic description on Topic Detail (HD-0, "Transmission, distribution...") had `lineHeight: 22px` instead of the search snippet spec's `23px`. Color (#6B6B63) was left as-is since the lighter color is an intentional design choice for secondary description text.

**Fix:** Changed `lineHeight` from `22px` to `23px`.

## Elements Confirmed Correct (No Changes Needed)

- **Brand mark** ("skygest"): Instrument Serif 400, 22px/26px, #1A1A1A -- correct on all 3 artboards
- **Brand sub-label** ("ENERGY"): Inter 400, 11px/14px, uppercase, 0.1em spacing, #9A9A90 -- correct
- **Display heading** ("Grid and Infrastructure"): Instrument Serif 400, 28px/34px, #1A1A1A -- correct
- **Handle/domain text**: Inter 400, 12px/16px, #B0B0A6 -- correct on all artboards
- **Time display**: Inter 400, 12px/16px, #C4C4BB -- correct on all artboards
- **Hierarchy separators** ("/"): Inter 400, 10px/12px, #C4C4BB -- correct
- **"via" connectors**: Inter 400, 10px/12px, #C4C4BB -- correct
- **Match value text** (orange terms in tags): Inter 400, 11px/14px, #C45D2C -- correct
- **Section labels** (ONTOLOGY, TRENDING, TOPIC, CONCEPTS): Inter 600, 10px/12px, 0.1em, uppercase, #9A9A90 -- correct
- **Nav items**: Inter 400/500, 13px/18px -- correct

## Notes

- Concept sub-filter pills (Trending topics on Home Feed, Concept filters on Topic Detail) use 12px/14px Inter 400 with color #3D3D38. These don't map directly to a named type scale role but are consistent with each other as an interactive UI element. Left as-is.
- The "All" active pill (HI-0) uses #FFFFFF on a colored background -- intentional active state, left as-is.
- Signal description text (HW-0, I0-0) uses 11px/16px -- the larger line-height vs topic tags appears intentional for multi-line readability in the signals box.
