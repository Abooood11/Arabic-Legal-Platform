import { sqlite } from "../db";
import crypto from "crypto";
import type { ScanFinding, AuditContext } from "./types";

// ============================================
// Audit Runs
// ============================================

export function createAuditRun(): number {
  const stmt = sqlite.prepare(
    `INSERT INTO audit_runs (status, current_step) VALUES ('running', 'جاري البدء...')`
  );
  const result = stmt.run();
  return Number(result.lastInsertRowid);
}

export function updateAuditProgress(
  runId: number,
  progressPct: number,
  currentStep: string,
  counts?: {
    totalLaws?: number;
    totalJudgments?: number;
    totalFindings?: number;
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
  }
) {
  const sets = ["progress_pct = ?", "current_step = ?"];
  const params: any[] = [progressPct, currentStep];

  if (counts?.totalLaws !== undefined) {
    sets.push("total_laws_scanned = ?");
    params.push(counts.totalLaws);
  }
  if (counts?.totalJudgments !== undefined) {
    sets.push("total_judgments_scanned = ?");
    params.push(counts.totalJudgments);
  }
  if (counts?.totalFindings !== undefined) {
    sets.push("total_findings = ?");
    params.push(counts.totalFindings);
  }
  if (counts?.critical !== undefined) {
    sets.push("critical_count = ?");
    params.push(counts.critical);
  }
  if (counts?.high !== undefined) {
    sets.push("high_count = ?");
    params.push(counts.high);
  }
  if (counts?.medium !== undefined) {
    sets.push("medium_count = ?");
    params.push(counts.medium);
  }
  if (counts?.low !== undefined) {
    sets.push("low_count = ?");
    params.push(counts.low);
  }

  params.push(runId);
  sqlite.prepare(`UPDATE audit_runs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function completeAuditRun(runId: number, summary: string | null, context: AuditContext) {
  // Recount findings from DB
  const counts = sqlite
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN severity='high' THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN severity='medium' THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN severity='low' THEN 1 ELSE 0 END) as low
      FROM audit_findings WHERE audit_run_id = ?`
    )
    .get(runId) as any;

  sqlite
    .prepare(
      `UPDATE audit_runs SET
        status = 'completed', finished_at = datetime('now'), progress_pct = 100,
        current_step = 'اكتملت المراجعة',
        total_findings = ?, critical_count = ?, high_count = ?, medium_count = ?, low_count = ?,
        summary = ?, context = ?
      WHERE id = ?`
    )
    .run(
      counts.total || 0,
      counts.critical || 0,
      counts.high || 0,
      counts.medium || 0,
      counts.low || 0,
      summary,
      JSON.stringify(context),
      runId
    );
}

export function failAuditRun(runId: number, errorMessage: string) {
  sqlite
    .prepare(
      `UPDATE audit_runs SET status = 'failed', finished_at = datetime('now'), error_message = ?, current_step = 'فشلت المراجعة' WHERE id = ?`
    )
    .run(errorMessage, runId);
}

export function getLatestAuditRun(): any {
  return sqlite.prepare(`SELECT * FROM audit_runs ORDER BY id DESC LIMIT 1`).get();
}

export function getAuditRun(runId: number): any {
  return sqlite.prepare(`SELECT * FROM audit_runs WHERE id = ?`).get(runId);
}

// ============================================
// Audit Findings
// ============================================

function generateFingerprint(f: ScanFinding): string {
  const raw = `${f.severity}|${f.code}|${f.entityType}|${f.entityId}|${f.location || ""}`;
  return crypto.createHash("md5").update(raw).digest("hex");
}

export function insertFinding(runId: number, finding: ScanFinding): boolean {
  const fingerprint = generateFingerprint(finding);
  try {
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO audit_findings
        (audit_run_id, severity, code, category, entity_type, entity_id, entity_name, message, location, details, fingerprint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        runId,
        finding.severity,
        finding.code,
        finding.category,
        finding.entityType,
        finding.entityId,
        finding.entityName || null,
        finding.message,
        finding.location || null,
        finding.details ? JSON.stringify(finding.details) : null,
        fingerprint
      );
    return true;
  } catch {
    return false; // duplicate fingerprint
  }
}

export function insertFindings(runId: number, findings: ScanFinding[]): number {
  let inserted = 0;
  const insertStmt = sqlite.prepare(
    `INSERT OR IGNORE INTO audit_findings
    (audit_run_id, severity, code, category, entity_type, entity_id, entity_name, message, location, details, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = sqlite.transaction((items: ScanFinding[]) => {
    for (const f of items) {
      const fingerprint = generateFingerprint(f);
      const result = insertStmt.run(
        runId,
        f.severity,
        f.code,
        f.category,
        f.entityType,
        f.entityId,
        f.entityName || null,
        f.message,
        f.location || null,
        f.details ? JSON.stringify(f.details) : null,
        fingerprint
      );
      if (result.changes > 0) inserted++;
    }
  });

  tx(findings);
  return inserted;
}

export function getFindings(filters: {
  runId?: number;
  severity?: string;
  category?: string;
  status?: string;
  entityType?: string;
  page?: number;
  limit?: number;
}): { findings: any[]; total: number } {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.runId) {
    conditions.push("audit_run_id = ?");
    params.push(filters.runId);
  }
  if (filters.severity) {
    conditions.push("severity = ?");
    params.push(filters.severity);
  }
  if (filters.category) {
    conditions.push("category = ?");
    params.push(filters.category);
  }
  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.entityType) {
    conditions.push("entity_type = ?");
    params.push(filters.entityType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit || 50;
  const offset = ((filters.page || 1) - 1) * limit;

  const total = (
    sqlite.prepare(`SELECT COUNT(*) as cnt FROM audit_findings ${where}`).get(...params) as any
  ).cnt;

  const findings = sqlite
    .prepare(
      `SELECT * FROM audit_findings ${where} ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        id DESC
      LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return { findings, total };
}

export function updateFindingStatus(id: number, status: string): boolean {
  const result = sqlite
    .prepare(`UPDATE audit_findings SET status = ? WHERE id = ?`)
    .run(status, id);
  return result.changes > 0;
}

export function getAuditStats(): any {
  const run = getLatestAuditRun();
  if (!run) return null;

  const counts = sqlite
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN severity='high' THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN severity='medium' THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN severity='low' THEN 1 ELSE 0 END) as low,
        SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved_count
      FROM audit_findings WHERE audit_run_id = ?`
    )
    .get(run.id) as any;

  return { run, counts };
}

export function getFindingCountsByRun(runId: number) {
  return sqlite
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN severity='high' THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN severity='medium' THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN severity='low' THEN 1 ELSE 0 END) as low
      FROM audit_findings WHERE audit_run_id = ?`
    )
    .get(runId) as any;
}
