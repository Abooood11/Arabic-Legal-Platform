import fs from "fs";
import path from "path";
import { analyzeWithGemini, isGeminiConfigured } from "../geminiClient";
import type { ScanFinding, ScanResult, AuditContext } from "../types";

const MAX_LAWS = 200;
const BATCH_SIZE = 5; // laws per API call
const MAX_TEXT_PER_LAW = 3000; // chars

interface GeminiLawIssue {
  article_number: number;
  severity: "critical" | "high" | "medium" | "low";
  code: string;
  message: string;
}

interface GeminiLawResult {
  law_id: string;
  quality_score: number;
  issues: GeminiLawIssue[];
}

function buildLawPrompt(laws: Array<{ id: string; name: string; text: string }>, context: AuditContext): string {
  let contextInfo = "";

  // Add learning context from previous scanners
  if (context.lawSourceStats && Object.keys(context.lawSourceStats).length > 0) {
    const problematicSources = Object.entries(context.lawSourceStats)
      .filter(([, s]) => s.withIssues > 0)
      .map(([k, s]) => `${k}: ${s.withIssues}/${s.total} فيها مشاكل`);
    if (problematicSources.length > 0) {
      contextInfo += `\nملاحظة: المصادر التالية فيها مشاكل بنيوية: ${problematicSources.join("، ")}. ركز على جودة نصوصها.\n`;
    }
  }

  if (context.brokenReferencesByLaw.length > 0) {
    contextInfo += `\nملاحظة: بعض الأنظمة فيها إحالات مكسورة — تحقق من سلامة السياق حولها.\n`;
  }

  if (context.aiDiscoveredPatterns.length > 0) {
    contextInfo += `\nأنماط OCR مكتشفة سابقاً: ${context.aiDiscoveredPatterns.join("، ")}. ابحث عنها أيضاً.\n`;
  }

  return `أنت خبير قانوني سعودي ومدقق جودة لمنصة "تشريع" القانونية.
مهمتك فحص نصوص الأنظمة التالية واكتشاف أي مشاكل تقنية أو تنسيقية.
${contextInfo}
## أنواع المشاكل التي تبحث عنها:
1. TRUNCATED_TEXT — نص مادة يبدو مبتوراً أو غير مكتمل
2. OCR_GARBLED — نص مشوه من التحويل الضوئي (كلمات غير مفهومة)
3. MISSING_CONTENT — مادة يبدو أنها تفتقد محتوى جوهري
4. FORMAT_ERROR — مشاكل تنسيق (ترقيم خاطئ، فقرات مدمجة)
5. ENCODING_ERROR — مشاكل ترميز (أحرف غريبة، رموز مكسورة)
6. INCOHERENT_TEXT — نص غير مترابط أو غير منطقي

## التعليمات:
- لا تبحث عن تعارض قانوني بين النصوص
- ركز فقط على المشاكل التقنية والتنسيقية
- كن دقيقاً — لا تبلغ عن مشاكل غير حقيقية
- quality_score: 5=ممتاز، 4=جيد، 3=مقبول، 2=سيئ، 1=مشوه

أجب بـ JSON array:
${JSON.stringify(laws.map(l => ({ law_id: l.id, quality_score: 5, issues: [] })), null, 0)}

النصوص:
${laws.map((l, i) => `\n=== [${i + 1}] ${l.name} (${l.id}) ===\n${l.text}`).join("\n")}`;
}

export async function runAiLawScan(context: AuditContext): Promise<ScanResult> {
  if (!isGeminiConfigured()) {
    return {
      category: "ai_law",
      itemsScanned: 0,
      findings: [{
        severity: "medium",
        code: "AI_NOT_CONFIGURED",
        category: "ai_law",
        entityType: "law",
        entityId: "system",
        message: "مفتاح GEMINI_API_KEY غير مُعد — تم تخطي الفحص الذكي للأنظمة",
      }],
    };
  }

  const findings: ScanFinding[] = [];
  let itemsScanned = 0;

  const libraryPath = path.join(process.cwd(), "client", "public", "data", "library.json");
  const lawsDir = path.join(process.cwd(), "client", "public", "data", "laws");

  if (!fs.existsSync(libraryPath)) {
    return { category: "ai_law", itemsScanned: 0, findings };
  }

  const library: any[] = JSON.parse(fs.readFileSync(libraryPath, "utf-8"));

  // Prioritize: laws with broken references first, then laws from problematic sources
  const prioritized = [...library].sort((a, b) => {
    const aHasRef = context.brokenReferencesByLaw.includes(a.id) ? 0 : 1;
    const bHasRef = context.brokenReferencesByLaw.includes(b.id) ? 0 : 1;
    return aHasRef - bHasRef;
  });

  const lawBatch: Array<{ id: string; name: string; text: string }> = [];

  for (const item of prioritized) {
    if (itemsScanned >= MAX_LAWS) break;

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
    if (!lawData || !Array.isArray(lawData.articles) || lawData.articles.length === 0) continue;

    // Collect article texts (truncated to fit)
    const articleTexts = lawData.articles
      .filter((a: any) => a.text && a.text.trim())
      .map((a: any) => `المادة ${a.number}: ${a.text.slice(0, 500)}`)
      .join("\n");

    if (articleTexts.length < 50) continue;

    lawBatch.push({
      id: item.id,
      name: lawData.law_name || item.title_ar || item.id,
      text: articleTexts.slice(0, MAX_TEXT_PER_LAW),
    });
    itemsScanned++;

    // Process batch
    if (lawBatch.length >= BATCH_SIZE) {
      const batchFindings = await processBatch(lawBatch, context);
      findings.push(...batchFindings);
      lawBatch.length = 0;

      // Rate limit: wait 2 seconds between batches
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Process remaining
  if (lawBatch.length > 0) {
    const batchFindings = await processBatch(lawBatch, context);
    findings.push(...batchFindings);
  }

  return { category: "ai_law", itemsScanned, findings };
}

async function processBatch(
  laws: Array<{ id: string; name: string; text: string }>,
  context: AuditContext
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];

  try {
    const prompt = buildLawPrompt(laws, context);
    const responseText = await analyzeWithGemini(prompt);
    let results: GeminiLawResult[];

    try {
      results = JSON.parse(responseText);
    } catch {
      // Try to extract JSON array from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0]);
      } else {
        return findings;
      }
    }

    if (!Array.isArray(results)) return findings;

    for (const result of results) {
      const law = laws.find((l) => l.id === result.law_id);
      if (!law) continue;

      if (Array.isArray(result.issues)) {
        for (const issue of result.issues) {
          findings.push({
            severity: issue.severity || "medium",
            code: issue.code || "AI_DETECTED",
            category: "ai_law",
            entityType: "law",
            entityId: law.id,
            entityName: law.name,
            message: issue.message || "مشكلة مكتشفة بالذكاء الاصطناعي",
            location: issue.article_number ? `المادة ${issue.article_number}` : undefined,
            details: { quality_score: result.quality_score },
          });

          // Learn new OCR patterns from AI discoveries
          if (issue.code === "OCR_GARBLED" && issue.message) {
            const pattern = issue.message.slice(0, 50);
            if (!context.aiDiscoveredPatterns.includes(pattern)) {
              context.aiDiscoveredPatterns.push(pattern);
            }
          }
        }
      }
    }
  } catch (e: any) {
    findings.push({
      severity: "low",
      code: "AI_ERROR",
      category: "ai_law",
      entityType: "law",
      entityId: laws[0]?.id || "unknown",
      message: `خطأ في تحليل Gemini: ${e.message?.slice(0, 100)}`,
    });
  }

  return findings;
}
