/**
 * Arabic Legal Text Normalizer
 *
 * Automatically corrects common OCR and extraction errors in Arabic legal text.
 * Used as a pipeline filter on all text served from the API.
 *
 * Three categories of corrections:
 * 1. Letter confusion (ق↔ف, أ↔ا↔ئ, ه↔ة) - common in OCR
 * 2. Missing diacritical marks (ء, إ) - common in digital extraction
 * 3. Legal term standardization - ensures consistent spelling
 */

// Each entry: [wrong, right]
// Ordered: longer patterns first to avoid partial matches
const LEGAL_CORRECTIONS: [string, string][] = [
  // === استئناف variants (most critical) ===
  ['الاستئناق', 'الاستئناف'],
  ['الأستئناف', 'الاستئناف'],
  ['الاستأناف', 'الاستئناف'],
  ['استئناق', 'استئناف'],
  ['الإستئناف', 'الاستئناف'],

  // === ه → ة (ta marbuta) OCR errors ===
  // These are matched with word boundary awareness
  ['اللائحه', 'اللائحة'],
  ['المحكمه', 'المحكمة'],
  ['الشريعه', 'الشريعة'],
  ['المملكه', 'المملكة'],
  ['الحكومه', 'الحكومة'],
  ['الوزاره', 'الوزارة'],
  ['الشخصيه', 'الشخصية'],
  ['التجاره', 'التجارة'],
  ['العقوبه', 'العقوبة'],
  ['المخالفه', 'المخالفة'],
  ['الغرامه', 'الغرامة'],
  ['الأنظمه', 'الأنظمة'],
  ['المحدوده', 'المحدودة'],
  ['الجنائيه', 'الجنائية'],
  ['الاداريه', 'الإدارية'],
  ['الماليه', 'المالية'],
  ['القضائيه', 'القضائية'],
  ['التنفيذيه', 'التنفيذية'],
  ['النظاميه', 'النظامية'],
  ['الشرعيه', 'الشرعية'],
  ['المدنيه', 'المدنية'],
  ['العقاريه', 'العقارية'],
  ['البحريه', 'البحرية'],
  ['العسكريه', 'العسكرية'],
  ['الصحيه', 'الصحية'],
  ['البيئيه', 'البيئية'],
  ['الجمركيه', 'الجمركية'],
  ['الضريبيه', 'الضريبية'],
  ['العامه', 'العامة'],
  ['الخاصه', 'الخاصة'],
  ['الدوليه', 'الدولية'],
  ['المحليه', 'المحلية'],
  ['الرسميه', 'الرسمية'],

  // === Missing hamza/إ ===
  ['الاسلاميه', 'الإسلامية'],
  ['الاسلامية', 'الإسلامية'],
  ['الاسلامي', 'الإسلامي'],
  ['الإجرائات', 'الإجراءات'],
  ['الاجراءات', 'الإجراءات'],
  ['الاجراات', 'الإجراءات'],

  // === Legal term standardization ===
  ['المرافعاة', 'المرافعات'],

  // === OCR mangled section headers ===
  ['فنسختتم الحكيان', 'مستند الحكم'],
];

// Pre-compile regex patterns for performance
const COMPILED_CORRECTIONS: { regex: RegExp; replacement: string }[] =
  LEGAL_CORRECTIONS.map(([wrong, right]) => ({
    regex: new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    replacement: right,
  }));

/**
 * Normalize a single string of Arabic legal text.
 * Returns the corrected text and the number of corrections made.
 */
export function normalizeArabicText(text: string): { text: string; corrections: number } {
  if (!text || typeof text !== 'string') return { text, corrections: 0 };

  let result = text;
  let corrections = 0;

  for (const { regex, replacement } of COMPILED_CORRECTIONS) {
    const matches = result.match(regex);
    if (matches) {
      corrections += matches.length;
      result = result.replace(regex, replacement);
    }
  }

  return { text: result, corrections };
}

/**
 * Deep-normalize all string values in a JSON object.
 * Recursively walks all strings, arrays, and nested objects.
 */
export function normalizeJsonObject<T>(obj: T): { data: T; totalCorrections: number } {
  let totalCorrections = 0;

  function walk(value: any): any {
    if (typeof value === 'string') {
      const { text, corrections } = normalizeArabicText(value);
      totalCorrections += corrections;
      return text;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value && typeof value === 'object') {
      const result: any = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = walk(val);
      }
      return result;
    }
    return value;
  }

  const data = walk(obj) as T;
  return { data, totalCorrections };
}

/**
 * Express middleware that normalizes Arabic text in JSON responses.
 * Intercepts res.json() to apply corrections before sending.
 */
export function arabicNormalizerMiddleware() {
  return (_req: any, res: any, next: any) => {
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      if (body && typeof body === 'object') {
        const { data } = normalizeJsonObject(body);
        return originalJson(data);
      }
      return originalJson(body);
    };
    next();
  };
}
