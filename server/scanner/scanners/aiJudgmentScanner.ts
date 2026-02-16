import { sqlite } from "../../db";
import { analyzeWithGemini, isGeminiConfigured } from "../geminiClient";
import type { ScanFinding, ScanResult, AuditContext } from "../types";

const MAX_JUDGMENTS = 1000;
const BATCH_SIZE = 10; // judgments per API call
const MAX_TEXT_PER_JUDGMENT = 1500; // chars

interface GeminiJudgmentIssue {
  severity: "critical" | "high" | "medium" | "low";
  code: string;
  message: string;
}

interface GeminiJudgmentResult {
  judgment_id: string;
  quality_score: number;
  is_truncated: boolean;
  is_readable: boolean;
  issues: GeminiJudgmentIssue[];
}

function buildJudgmentPrompt(
  judgments: Array<{ id: string; text: string; source: string; court: string }>,
  context: AuditContext
): string {
  let contextInfo = "";

  if (context.commonOcrPatterns.length > 0) {
    contextInfo += `\nأنماط OCR شائعة مكتشفة: ${context.commonOcrPatterns.join("، ")}.\n`;
  }

  if (context.judgmentSourceStats) {
    const problemSources = Object.entries(context.judgmentSourceStats)
      .filter(([, s]) => s.withIssues > s.total * 0.1)
      .map(([k, s]) => `${k}: ${Math.round((s.withIssues / s.total) * 100)}% فيها مشاكل`);
    if (problemSources.length > 0) {
      contextInfo += `\nمصادر ذات نسبة مشاكل عالية: ${problemSources.join("، ")}.\n`;
    }
  }

  if (context.aiDiscoveredPatterns.length > 0) {
    contextInfo += `\nأنماط مكتشفة من فحص الأنظمة: ${context.aiDiscoveredPatterns.join("، ")}. ابحث عنها هنا أيضاً.\n`;
  }

  return `أنت خبير قانوني ومدقق جودة لأحكام قضائية سعودية ومصرية على منصة "تشريع".
مهمتك فحص نصوص الأحكام التالية واكتشاف المشاكل التقنية.
${contextInfo}
## أنواع المشاكل:
1. OCR_GARBLED — نص مشوه غير مقروء (كلمات مكسورة)
2. TRUNCATED_TEXT — نص مبتور ينتهي فجأة
3. MISSING_SECTIONS — أقسام مفقودة (الوقائع/الأسباب/المنطوق)
4. ENCODING_ERROR — مشاكل ترميز أحرف
5. DUPLICATE_CONTENT — نص مكرر داخلياً (copy-paste)
6. INCOHERENT — نص غير مترابط

## التعليمات:
- quality_score: 5=ممتاز، 4=جيد، 3=مقبول، 2=سيئ، 1=غير مقروء
- is_truncated: هل النص يبدو مبتوراً؟
- is_readable: هل النص مقروء ومفهوم؟
- كن دقيقاً ولا تبالغ في الإبلاغ

أجب بـ JSON array فقط:

الأحكام:
${judgments.map((j, i) => `\n=== [${i + 1}] الحكم ${j.id} (${j.source}/${j.court}) ===\n${j.text}`).join("\n")}`;
}

