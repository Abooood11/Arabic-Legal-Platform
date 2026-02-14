const ARABIC_STOP_WORDS = new Set([
  "في", "من", "على", "الى", "إلى", "عن", "مع", "ثم", "أو", "او", "و", "ال", "أن", "ان", "ما", "لا", "لم", "لن", "قد", "هذا", "هذه",
]);

const LEGAL_SYNONYMS: Record<string, string[]> = {
  "استئناف": ["اعتراض", "نقض"],
  "تعويض": ["ضرر", "مسؤولية"],
  "فسخ": ["بطلان", "إلغاء"],
  "تنفيذ": ["سند", "تنفيذي"],
  "حضانة": ["زيارة", "نفقة"],
  "نفقة": ["حضانة", "مهر"],
  "اثبات": ["إثبات", "بينة", "قرينة"],
  "عمالي": ["عمل", "مكافأة", "فصل"],
  "تجاري": ["شركة", "عقد", "مقاولة"],
};

function normalizeArabic(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأٱآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeArabic(value)
    .split(/[^A-Za-z0-9\u0600-\u06FF]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !ARABIC_STOP_WORDS.has(t));
}

export function buildLegalFtsQuery(rawQuery: string): string {
  const query = rawQuery.trim();
  if (!query) return "";

  const quoted = query.match(/"([^"]+)"/g)?.map((p) => p.replace(/"/g, "").trim()).filter(Boolean) ?? [];
  const tokens = tokenize(query);

  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    const synonyms = LEGAL_SYNONYMS[token] ?? [];
    for (const synonym of synonyms) {
      for (const synToken of tokenize(synonym)) expanded.add(synToken);
    }
  }

  const materialRef = normalizeArabic(query).match(/(?:ماده|الماده)\s*(\d{1,3})/);
  if (materialRef) {
    expanded.add("ماده");
    expanded.add(materialRef[1]);
  }

  const phrasePart = quoted.map((p) => `"${normalizeArabic(p)}"`).join(" OR ");
  const tokenPart = Array.from(expanded).map((t) => `${t}*`).join(" ");

  if (phrasePart && tokenPart) return `(${phrasePart}) OR (${tokenPart})`;
  return phrasePart || tokenPart;
}

export function buildLiteralFtsQuery(rawQuery: string): string {
  const normalized = normalizeArabic(rawQuery);
  if (!normalized) return "";
  return `"${normalized.replace(/"/g, "").trim()}"`;
}
