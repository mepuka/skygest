# Design Sprint 1 — Final Tasking

## Current State (7 artboards)
1. Search — Ontology Informed (needs update: ontology row treatment)
2. Home — Feed View (latest: text breadcrumbs, hashtags, link previews)
3. Topic Detail — Grid & Infrastructure (needs update: ontology row, link previews)
4. Design Tokens (solid — dark reference card)
5. Components & Patterns (needs update: new ontology style, hashtags, link preview)
6. Feed — Media Rich (exploration — topic-colored media cards)
7. Post Card — Component Study (4 variations — inform final decision)

## Decisions Made
- Avatar INSIDE the post boundary, inline with name
- Ontology breadcrumb BELOW body text, left-aligned (not right-aligned)
- Text `/` separators for ontology hierarchy, not heavy pills
- Pills kept for interactive contexts (topic filters, active states) but more subtle
- Hashtags shown as muted text below body, before link preview
- Link preview as recessed card (domain in accent, title in bold)
- Topic colors for accents (borders, overlays) — not full theming
- Publication tier dots: 4px #C45D2C (energy-focused), #6B6B63 (general-outlet)
- Expert tier dots: same visual language as publication tiers

## Undocumented Styles (need formal spec)
1. Hashtag display: Inter 11px/400 #B0B0A6, plain text
2. Link preview card: #FAFAF8 bg, 1px #EEEEE9 border, 3px radius, 8px 10px padding
3. Link domain: Inter 11px/500 #C45D2C
4. Link title: Inter 12px/500 #1A1A1A
5. Post card anatomy (final): attribution → body → hashtags → link preview → ontology breadcrumb
6. Subtle pill style (for topic filters): needs definition — more refined than current

## Agent Tasks

### Agent A: Component Spec Finalizer
Update docs/design/components/ontology-row.md and create docs/design/components/post-card.md:
- Formalize the final post card anatomy
- Document hashtag styling
- Document link preview card
- Update OntologyRow to reflect text breadcrumb as default, pills for interactive contexts
- Include the subtle pill redesign direction

### Agent B: Artboard Updater — Search + Topic Detail
Update the Search and Topic Detail artboards to match the Home Feed's treatment:
- Ontology breadcrumbs below body, left-aligned
- Avatar inline with name (no protruding circles)
- Add link preview cards where posts have links
- Add hashtag display where applicable
- Consistent typography per the audited type scale

### Agent C: Components & Patterns Board Update
Rebuild the Components & Patterns board to reflect final decisions:
- Replace old pill-based OntologyRow examples with text breadcrumb style
- Add hashtag styling spec
- Add link preview card spec
- Add final post card anatomy diagram
- Keep topic colors and material effects sections
- Update to show both interactive pills (filters) and text breadcrumbs (annotations)
