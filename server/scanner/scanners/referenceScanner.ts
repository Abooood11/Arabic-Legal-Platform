import fs from "fs";
import path from "path";
import type { ScanFinding, ScanResult, AuditContext } from "../types";

// Map Arabic ordinals to numbers
const ORDINAL_MAP: Record<string, number> = {
  "الأولى": 1, "الأول": 1, "الثانية": 2, "الثاني": 2, "الثالثة": 3, "الثالث": 3,
  "الرابعة": 4, "الرابع": 4, "الخامسة": 5, "الخامس": 5, "السادسة": 6, "السادس": 6,
  "السابعة": 7, "السابع": 7, "الثامنة": 8, "الثامن": 8, "التاسعة": 9, "التاسع": 9,
  "العاشرة": 10, "العاشر": 10, "الحادية عشرة": 11, "الحادي عشر": 11,
  "الثانية عشرة": 12, "الثاني عشر": 12, "الثالثة عشرة": 13, "الثالث عشر": 13,
  "الرابعة عشرة": 14, "الرابع عشر": 14, "الخامسة عشرة": 15, "الخامس عشر": 15,
  "السادسة عشرة": 16, "السادس عشر": 16, "السابعة عشرة": 17, "السابع عشر": 17,
  "الثامنة عشرة": 18, "الثامن عشر": 18, "التاسعة عشرة": 19, "التاسع عشر": 19,
  "العشرين": 20, "العشرون": 20,
};

// Match "المادة X" where X is a number or ordinal
const ARTICLE_REF_NUMERIC = /المادة\s+(\d+)/g;
const ARTICLE_REF_ORDINAL = /المادة\s+(الأولى|الأول|الثانية|الثاني|الثالثة|الثالث|الرابعة|الرابع|الخامسة|الخامس|السادسة|السادس|السابعة|السابع|الثامنة|الثامن|التاسعة|التاسع|العاشرة|العاشر|الحادية عشرة|الحادي عشر|الثانية عشرة|الثاني عشر|الثالثة عشرة|الثالث عشر|الرابعة عشرة|الرابع عشر|الخامسة عشرة|الخامس عشر|السادسة عشرة|السادس عشر|السابعة عشرة|السابع عشر|الثامنة عشرة|الثامن عشر|التاسعة عشرة|التاسع عشر|العشرين|العشرون)/g;

export async function runReferenceScan(context: AuditContext): Promise<ScanResult> {
  const findings: ScanFinding[] = [];
  let itemsScanned = 0;

  const libraryPath = path.join(process.cwd(), "client", "public", "data", "library.json");
  const lawsDir = path.join(process.cwd(), "client", "public", "data", "laws");

  if (!fs.existsSync(libraryPath)) {
    return { category: "reference", itemsScanned: 0, findings };
  }

  const library: any[] = JSON.parse(fs.readFileSync(libraryPath, "utf-8"));

  for (const item of library) {
    itemsScanned++;

    const suffixes = ["", "_boe", "_uqn"];
    let lawData: any = null;

    for (const suffix of suffixes) {
      const filePath = path.join(lawsDir, `${item.id}${suffix}.json`);
      if (fs.existsSync(filePath)) {
        try {
          lawData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          break;
        } catch { continue; }
      }
    }

    if (!lawData || !Array.isArray(lawData.articles)) continue;

    const lawName = lawData.law_name || item.title_ar || item.id;
    const maxArticle = Math.max(...lawData.articles.map((a: any) => a.number || 0));
    const existingNumbers = new Set(lawData.articles.map((a: any) => a.number));
    let hasIssue = false;

    for (const article of lawData.articles) {
      if (!article.text) continue;
      const text: string = article.text;
      const referencedNumbers = new Set<number>();

      // Find numeric references: "المادة 5"
      let match;
      const numRegex = new RegExp(ARTICLE_REF_NUMERIC.source, "g");
      while ((match = numRegex.exec(text)) !== null) {
        const num = parseInt(match[1]);
        if (num !== article.number) {
          referencedNumbers.add(num);
        }
      }

      // Find ordinal references: "المادة الخامسة"
      const ordRegex = new RegExp(ARTICLE_REF_ORDINAL.source, "g");
      while ((match = ordRegex.exec(text)) !== null) {
        const num = ORDINAL_MAP[match[1]];
        if (num && num !== article.number) {
          referencedNumbers.add(num);
        }
      }

      // Check if referenced articles exist
      for (const refNum of referencedNumbers) {
        if (!existingNumbers.has(refNum) && refNum > 0 && refNum <= maxArticle + 10) {
          findings.push({
            severity: "high",
            code: "BROKEN_REFERENCE",
            category: "reference",
            entityType: "law",
            entityId: item.id,
            entityName: lawName,
            message: `المادة ${article.number} تحيل إلى المادة ${refNum} غير الموجودة في هذا النظام`,
            location: `المادة ${article.number}`,
          });
          hasIssue = true;
        }
      }
    }

    if (hasIssue) {
      context.brokenReferencesByLaw.push(item.id);
    }

    // Yield every 100
    if (itemsScanned % 100 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return { category: "reference", itemsScanned, findings };
}
