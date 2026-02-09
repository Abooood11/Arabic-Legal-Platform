# Data Contracts

## Core data shapes

### Law (top-level)

```typescript
// Source: shared/schema.ts (lawSchema, lines 80-101)
{
  law_name: string,                    // "نظام المرور"
  law_id?: string,                     // UUID from BOE
  title_ar?: string,                   // Display title
  jurisdiction_ar?: string,            // "السعودية"
  issuing_authority?: string,          // "مرسوم ملكي رقم م/85...قرار مجلس الوزراء رقم 236..."
  preamble_text?: string,             // (unused for BOE laws currently)
  royal_decree?: {                    // Royal decree / order
    text: string,                     //   Full text starting "بعون الله تعالى..."
    header?: string,                  //   (structured only) "مرسوم ملكي رقم..."
    opening?: string[],               //   (structured only) Dignitary lines
    recitals?: string[],              //   (structured only) "وبعد الاطلاع على..."
    articles?: object[],              //   (structured only) Decree articles
  },
  cabinet_decision_text?: string,     // Full cabinet decision text
  cabinet_decision?: object,          // (structured only) Cabinet decision data
  total_articles?: number,
  articles: Article[],
  structure?: object,                 // Hierarchical part/chapter/section breakdown
  source_links?: [{source_id, url, label_ar}],
}
```

Source: `shared/schema.ts:80-101`, sample JSON files in `client/public/data/laws/`

### Article

```typescript
// Source: shared/schema.ts (articleSchema, lines 58-68)
{
  number: number,                      // 1, 2, 3...
  number_text?: string,                // "الأولى", "الثانية"... (Arabic ordinal)
  heading?: string,                    // Section heading (rare)
  text: string,                        // Full article text (fallback display)
  paragraphs?: Paragraph[],            // Structured sub-units (preferred for rendering)
  tags?: string[],
  keywords?: string[],
  cross_similar?: CrossSimilar[],      // Comparative articles from other jurisdictions
  regulations?: Regulation[],          // Executive implementing rules
  // BOE-specific (not in schema, accessed via `as any`):
  amendments?: Amendment[],            // Amendment history
  status?: string,                     // "ملغاة" = repealed
  section?: string,                    // Hierarchical position
  part?: string,
  chapter?: string,
  branch?: string,
  sub_section?: string,
  sub_sub_section?: string,
}
```

Source: `shared/schema.ts:58-68`, `LawDetail.tsx:835-848` (section/part/chapter usage)

### Paragraph

```typescript
// Source: shared/schema.ts (paragraphSchema, lines 46-49)
// Produced by: scripts/extract_folder1_laws.py (_paras_from_text)
{
  marker: string,    // "1-", "أ-", "أولاً:", "" (empty = continuation)
  text: string,      // The paragraph body text
  level?: number,    // 0, 1, 2 (data-level from extraction; may differ from visual level)
  type?: string,     // "table" for table paragraphs
  table_rows?: string[][],  // For type="table": array of rows, each row is array of cells
}
```

Source: `shared/schema.ts:46-49`, `scripts/extract_folder1_laws.py:177+` (_paras_from_text)

### Amendment

```typescript
// Not in Zod schema (accessed via `as any` in LawDetail.tsx)
// Produced by: scripts/extract_folder1_laws.py (_extract_amendments)
{
  decree?: string,              // "مرسوم ملكي رقم..."
  date?: string,                // "1444/5/15"
  description?: string,         // Fallback plain text (tables stripped)
  content_parts?: [{            // Ordered text+table sequence (preferred)
    type: "text" | "table",
    text?: string,              // For type="text"
    table_rows?: string[][],    // For type="table"
  }],
}
```

Source: `LawDetail.tsx:1239-1355` (amendment rendering), `CLAUDE.md` issue #13

### Regulation

```typescript
// Source: shared/schema.ts (regulationSchema, lines 51-56)
{
  number: string,               // "1", "أ"
  text: string,                 // Regulation body
  sub_items?: Paragraph[],      // Nested items
  regulations?: Regulation[],   // Recursive sub-regulations
}
```

### Judgment

```typescript
// Source: shared/models/judgments.ts (lines 4-27)
{
  id: number,                   // Auto-increment PK
  caseId: string,               // External case identifier
  yearHijri?: number,           // Hijri year
  city?: string,                // Court city
  courtBody?: string,           // Court name
  circuitType?: string,         // Circuit type
  judgmentNumber?: string,
  judgmentDate?: string,         // Date string
  text: string,                 // Full judgment text
  source: string,               // "sa_judicial" | "egypt_cassation"
  appealType?: string,
  judges?: {role: string, name: string}[],  // JSON column
  createdAt: string,
}
```

### Library Item

```typescript
// Source: shared/schema.ts (libraryItemSchema, lines 14-28)
{
  id: string,                          // law_id or slug
  title_ar: string,                    // Display name
  jurisdiction_ar: string,             // "السعودية"
  doc_type: "official_text" | "rights_reserved",
  category: "law" | "regulation" | "decision" | "guide" | "gazette",
  primary_source_id: string,           // "boe" | "manual"
  links: [{source_id, url, label_ar}],
  notes_ar?: string,                   // e.g. "يحتوي على 3 تعديلات"
  laws_included?: string[],            // For compound entries
}
```

## What varies across sources

| Aspect | BOE extraction | Manual curation | Impact |
|--------|---------------|-----------------|--------|
| `paragraphs` array | Always present, generated by `_paras_from_text` | May be absent (text-only fallback) | UI must handle both paths |
| `marker` format | Always has hyphen ("1-", "أ-") | May lack hyphen | Normalization happens at extract time |
| `royal_decree` shape | `{text: string}` (flat) | `{header, opening, recitals, articles}` (structured) | UI checks for `.header` to pick rendering path |
| `amendments` | Extracted from BOE popup divs | Not present | UI shows amendment section only if present |
| `issuing_authority` | Concatenated instrument references | Not present | Instrument type detection falls back to "المرسوم الملكي" |
| `cabinet_decision_text` | Extracted separately via `extract_cabinet_decisions.py` | Not present | PreambleSection returns null if missing |
| `number_text` | Arabic ordinal ("الأولى") | May be absent | Display falls back to numeric |
| `structure` | Present for 6/30 laws (hierarchical breakdown) | Not present | Section headers come from article-level fields |

Source: `server/storage.ts:28-42` (getLaw tries `{id}.json` then `{id}_boe.json`), `LawDetail.tsx:780-821` (rendering path selection)

## Raw vs normalized-for-display storage rules

| Data | Stored as | Normalized at | Rule |
|------|-----------|---------------|------|
| Article text | Raw extraction | Never modified | `article.text` is the immutable source |
| Paragraphs | Structured `{marker, text, level}` | Extract time | `_paras_from_text` splits and normalizes once |
| Visual levels | Not stored | Render time | `LawDetail.tsx` computes visual levels from marker types |
| Hindi numerals | Western digits in JSON | Render time | `toHindiNumerals()` converts for display only |
| Article references | Plain text | Render time | `ArticleReferenceText` detects and links at display time |
| Dates | Raw string | Render time | `normalizeArabicDate()` wraps in LTR span for display |
| Admin overrides | `overrideText` in SQLite | Never | Overrides replace display text, original preserved in JSON |

Source: `LawDetail.tsx` (toHindiNumerals at line 72, normalizeArabicDate at line 77), `ArticleReferenceText.tsx` (parseArticleReferences)
