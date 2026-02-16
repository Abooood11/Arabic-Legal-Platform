import { sqlite } from "../../db";
import type { ScanFinding, ScanResult, AuditContext } from "../types";

// Patterns that indicate OCR/formatting issues
const KASHIDA_PATTERN = /[\u0640]{3,}/;
const LATIN_IN_ARABIC = /[a-zA-Z]{3,}/;
const EXCESSIVE_DIACRITICS = /[\u064B-\u065F]{3,}/;
const MALFORMED_DATE_PATTERN = /(\d{1,2})[-/](\d{1,2})[-/](1[34]\d{2})/;
const PDF_ARTIFACT_PATTERN = /^[\s\-_=*]{5,}$/m;

const BATCH_SIZE = 5000;
const MAX_JUDGMENTS = 50000;

export async function runContentScan(context: AuditContext): Promise<ScanResult> {
  const findings: ScanFinding[] = [];
  let itemsScanned = 0;

  const totalCount = (sqlite.prepare("SELECT count(*) as cnt FROM judgments").get() as any).cnt;
  const limit = Math.min(totalCount, MAX_JUDGMENTS);

  // Sample evenly across sources
  const sources = sqlite
    .prepare("SELECT DISTINCT source FROM judgments")
    .all() as any[];

  for (const { source } of sources) {
    if (!context.judgmentSourceStats[source]) {
      context.judgmentSourceStats[source] = { total: 0, withIssues: 0 };
    }

    const sourceCount = (
      sqlite.prepare("SELECT count(*) as cnt FROM judgments WHERE source = ?").get(source) as any
    ).cnt;
    context.judgmentSourceStats[source].total = sourceCount;

    // Sample proportionally but cap
    const sampleSize = Math.min(
      Math.ceil((sourceCount / totalCount) * limit),
      sourceCount
    );

    let offset = 0;
    let scannedForSource = 0;

    while (scannedForSource < sampleSize) {
      const batch = sqlite
        .prepare(
          `SELECT id, text, source, judgment_date, court_body, case_id
          FROM judgments WHERE source = ?
          ORDER BY id LIMIT ? OFFSET ?`
        )
        .all(source, BATCH_SIZE, offset) as any[];

      if (batch.length === 0) break;

      for (const judgment of batch) {
        if (scannedForSource >= sampleSize) break;
        scannedForSource++;
        itemsScanned++;

        const text: string = judgment.text || "";
        let hasIssue = false;

        // Truncated text
        if (text.length < 100 && text.length > 0) {
          findings.push({
            severity: "high",
            code: "TRUNCATED_TEXT",
            category: "content",
            entityType: "judgment",
            entityId: String(judgment.id),
            entityName: `${judgment.court_body || source} — ${judgment.case_id || judgment.id}`,
            message: `نص الحكم قصير جداً (${text.length} حرف) — قد يكون مبتوراً`,
          });
          hasIssue = true;
        }

        // Empty text
        if (text.trim().length === 0) {
          findings.push({
            severity: "critical",
            code: "EMPTY_JUDGMENT",
            category: "content",
            entityType: "judgment",
            entityId: String(judgment.id),
            entityName: `${judgment.court_body || source} — ${judgment.case_id || judgment.id}`,
            message: "نص الحكم فارغ تماماً",
          });
          hasIssue = true;
          continue;
        }

        // Kashida lines
        if (KASHIDA_PATTERN.test(text)) {
          findings.push({
            severity: "low",
            code: "KASHIDA_ARTIFACT",
            category: "content",
            entityType: "judgment",
            entityId: String(judgment.id),
            entityName: `${judgment.court_body || source} — ${judgment.case_id || judgment.id}`,
            message: "يحتوي خطوط كشيدة (ـــ) متبقية من التنسيق الأصلي",
          });
          hasIssue = true;
        }

        // Latin characters mixed in
        if (LATIN_IN_ARABIC.test(text)) {
          // Exclude common legal Latin (PDF, URL, etc.)
          const latinMatches = text.match(/[a-zA-Z]{3,}/g) || [];
          const nonTechnical = latinMatches.filter(
            (m) => !/^(PDF|URL|HTTP|HTTPS|WWW|DOC|API|SMS|SIM|GPS|DNA|ID|ISO|ATM)$/i.test(m)
          );
          if (nonTechnical.length > 2) {
            findings.push({
              severity: "medium",
              code: "LATIN_MIXED",
              category: "content",
              entityType: "judgment",
              entityId: String(judgment.id),
              entityName: `${judgment.court_body || source} — ${judgment.case_id || judgment.id}`,
              message: `يحتوي أحرف لاتينية مختلطة مع النص العربي (${nonTechnical.slice(0, 3).join("، ")})`,
            });
            hasIssue = true;
          }
        }

        // Malformed Hijri dates
        const dateMatches = text.matchAll(new RegExp(MALFORMED_DATE_PATTERN, "g"));
        for (const match of dateMatches) {
          const month = parseInt(match[2]);
          const day = parseInt(match[1]);
          if (month > 12 || month < 1 || day > 30 || day < 1) {
            findings.push({
              severity: "medium",
              code: "MALFORMED_DATE",
              category: "content",
              entityType: "judgment",
              entityId: String(judgment.id),
              entityName: `${judgment.court_body || source} — ${judgment.case_id || judgment.id}`,
              message: `تاريخ هجري مشوه: ${match[0]}`,
            });
            hasIssue = true;
            break;
          }
        }

        // PDF artifacts
        if (PDF_ARTIFACT_PATTERN.test(text)) {
          findings.push({
            severity: "low",
            code: "PDF_ARTIFACT",
            category: "content",
            entityType: "judgment",
            entityId: String(judgment.id),
            entityName: `${judgment.court_body || source} — ${judgment.case_id || judgment.id}`,
            message: "يحتوي بقايا تنسيق PDF (خطوط فاصلة)",
          });
          hasIssue = true;
        }

        // Excessive diacritics
        if (EXCESSIVE_DIACRITICS.test(text)) {
          findings.push({
            severity: "low",
            code: "EXCESSIVE_DIACRITICS",
            category: "content",
            entityType: "judgment",
            entityId: String(judgment.id),
            entityName: `${judgment.court_body || source} — ${judgment.case_id || judgment.id}`,
            message: "يحتوي تشكيل مفرط متتالي (قد يكون خطأ OCR)",
          });
          hasIssue = true;
        }

        if (hasIssue) {
          context.judgmentSourceStats[source].withIssues++;
        }
      }

      offset += BATCH_SIZE;

      // Yield to event loop
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Add OCR patterns to context
  const ocrPatterns = new Set<string>();
  for (const f of findings) {
    if (f.code === "KASHIDA_ARTIFACT") ocrPatterns.add("kashida");
    if (f.code === "LATIN_MIXED") ocrPatterns.add("latin_mixed");
    if (f.code === "PDF_ARTIFACT") ocrPatterns.add("pdf_artifact");
    if (f.code === "EXCESSIVE_DIACRITICS") ocrPatterns.add("excessive_diacritics");
  }
  context.commonOcrPatterns = [...ocrPatterns];

  return { category: "content", itemsScanned, findings };
}
