# Vision

## What it is

A bilingual web platform for browsing, searching, and reading Saudi laws, regulations, and court judgments — with structured rendering that preserves the exact text of official sources.

## The problem it solves

Saudi legal texts live across multiple government portals (BOE, Umm Al-Qura, NCA) with inconsistent formatting, no cross-referencing, and no unified search. Practitioners must manually navigate each source, copy-paste text, and lose structural fidelity (numbered items, amendments, tables). This platform:

- **Aggregates** laws from official sources into one searchable library
- **Structures** raw HTML into a visual AST (markers, levels, tables, amendments) so the hierarchy is readable
- **Cross-references** articles via clickable inline links (e.g. "المادة الخامسة" becomes a navigable reference)
- **Preserves** the original text without fabrication — the raw extraction is the source of truth

Source: `server/storage.ts` (FileStorage reads JSON from `client/public/data/laws/`), `shared/schema.ts` (data contracts)

## Target users

- Legal practitioners, lawyers, and judges who need fast access to Saudi legislation
- Researchers comparing legal provisions across articles or jurisdictions
- Government bodies reviewing regulatory frameworks

Source: UI evidence — `client/src/App.tsx` routes: `/library`, `/law/:id`, `/judgments`, `/regulations`, `/about`

## Core value / differentiators

1. **Structured rendering** — Raw text is parsed into a visual AST with markers, indentation levels, and tables. Not a PDF viewer or flat text dump.
2. **Inline article references** — "المادة الثامنة عشرة" becomes a clickable link that expands the referenced article in-place, with recursive nesting up to 2 levels.
3. **Amendment tracking** — Each article shows its amendment history with `content_parts` that preserve original table/text order.
4. **Multi-source judgments** — Saudi and Egyptian court judgments with FTS5 full-text search, faceted filtering, and highlighted tokens (amounts, dates, article refs).
5. **Official-source fidelity** — Extraction scripts pull directly from BOE (laws.boe.gov.sa) and store the raw result. No hallucinated or summarized text.

Source: `client/src/components/ArticleReferenceText.tsx` (reference detection), `client/src/pages/LawDetail.tsx` (paragraph AST, amendments), `server/db.ts` (FTS5 index)

## Non-negotiable quality rules

| Rule | Rationale |
|------|-----------|
| **No fabricated text** | Every displayed word must trace back to an official source extraction. If text is missing, show nothing — never generate placeholder content. |
| **Preserve raw extraction** | The JSON files in `client/public/data/laws/` are the single source of truth. UI parsing is display-only; it never modifies stored data. |
| **No lossy normalization** | Markers, levels, and table structures must survive the full pipeline (extract → store → parse → render). If a marker is "أ-" in BOE, it must be "أ-" on screen. |
| **RTL integrity** | All layout is `dir="rtl"`. Dates use Unicode RTL marks. Hindi numerals (٠-٩) replace Western digits in display. |
| **Amendment order fidelity** | `content_parts` array preserves the exact interleaving of text and tables from the original amendment HTML. |

Source: `scripts/extract_folder1_laws.py` (`_container_to_text`, `_paras_from_text`), `CLAUDE.md` (development log)
