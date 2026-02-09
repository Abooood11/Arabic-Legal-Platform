# Debug Playbook

A strict troubleshooting recipe for formatting and display bugs in the platform.

## Step 1: Confirm the real input shape

Before touching any code, inspect the actual data the UI receives.

### For law display bugs

```bash
# Open the JSON file directly
# Path: client/public/data/laws/{law_id}_boe.json

# Check a specific article's paragraphs
python -c "
import json
with open('client/public/data/laws/{LAW_ID}_boe.json', encoding='utf-8') as f:
    law = json.load(f)
art = [a for a in law['articles'] if a['number'] == ARTICLE_NUMBER][0]
for i, p in enumerate(art.get('paragraphs', [])):
    print(f'{i}: marker={repr(p[\"marker\"])} level={p.get(\"level\",\"?\")} text={p[\"text\"][:80]}')
"
```

### For judgment display bugs

```bash
# Query the SQLite database directly
sqlite3 data.db "SELECT substr(text, 1, 500) FROM judgments WHERE id = {ID}"
```

### For instrument type bugs

```bash
# Check what issuing_authority contains
python scripts/check_instruments.py
```

Source: `scripts/check_instruments.py`, `client/public/data/laws/` directory

## Step 2: Identify the break point

The pipeline has 3 stages where bugs manifest differently:

### A. Extraction bug (wrong data in JSON)

**Symptoms:**
- Missing text, truncated articles, wrong markers
- Same bug appears in raw JSON file (not just on screen)

**Check:** Open the JSON file and inspect `paragraphs[]` for the article in question.

**Fix location:** `scripts/extract_folder1_laws.py` (then re-run extraction)

**Past examples:**
- Span fragment leakage → fixed in `_container_to_text()` (CLAUDE.md issue #1)
- Missing cabinet decisions → fixed in `extract_cabinet_decisions.py` (CLAUDE.md section "Instruments")
- Marker without hyphen → fixed in `_make_marker()` (CLAUDE.md issue #2)

### B. Parse bug (wrong visual AST from correct data)

**Symptoms:**
- JSON data looks correct, but on-screen hierarchy/indentation is wrong
- Marker appears as body text, or body text appears as marker
- Wrong nesting level

**Check:** Add `console.log` in the paragraph AST section of `LawDetail.tsx` (around line 1100):

```typescript
// Temporary debug: log visual AST
console.log('visualParas', visualParas.map(vp => ({
  marker: vp.marker, text: vp.text?.slice(0, 40), level: vp.visualLevel
})));
```

**Fix location:** `LawDetail.tsx` lines 1012-1228 (paragraph AST parser)

**CRITICAL:** The same parsing logic exists in `ArticleReferenceText.tsx` (ExpandedArticlePanel). Changes must be applied to both files.

**Past examples:**
- "أولاً :" as plain text → ordinal regex promotion (CLAUDE.md issue #7)
- Mixed ordinal/numeric levels → visual level computation (CLAUDE.md issue #6)
- Continuation paragraph misalignment → inherited level lookup (CLAUDE.md issue #5)

### C. Render bug (wrong HTML/CSS from correct AST)

**Symptoms:**
- Visual AST looks correct in console, but display is broken
- Layout issues (RTL, indentation, alignment)
- Missing clickable links

**Check:** Inspect the DOM in browser dev tools. Compare with visual AST console output.

**Fix location:**
- Indentation/layout → `NumberedItem.tsx` or inline styles in `LawDetail.tsx`
- Reference links → `ArticleReferenceText.tsx` lines 211-420 (detection) or 677-821 (rendering)
- Preamble formatting → `PreambleSection` in `LawDetail.tsx` lines 111-270

**Past examples:**
- Compound ordinal "الثامنة عشرة" partially linked → exact dictionary match (CLAUDE.md issue #3 + ArticleReferenceText)
- Reference "التاسعة أو" treated as one article → progressive word match with break on no-match (CLAUDE.md)

Source: `LawDetail.tsx`, `ArticleReferenceText.tsx`, `NumberedItem.tsx`

## Step 3: Add logs in the correct location

| Bug type | Where to log | What to log |
|----------|-------------|-------------|
| Extraction | `extract_folder1_laws.py` after `_paras_from_text` | `print(json.dumps(paras, ensure_ascii=False, indent=2))` |
| Paragraph AST | `LawDetail.tsx` line ~1100 | `console.log('visualParas', ...)` |
| Reference detection | `ArticleReferenceText.tsx` line ~380 | `console.log('segments', segments)` |
| Preamble classification | `LawDetail.tsx` line ~155 | `console.log(lineIndex, classifyLine(line), line.slice(0,50))` |
| Instrument type | `LawDetail.tsx` line ~795 | `console.log('issuingAuth', issuingAuth, 'primaryTitle', primaryTitle)` |
| API response | Browser Network tab | Check `/api/laws/{id}` response JSON |

## Step 4: One success criterion (before/after)

Every fix must define:

1. **Before:** Screenshot or text showing the exact wrong output
2. **After:** Screenshot or text showing the correct output
3. **Regression check:** Verify the fix doesn't break other articles

### Regression check recipe

```bash
# Quick visual scan: open these laws that exercise different patterns
# 1. نظام المرور (101 articles, tables, amendments, mixed markers)
# 2. النظام الأساسي للحكم (أمر ملكي, no cabinet decision)
# 3. نظام الجنسية (قرار مجلس الوزراء only, no royal decree)
# 4. نظام المعاملات المدنية (manual curation, structured royal decree)
```

Source: `client/public/data/laws/` (file variety), `CLAUDE.md` (instrument type patterns)

## Confirmed issue patterns (from development history)

| # | Issue | Root cause | Fix file | Ref |
|---|-------|------------|----------|-----|
| 1 | Span fragments in extracted text | `get_text()` splits at span boundaries | `extract_folder1_laws.py` (`_container_to_text`) | CLAUDE.md #1 |
| 2 | Marker missing hyphen | No post-processing on raw marker | `extract_folder1_laws.py` (`_make_marker`) | CLAUDE.md #2 |
| 3 | Article 19 linked as 9 | `.includes("التاسعة")` matches substring | `ArticleReferenceText.tsx` (exact ordinals dict) | CLAUDE.md #3 |
| 4 | Duplicate "المادة" in heading | `number_text` already contains prefix | `ArticleReferenceText.tsx` (hasAlMadda check) | CLAUDE.md #4 |
| 5 | Continuation paragraph at wrong indent | No level inheritance from preceding marker | `LawDetail.tsx` + `ArticleReferenceText.tsx` | CLAUDE.md #5 |
| 6 | أولاً and 1- at same visual level | No mixed-marker detection | `LawDetail.tsx` (visual level computation) | CLAUDE.md #6 |
| 7 | "أولاً :" as plain body text | Extraction didn't create marker | `LawDetail.tsx` (ordinal regex promotion) | CLAUDE.md #7 |
| 8 | "وبعد الاطلاع على قرار" styled as header | Regex not anchored to line start | `LawDetail.tsx` (PreambleSection classifyLine) | CLAUDE.md #9 |
| 9 | Amendment table position lost | Separate `description` + `tables` fields | `extract_folder1_laws.py` (content_parts) | CLAUDE.md #13 |
| 10 | "المرسوم الملكي" shown for أمر ملكي | Hardcoded title | `LawDetail.tsx` (dynamic instrument detection) | CLAUDE.md instruments |
