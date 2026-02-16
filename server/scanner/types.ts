export type ScanCategory = 'structural' | 'content' | 'reference' | 'health' | 'ai_law' | 'ai_judgment';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type EntityType = 'law' | 'judgment' | 'endpoint' | 'index';
export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'wont_fix';

export interface ScanFinding {
  severity: FindingSeverity;
  code: string;
  category: ScanCategory;
  entityType: EntityType;
  entityId: string;
  entityName?: string;
  message: string;
  location?: string;
  details?: Record<string, unknown>;
}

export interface ScanResult {
  category: ScanCategory;
  itemsScanned: number;
  findings: ScanFinding[];
}

export interface AuditContext {
  lawSourceStats: Record<string, { total: number; withIssues: number }>;
  commonOcrPatterns: string[];
  brokenReferencesByLaw: string[];
  judgmentSourceStats: Record<string, { total: number; withIssues: number }>;
  aiDiscoveredPatterns: string[];
}

export function createEmptyContext(): AuditContext {
  return {
    lawSourceStats: {},
    commonOcrPatterns: [],
    brokenReferencesByLaw: [],
    judgmentSourceStats: {},
    aiDiscoveredPatterns: [],
  };
}