export async function runAiJudgmentScan(context: AuditContext): Promise<ScanResult> {
  if (!isGeminiConfigured()) {
    return {
      category: "ai_judgment",
      itemsScanned: 0,
      findings: [{
        severity: "medium",
        code: "AI_NOT_CONFIGURED",
        category: "ai_judgment",
        entityType: "judgment",
        entityId: "system",
        message: "مفتاح GEMINI_API_KEY غير مُعد — تم تخطي الفحص الذكي للأحكام",
      }],
    };
  }

  const findings: ScanFinding[] = [];
  let itemsScanned = 0;

  // Prioritize sources with more issues
  const sources = sqlite.prepare("SELECT DISTINCT source FROM judgments").all() as any[];
  const prioritizedSources = sources.sort((a: any, b: any) => {
    const aIssues = context.judgmentSourceStats[a.source]?.withIssues || 0;
    const bIssues = context.judgmentSourceStats[b.source]?.withIssues || 0;
    return bIssues - aIssues; // most issues first
  });

  const perSourceLimit = Math.ceil(MAX_JUDGMENTS / sources.length);
  const batch: Array<{ id: string; text: string; source: string; court: string }> = [];

  for (const { source } of prioritizedSources) {
    // Sample from this source
    const judgments = sqlite
      .prepare(
        `SELECT id, text, source, court_body, case_id FROM judgments
        WHERE source = ? AND length(text) > 50
        ORDER BY RANDOM() LIMIT ?`
      )
      .all(source, perSourceLimit) as any[];

    for (const j of judgments) {
      if (itemsScanned >= MAX_JUDGMENTS) break;
      itemsScanned++;

      batch.push({
        id: String(j.id),
        text: (j.text || "").slice(0, MAX_TEXT_PER_JUDGMENT),
        source: j.source,
        court: j.court_body || "",
      });

      if (batch.length >= BATCH_SIZE) {
        const batchNum = Math.ceil(itemsScanned / BATCH_SIZE);
        const totalBatches = Math.ceil(MAX_JUDGMENTS / BATCH_SIZE);
        console.log(`[Audit] AI Judgment batch ${batchNum}/${totalBatches} — processing ${batch.length} judgments (${itemsScanned}/${MAX_JUDGMENTS} scanned)`);
        const batchFindings = await processBatch(batch, context);
        findings.push(...batchFindings);
        console.log(`[Audit] AI Judgment batch ${batchNum} done — ${batchFindings.length} new findings (total: ${findings.length})`);
        batch.length = 0;
        await new Promise((r) => setTimeout(r, 2000)); // rate limit
      }
    }
  }

  // Process remaining
  if (batch.length > 0) {
    const batchFindings = await processBatch(batch, context);
    findings.push(...batchFindings);
  }

  return { category: "ai_judgment", itemsScanned, findings };
}

async function processBatch(
  judgments: Array<{ id: string; text: string; source: string; court: string }>,
  context: AuditContext
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];

  try {
    const prompt = buildJudgmentPrompt(judgments, context);
    const responseText = await analyzeWithGemini(prompt);
    let results: GeminiJudgmentResult[];

    try {
      results = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0]);
      } else {
        return findings;
      }
    }

    if (!Array.isArray(results)) return findings;

    for (const result of results) {
      const j = judgments.find((jj) => jj.id === result.judgment_id);
      if (!j) continue;

      if (Array.isArray(result.issues)) {
        for (const issue of result.issues) {
          findings.push({
            severity: issue.severity || "medium",
            code: issue.code || "AI_DETECTED",
            category: "ai_judgment",
            entityType: "judgment",
            entityId: j.id,
            entityName: `${j.court || j.source} — ${j.id}`,
            message: issue.message || "مشكلة مكتشفة بالذكاء الاصطناعي",
            details: {
              quality_score: result.quality_score,
              is_truncated: result.is_truncated,
              is_readable: result.is_readable,
            },
          });

          // Learn new patterns
          if (issue.code === "OCR_GARBLED" && issue.message) {
            const pattern = issue.message.slice(0, 50);
            if (!context.aiDiscoveredPatterns.includes(pattern)) {
              context.aiDiscoveredPatterns.push(pattern);
            }
          }
        }
      }

      // Low quality score without explicit issues
      if (result.quality_score <= 2 && (!result.issues || result.issues.length === 0)) {
        findings.push({
          severity: "medium",
          code: "LOW_QUALITY",
          category: "ai_judgment",
          entityType: "judgment",
          entityId: j.id,
          entityName: `${j.court || j.source} — ${j.id}`,
          message: `جودة النص منخفضة (${result.quality_score}/5)`,
          details: { quality_score: result.quality_score },
        });
      }
    }
  } catch (e: any) {
    findings.push({
      severity: "low",
      code: "AI_ERROR",
      category: "ai_judgment",
      entityType: "judgment",
      entityId: judgments[0]?.id || "unknown",
      message: `خطأ في تحليل Gemini: ${e.message?.slice(0, 100)}`,
    });
  }

  return findings;
}
