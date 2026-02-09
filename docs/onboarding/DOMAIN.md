# Domain

## Scope

The platform currently covers:

| Content type | Source | Storage | Count |
|-------------|--------|---------|-------|
| **Saudi laws (BOE)** | laws.boe.gov.sa Folder 1 | JSON files in `client/public/data/laws/*_boe.json` | 30 |
| **Saudi laws (manual)** | Hand-curated | JSON files (`civil_transactions_sa.json`, `sharia_procedures.json`) | 2 |
| **Court judgments (Saudi)** | sa_judicial | SQLite `data.db` → `judgments` table | Variable |
| **Court judgments (Egypt)** | egypt_cassation | SQLite `data.db` → `judgments` table | Variable |
| **Regulations** | Linked to parent laws | JSON in `client/public/data/regulations.json` | Variable |

Source: `client/public/data/sources.json`, `client/public/data/library.json`, `shared/models/judgments.ts`

## Glossary

| Arabic term | English | Field / location | Notes |
|-------------|---------|------------------|-------|
| نظام | Law / Statute | `law_name` in JSON | A full legislative act |
| مادة | Article | `articles[].number` | The atomic unit of a law |
| فقرة | Paragraph | `articles[].paragraphs[]` | A sub-unit within an article, may have a marker |
| بند | Item / Clause | `paragraphs[].marker` | A numbered or lettered sub-item (1-, أ-, أولاً:) |
| مرسوم ملكي | Royal Decree | `royal_decree.text` | Issued by the King with Cabinet approval |
| أمر ملكي | Royal Order | `royal_decree.text` | Direct royal legislation (no Cabinet) |
| أمر سامي | Royal Directive | `royal_decree.text` | Older instrument type |
| قرار مجلس الوزراء | Cabinet Decision | `cabinet_decision_text` | Accompanies Royal Decree or stands alone |
| تعديل | Amendment | `articles[].amendments[]` | A later modification to an article |
| ملغاة | Repealed | `articles[].status` | Article no longer in force |
| لائحة | Regulation | `articles[].regulations[]` | Executive implementing rules |
| حكم | Judgment | `judgments` table | Court decision |
| إحالة | Cross-reference | Detected in article text | e.g. "المادة الخامسة" linking to article 5 |
| هيئة الخبراء | Bureau of Experts (BOE) | Source website | Official publisher of Saudi legislation |

Source: `shared/schema.ts` (lawSchema, articleSchema), `CLAUDE.md` (instrument types section)

## Legal text risks and mitigations

### 1. Text distortion

| Risk | Example | Mitigation |
|------|---------|------------|
| Span fragment leakage | BOE wraps words in `<span>` tags; naive extraction splits mid-sentence | `_container_to_text()` uses innerHTML approach: replaces `<br>` with `\n`, strips all tags. Source: `scripts/extract_folder1_laws.py:124-153` |
| Marker loss | "1" extracted without "-" | `_make_marker()` always appends hyphen. Source: `scripts/extract_folder1_laws.py:167-174` |
| Ordinal text as plain text | "أولاً :" appears as body text instead of marker | Parser detects ordinal regex and promotes to marker. Source: `LawDetail.tsx` paragraph AST, `CLAUDE.md` issue #7 |

### 2. Text clipping

| Risk | Example | Mitigation |
|------|---------|------------|
| Truncated articles | `get_text(strip=True)` loses line breaks | Use `_container_to_text()` which preserves `<br>` as `\n`. Source: `scripts/extract_folder1_laws.py:124` |
| Missing cabinet decisions | Only HTMLContainer divs were scraped | Separate extraction via `<h4>` + `<p>` elements. Source: `scripts/extract_cabinet_decisions.py` |
| Amendment text as single block | `get_text(strip=True)` collapses whitespace | Use `_container_to_text()` + `whitespace-pre-wrap` CSS. Source: `CLAUDE.md` issue #14 |

### 3. Formatting fidelity

| Risk | Example | Mitigation |
|------|---------|------------|
| Table position lost | Tables appear separated from their context | `content_parts` array preserves original text/table interleaving. Source: `CLAUDE.md` issue #13 |
| Mixed marker hierarchy | أولاً and 1- at same level | Visual level computation: ordinals→0, numeric→1, letters→2. Source: `LawDetail.tsx` lines 1134-1155 |
| Compound ordinal mismatch | "الثامنة عشرة" (18) detected as "الثامنة" (8) | Exact dictionary match with progressive 1-4 word lookahead. Source: `ArticleReferenceText.tsx` |
| Wrong instrument title | "المرسوم الملكي" shown for أمر ملكي law | Dynamic detection from `issuing_authority` field. Source: `LawDetail.tsx` lines 787-821 |
