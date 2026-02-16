import {
  createAuditRun,
  updateAuditProgress,
  completeAuditRun,
  failAuditRun,
  insertFindings,
  getFindingCountsByRun,
} from "./scanStore";
import { analyzeWithGemini, isGeminiConfigured } from "./geminiClient";
import { createEmptyContext } from "./types";
import type { AuditContext } from "./types";

import { runHealthScan } from "./scanners/healthScanner";
import { runStructuralScan } from "./scanners/structuralScanner";
import { runContentScan } from "./scanners/contentScanner";
import { runReferenceScan } from "./scanners/referenceScanner";
import { runAiLawScan } from "./scanners/aiLawScanner";
import { runAiJudgmentScan } from "./scanners/aiJudgmentScanner";

let currentRunId: number | null = null;

export function isAuditRunning(): boolean {
  return currentRunId !== null;
}

export async function startAudit(): Promise<number> {
  if (currentRunId !== null) {
    throw new Error("مراجعة قيد التشغيل بالفعل");
  }

  const runId = createAuditRun();
  currentRunId = runId;

  // Run async — don't block
  runAuditPipeline(runId).catch((err) => {
    console.error("Audit pipeline error:", err);
    failAuditRun(runId, err.message || "Unknown error");
    currentRunId = null;
  });

  return runId;
}

async function runAuditPipeline(runId: number) {
  const context = createEmptyContext();

  try {
    // ========== Step 1: Health Check (5%) ==========
    updateAuditProgress(runId, 2, "فحص صحة النظام...");
    console.log("[Audit] Step 1: Health scan");
    const healthResult = await runHealthScan(context);
    const healthInserted = insertFindings(runId, healthResult.findings);
    updateProgress(runId, 5, "اكتمل فحص الصحة", healthResult.itemsScanned, context);
    console.log(`[Audit] Health: ${healthResult.findings.length} findings`);

    // ========== Step 2: Structural Scan (30%) ==========
    updateAuditProgress(runId, 6, "فحص بنية الأنظمة...");
    console.log("[Audit] Step 2: Structural scan");
    const structResult = await runStructuralScan(context);
    insertFindings(runId, structResult.findings);
    updateProgress(runId, 30, "اكتمل فحص البنية", structResult.itemsScanned, context);
    console.log(`[Audit] Structural: ${structResult.findings.length} findings from ${structResult.itemsScanned} laws`);

    // ========== Step 3: Content Scan (50%) ==========
    updateAuditProgress(runId, 31, "فحص محتوى الأحكام...");
    console.log("[Audit] Step 3: Content scan");
    const contentResult = await runContentScan(context);
    insertFindings(runId, contentResult.findings);
    updateProgress(runId, 50, "اكتمل فحص المحتوى", undefined, context, contentResult.itemsScanned);
    console.log(`[Audit] Content: ${contentResult.findings.length} findings from ${contentResult.itemsScanned} judgments`);

    // ========== Step 4: Reference Scan (60%) ==========
    updateAuditProgress(runId, 51, "فحص الإحالات المرجعية...");
    console.log("[Audit] Step 4: Reference scan");
    const refResult = await runReferenceScan(context);
    insertFindings(runId, refResult.findings);
    updateProgress(runId, 60, "اكتمل فحص الإحالات", refResult.itemsScanned, context);
    console.log(`[Audit] References: ${refResult.findings.length} findings from ${refResult.itemsScanned} laws`);

    // ========== Step 5: AI Law Scan (80%) ==========
    updateAuditProgress(runId, 61, "تحليل ذكي للأنظمة بـ Gemini...");
    console.log("[Audit] Step 5: AI Law scan");
    const aiLawResult = await runAiLawScan(context);
    insertFindings(runId, aiLawResult.findings);
    updateProgress(runId, 80, "اكتمل التحليل الذكي للأنظمة", aiLawResult.itemsScanned, context);
    console.log(`[Audit] AI Law: ${aiLawResult.findings.length} findings from ${aiLawResult.itemsScanned} laws`);

    // ========== Step 6: AI Judgment Scan (95%) ==========
    updateAuditProgress(runId, 81, "تحليل ذكي للأحكام بـ Gemini...");
    console.log("[Audit] Step 6: AI Judgment scan");
    const aiJudgResult = await runAiJudgmentScan(context);
    insertFindings(runId, aiJudgResult.findings);
    updateProgress(runId, 95, "اكتمل التحليل الذكي للأحكام", undefined, context, aiJudgResult.itemsScanned);
    console.log(`[Audit] AI Judgment: ${aiJudgResult.findings.length} findings from ${aiJudgResult.itemsScanned} judgments`);

    // ========== Step 7: Generate Summary (100%) ==========
    updateAuditProgress(runId, 96, "إنشاء التقرير النهائي...");
    console.log("[Audit] Step 7: Generating summary");
    const summary = await generateSummary(runId, context);

    // Complete
    completeAuditRun(runId, summary, context);
    console.log("[Audit] Completed successfully!");
  } catch (error: any) {
    console.error("[Audit] Pipeline error:", error);
    failAuditRun(runId, error.message || "Unknown error");
  } finally {
    currentRunId = null;
  }
}

