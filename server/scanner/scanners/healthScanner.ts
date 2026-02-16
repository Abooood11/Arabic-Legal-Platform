import { sqlite } from "../../db";
import type { ScanFinding, ScanResult, AuditContext } from "../types";

export async function runHealthScan(_context: AuditContext): Promise<ScanResult> {
  const findings: ScanFinding[] = [];
  let itemsScanned = 0;

  // Check FTS5 index health
  const ftsChecks = [
    { table: "judgments_fts", source: "judgments", name: "فهرس الأحكام" },
    { table: "law_articles_fts", source: "law_articles", name: "فهرس مواد الأنظمة" },
    { table: "gazette_fts", source: "gazette_index", name: "فهرس الجريدة الرسمية" },
    { table: "crsd_principles_fts", source: "crsd_principles", name: "فهرس مبادئ الأوراق المالية" },
  ];

  for (const check of ftsChecks) {
    itemsScanned++;
    try {
      const ftsCount = (sqlite.prepare(`SELECT count(*) as cnt FROM ${check.table}`).get() as any).cnt;
      const srcCount = (sqlite.prepare(`SELECT count(*) as cnt FROM ${check.source}`).get() as any).cnt;

      if (ftsCount === 0 && srcCount > 0) {
        findings.push({
          severity: "critical",
          code: "FTS_EMPTY",
          category: "health",
          entityType: "index",
          entityId: check.table,
          entityName: check.name,
          message: `${check.name} فارغ رغم وجود ${srcCount} سجل في الجدول المصدر`,
        });
      } else if (Math.abs(ftsCount - srcCount) > srcCount * 0.01) {
        findings.push({
          severity: "high",
          code: "FTS_MISMATCH",
          category: "health",
          entityType: "index",
          entityId: check.table,
          entityName: check.name,
          message: `${check.name}: عدد سجلات الفهرس (${ftsCount}) لا يطابق المصدر (${srcCount})`,
        });
      }
    } catch (e: any) {
      findings.push({
        severity: "critical",
        code: "FTS_ERROR",
        category: "health",
        entityType: "index",
        entityId: check.table,
        entityName: check.name,
        message: `خطأ في الوصول إلى ${check.name}: ${e.message}`,
      });
    }
  }

  // Check core table record counts
  const tableCounts = [
    { table: "judgments", min: 500000, name: "الأحكام" },
    { table: "law_articles", min: 1000, name: "مواد الأنظمة" },
    { table: "gazette_index", min: 50000, name: "فهرس الجريدة" },
  ];

  for (const tc of tableCounts) {
    itemsScanned++;
    try {
      const count = (sqlite.prepare(`SELECT count(*) as cnt FROM ${tc.table}`).get() as any).cnt;
      if (count < tc.min) {
        findings.push({
          severity: "high",
          code: "LOW_RECORD_COUNT",
          category: "health",
          entityType: "index",
          entityId: tc.table,
          entityName: tc.name,
          message: `جدول ${tc.name} يحتوي ${count} سجل فقط (المتوقع أكثر من ${tc.min})`,
        });
      }
    } catch (e: any) {
      findings.push({
        severity: "critical",
        code: "TABLE_ERROR",
        category: "health",
        entityType: "index",
        entityId: tc.table,
        entityName: tc.name,
        message: `خطأ في الوصول إلى جدول ${tc.name}: ${e.message}`,
      });
    }
  }

  return { category: "health", itemsScanned, findings };
}
