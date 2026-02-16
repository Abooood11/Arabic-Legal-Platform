import fs from "fs";
import path from "path";
import type { ScanFinding, ScanResult, AuditContext } from "../types";

const MANDATORY_FIELDS = ["law_id", "law_name", "title", "articles"];

const PLACEHOLDER_PATTERNS = [/TODO/i, /FIXME/i, /^\.\.\.$/, /غير متوفر/, /يُضاف لاحقًا/];

const VALID_STATUSES = new Set(["active", "amended", "repealed", ""]);

// Arabic ordinal markers in sequence
const ARABIC_ALPHA_ORDER = ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "هـ", "و", "ي"];

export async function runStructuralScan(context: AuditContext): Promise<ScanResult> {
  const findings: ScanFinding[] = [];
  let itemsScanned = 0;

  const libraryPath = path.join(process.cwd(), "client", "public", "data", "library.json");
  const lawsDir = path.join(process.cwd(), "client", "public", "data", "laws");

  if (!fs.existsSync(libraryPath)) {
    findings.push({
      severity: "critical",
      code: "MISSING_LIBRARY",
      category: "structural",
      entityType: "law",
      entityId: "library.json",
      message: "ملف library.json غير موجود",
    });
    return { category: "structural", itemsScanned: 0, findings };
  }

  const library: any[] = JSON.parse(fs.readFileSync(libraryPath, "utf-8"));

  for (const item of library) {
    itemsScanned++;

    // Find law file
    const suffixes = ["", "_boe", "_uqn"];
    let lawData: any = null;
    let source = "unknown";

    for (const suffix of suffixes) {
      const filePath = path.join(lawsDir, `${item.id}${suffix}.json`);
      if (fs.existsSync(filePath)) {
        try {
          lawData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          source = suffix ? suffix.slice(1) : "direct";
          break;
        } catch (e: any) {
          findings.push({
            severity: "critical",
            code: "INVALID_JSON",
            category: "structural",
            entityType: "law",
            entityId: item.id,
            entityName: item.title_ar || item.id,
            message: `ملف JSON تالف: ${e.message}`,
          });
        }
      }
    }

    if (!lawData) {
      findings.push({
        severity: "critical",
        code: "MISSING_FILE",
        category: "structural",
        entityType: "law",
        entityId: item.id,
        entityName: item.title_ar || item.id,
        message: `لا يوجد ملف JSON لهذا النظام`,
      });
      continue;
    }

    // Track source stats
    if (!context.lawSourceStats[source]) {
      context.lawSourceStats[source] = { total: 0, withIssues: 0 };
    }
    context.lawSourceStats[source].total++;

    const lawName = lawData.law_name || item.title_ar || item.id;
    let hasIssue = false;

    // Check mandatory fields
    for (const field of MANDATORY_FIELDS) {
      if (!lawData[field]) {
        findings.push({
          severity: "high",
          code: "MISSING_FIELD",
          category: "structural",
          entityType: "law",
          entityId: item.id,
          entityName: lawName,
          message: `حقل "${field}" مفقود`,
          location: field,
        });
        hasIssue = true;
      }
    }

    const articles = lawData.articles;
    if (!Array.isArray(articles)) continue;

    // Article count mismatch
    if (lawData.total_articles && lawData.total_articles !== articles.length) {
      findings.push({
        severity: "medium",
        code: "ARTICLE_COUNT_MISMATCH",
        category: "structural",
        entityType: "law",
        entityId: item.id,
        entityName: lawName,
        message: `عدد المواد المعلن (${lawData.total_articles}) لا يطابق الفعلي (${articles.length})`,
      });
      hasIssue = true;
    }

    // Check individual articles
    const articleNumbers = new Map<number, number>();
    for (const article of articles) {
      const num = article.number;

      // Empty text
      if (!article.text || article.text.trim().length === 0) {
        findings.push({
          severity: "critical",
          code: "EMPTY_ARTICLE",
          category: "structural",
          entityType: "law",
          entityId: item.id,
          entityName: lawName,
          message: `المادة ${num} نصها فارغ`,
          location: `المادة ${num}`,
        });
        hasIssue = true;
      }

      // Placeholder text
      if (article.text) {
        for (const pattern of PLACEHOLDER_PATTERNS) {
          if (pattern.test(article.text)) {
            findings.push({
              severity: "medium",
              code: "PLACEHOLDER_TEXT",
              category: "structural",
              entityType: "law",
              entityId: item.id,
              entityName: lawName,
              message: `المادة ${num} تحتوي نصاً مؤقتاً (placeholder)`,
              location: `المادة ${num}`,
            });
            hasIssue = true;
            break;
          }
        }
      }

      // Invalid status
      if (article.status && !VALID_STATUSES.has(article.status)) {
        findings.push({
          severity: "low",
          code: "INVALID_STATUS",
          category: "structural",
          entityType: "law",
          entityId: item.id,
          entityName: lawName,
          message: `المادة ${num} لها حالة غير صالحة: "${article.status}"`,
          location: `المادة ${num}`,
        });
        hasIssue = true;
      }

      // Track duplicates
      if (typeof num === "number" && num > 0) {
        articleNumbers.set(num, (articleNumbers.get(num) || 0) + 1);
      }

      // Check paragraph hierarchy
      if (Array.isArray(article.paragraphs)) {
        let prevLevel = 0;
        for (let i = 0; i < article.paragraphs.length; i++) {
          const para = article.paragraphs[i];
          const level = para.level || 0;
          if (level > prevLevel + 1 && prevLevel >= 0) {
            findings.push({
              severity: "low",
              code: "LEVEL_JUMP",
              category: "structural",
              entityType: "law",
              entityId: item.id,
              entityName: lawName,
              message: `المادة ${num}: قفزة في مستوى الفقرات من ${prevLevel} إلى ${level}`,
              location: `المادة ${num}، الفقرة ${i + 1}`,
            });
            hasIssue = true;
            break; // one per article is enough
          }
          prevLevel = level;
        }
      }
    }

    // Duplicate article numbers
    for (const [num, count] of articleNumbers) {
      if (count > 1) {
        findings.push({
          severity: "high",
          code: "DUPLICATE_ARTICLE",
          category: "structural",
          entityType: "law",
          entityId: item.id,
          entityName: lawName,
          message: `المادة ${num} مكررة ${count} مرات`,
          location: `المادة ${num}`,
        });
        hasIssue = true;
      }
    }

    // Missing article numbers (gaps)
    if (articleNumbers.size > 2) {
      const sorted = [...articleNumbers.keys()].sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const expected = sorted[i - 1] + 1;
        if (sorted[i] !== expected && sorted[i] - sorted[i - 1] > 1) {
          for (let g = expected; g < sorted[i] && gaps.length < 5; g++) {
            gaps.push(g);
          }
        }
      }
      if (gaps.length > 0) {
        findings.push({
          severity: "medium",
          code: "MISSING_ARTICLE_NUMBERS",
          category: "structural",
          entityType: "law",
          entityId: item.id,
          entityName: lawName,
          message: `أرقام مواد مفقودة: ${gaps.join("، ")}`,
        });
        hasIssue = true;
      }
    }

    if (hasIssue) {
      context.lawSourceStats[source].withIssues++;
    }

    // Yield to event loop every 100 laws
    if (itemsScanned % 100 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return { category: "structural", itemsScanned, findings };
}
