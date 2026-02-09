# Roadmap

## What exists now

| Feature | Status | Evidence |
|---------|--------|----------|
| **Law library browsing** | Working | `Library.tsx` renders `library.json` as card grid |
| **30 BOE laws extracted** | Working | `client/public/data/laws/*_boe.json` (30 files) |
| **2 manual laws** | Working | `civil_transactions_sa.json`, `sharia_procedures.json` |
| **Structured article display** | Working | Paragraph AST parser in `LawDetail.tsx` with markers, levels, tables |
| **Article cross-references** | Working | `ArticleReferenceText.tsx` with 50+ trigger word variants, expandable panels |
| **Royal decree / cabinet decision** | Working | Dynamic instrument detection from `issuing_authority` |
| **Amendment display** | Working | `content_parts` preserving text/table order |
| **Regulation display** | Working | Collapsible per-article regulation panels |
| **Comparative articles** | Working | `cross_similar` data with expandable panels |
| **Court judgments (search + view)** | Working | FTS5 full-text search, faceted filters, token highlighting |
| **Admin article overrides** | Working | SQLite-backed text overrides with PATCH API |
| **Error reporting** | Working | Submit + manage error reports |
| **RTL + Hindi numerals** | Working | Global `dir="rtl"`, `toHindiNumerals()` conversion |

Source: `client/src/App.tsx` (routes), `server/routes.ts` (API endpoints), `client/public/data/` (data files)

## What's missing

| Gap | Evidence | Impact |
|-----|----------|--------|
| **Only 30 of ~2000+ BOE laws** | `MAX_LAWS = 30` in `extract_folder1_laws.py:38` | Users can't find most laws |
| **No full-text search for laws** | No FTS index for law articles; only judgment search exists | Users must browse manually or use browser find |
| **No `preamble_text` for BOE laws** | Field exists in schema but unused (`preamble_text` is absent in all 30 BOE JSONs) | Minor — `royal_decree.text` serves the same purpose |
| **TypeScript type gaps** | `CabinetDecisionData` missing `provisions`, `article.status` not in schema | Pre-existing TS errors (non-blocking, Vite skips type check) |
| **Authentication disabled** | `setupAuth` is mocked in `routes.ts:8-9`; `isAdmin` bypassed | Admin features are open to all |
| **No automated tests** | No test files found in repo | Regressions caught manually |
| **Duplicate paragraph parser** | `LawDetail.tsx` and `ArticleReferenceText.tsx` have identical AST logic | Changes must be applied twice; risk of drift |
| **No amendment linking** | Amendments show decree number but don't link to the amending law | Users can't navigate to the source of a change |
| **No version history** | Only current text + amendments shown; no diff view | Users can't see exactly what changed |
| **No Hijri-Gregorian date conversion** | Dates stored and displayed as-is | Users must convert manually |

Source: `scripts/extract_folder1_laws.py:38`, `server/routes.ts:8-14`, `shared/schema.ts`

## Near-term goals (measurable)

### 1. Scale law extraction to 200+ laws

- **Metric:** `library.json` contains 200+ entries with complete data
- **Work:** Modify `extract_folder1_laws.py` to iterate all BOE folders, not just Folder 1
- **Risk:** HTML structure may vary across folders; parser assumptions may break
- **Files:** `scripts/extract_folder1_laws.py`, `scripts/extract_cabinet_decisions.py`

### 2. Full-text search for law articles

- **Metric:** User can type Arabic text and get matching articles across all laws
- **Work:** Create FTS5 virtual table for law articles (similar to `judgments_fts` in `server/db.ts`)
- **Alternative:** Client-side search across loaded articles (simpler, limited scale)
- **Files:** `server/db.ts`, `server/routes.ts`, new search UI component

### 3. Extract shared paragraph parser into a single module

- **Metric:** `LawDetail.tsx` and `ArticleReferenceText.tsx` both import from one `parseParagraphs()` function
- **Work:** Create `client/src/lib/paragraph-parser.ts` with the AST logic from lines 1012-1228 of `LawDetail.tsx`
- **Risk:** Subtle differences between the two copies may exist
- **Files:** New `paragraph-parser.ts`, `LawDetail.tsx`, `ArticleReferenceText.tsx`

### 4. Add TypeScript types for BOE-specific fields

- **Metric:** Zero TS errors related to `amendments`, `status`, `content_parts`, `CabinetDecisionData`
- **Work:** Extend `shared/schema.ts` with optional BOE fields; remove `as any` casts
- **Files:** `shared/schema.ts`, `LawDetail.tsx`

### 5. Enable authentication and admin access control

- **Metric:** Only configured admin user IDs can access override/report endpoints
- **Work:** Replace mock auth in `routes.ts` with real authentication (Passport, session-based, or JWT)
- **Files:** `server/routes.ts`, new auth module

Source: `server/routes.ts:8-14` (mocked auth), `server/db.ts:16-38` (FTS5 pattern), `LawDetail.tsx:1012-1228` + `ArticleReferenceText.tsx` (duplicate parser)