function updateProgress(
  runId: number,
  pct: number,
  step: string,
  lawsScanned?: number,
  context?: AuditContext,
  judgmentsScanned?: number
) {
  const counts = getFindingCountsByRun(runId);
  updateAuditProgress(runId, pct, step, {
    totalLaws: lawsScanned,
    totalJudgments: judgmentsScanned,
    totalFindings: counts.total,
    critical: counts.critical,
    high: counts.high,
    medium: counts.medium,
    low: counts.low,
  });
}

async function generateSummary(runId: number, context: AuditContext): Promise<string> {
  const counts = getFindingCountsByRun(runId);

  // Build a basic summary even without AI
  const basicSummary = `تمت المراجعة الشاملة. النتائج: ${counts.total} مشكلة (${counts.critical} حرجة، ${counts.high} عالية، ${counts.medium} متوسطة، ${counts.low} منخفضة).`;

  if (!isGeminiConfigured()) {
    return basicSummary;
  }

  try {
    const prompt = `أنت خبير قانوني يكتب تقريراً تنفيذياً لمراجعة شاملة لمنصة قانونية.

## بيانات المراجعة:
- إجمالي المشاكل: ${counts.total}
- حرجة: ${counts.critical}، عالية: ${counts.high}، متوسطة: ${counts.medium}، منخفضة: ${counts.low}

## إحصائيات المصادر:
${JSON.stringify(context.lawSourceStats, null, 2)}

## إحصائيات الأحكام:
${JSON.stringify(context.judgmentSourceStats, null, 2)}

## أنماط OCR مكتشفة:
${context.commonOcrPatterns.join("، ") || "لا يوجد"}

## أنماط مكتشفة بالذكاء الاصطناعي:
${context.aiDiscoveredPatterns.join("، ") || "لا يوجد"}

## أنظمة بإحالات مكسورة:
${context.brokenReferencesByLaw.length} نظام

اكتب ملخصاً تنفيذياً بالعربية (3-5 فقرات) يشمل:
1. نظرة عامة على نتائج المراجعة
2. أبرز المشاكل المكتشفة وأولويتها
3. المصادر الأكثر مشاكل
4. توصيات للإصلاح قبل الإطلاق

أجب بنص عربي فقط (بدون JSON).`;

    const response = await analyzeWithGemini(prompt);
    // Gemini might wrap in JSON, extract text
    try {
      const parsed = JSON.parse(response);
      return typeof parsed === "string" ? parsed : basicSummary;
    } catch {
      return response || basicSummary;
    }
  } catch (e: any) {
    console.error("[Audit] Summary generation error:", e.message);
    return basicSummary;
  }
}
