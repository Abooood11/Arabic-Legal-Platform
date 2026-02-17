/**
 * AI-powered document structure reparser
 *
 * Reads non-law documents (decisions, regulations, gazette) and uses AI
 * to correctly identify:
 * - Markers (أولاً: / 1- / أ-) embedded in text
 * - Contextual nesting levels (level depends on context, not marker type)
 * - Section types (preamble / operative / closing)
 *
 * Multi-model fallback: Gemini → DeepSeek → Qwen (via Groq)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

// ── Configuration ──────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LAWS_DIR = path.join(__dirname, "../client/public/data/laws");
const LIBRARY_PATH = path.join(__dirname, "../client/public/data/library.json");

const BATCH_SIZE = 1; // 1 document per API call for accuracy
const INTER_REQUEST_DELAY_MS = 2000;
const MAX_RETRIES = 2;

// Stats
let totalProcessed = 0;
let totalSuccess = 0;
let totalFailed = 0;
let totalSkipped = 0;

// ── AI Model Clients ───────────────────────────────────────────────────

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

function getDeepSeekClient(): OpenAI | null {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key, baseURL: "https://api.deepseek.com" });
}

function getGroqClient(): OpenAI | null {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key, baseURL: "https://api.groq.com/openai/v1" });
}

// ── The Legal Structure Prompt ─────────────────────────────────────────

function buildPrompt(docText: string, lawName: string): string {
  return `أنت خبير متخصص في تحليل بنية الوثائق القانونية السعودية (قرارات، مراسيم ملكية، تعاميم، لوائح تنفيذية).

## مهمتك:
حلل النص القانوني التالي وأعد هيكلته بدقة.

## بنية الوثيقة القانونية السعودية:
1. **الديباجة (preamble)**: البسملة، "بعون الله"، "إنّ مجلس..."، "بناءً على المادة..."، "وبعد الاطلاع على..."
2. **صيغة الإقرار**: "رسمنا بما هو آت:"، "يُقرر ما يلي:"، "أمر بما هو آت:"
3. **المنطوق (operative)**: البنود والأحكام الفعلية بعد صيغة الإقرار
4. **الخاتمة (closing)**: "والله الموفق"، "يُبلَّغ..."، التوقيع، التاريخ

## قاعدة المستويات (حرجة جداً):
- المستوى يُحدد من **السياق** وليس من نوع المؤشر!
- المؤشر الأول في القسم = level 0
- بند فرعي تحت بند آخر = level أعلى
- أمثلة:
  * "أولاً:" ثم "1-" تحته → أولاً level 0, 1- level 1
  * "1-" ثم "أ-" تحته → 1- level 0, أ- level 1
  * "أ-" مباشرة بدون parent → أ- level 0
  * "(1)" ثم "(أ)" تحته → (1) level 0, (أ) level 1

## أنواع المؤشرات المعروفة:
- ترتيبية: أولاً:، ثانياً:، ثالثاً:، ... حادي عشر، ثاني عشر
- رقمية: 1-، 2-، ٣-، (1)، (2)، 1/، 2/
- حرفية: أ-، ب-، ج-، (أ)، (ب)، أ/، ب/
- فرعية: (أولاً)، (ثانياً)

## المطلوب:
لكل فقرة في النص، أعد JSON array بالشكل:

[
  {
    "marker": "المؤشر المستخرج من بداية النص (مثل 'أولاً:' أو '1-' أو '') — إذا لا يوجد مؤشر اتركه فارغاً",
    "text": "النص بعد إزالة المؤشر",
    "level": 0,
    "section_type": "preamble"
  }
]

**قواعد:**
- إذا بدأت الفقرة بمؤشر، استخرجه في marker والنص المتبقي في text
- إذا لم تبدأ بمؤشر، marker = "" والنص كاملاً في text
- section_type: "preamble" للديباجة والسند النظامي، "operative" للبنود بعد صيغة الإقرار، "closing" للخاتمة
- لا تدمج فقرات ولا تفصلها — حافظ على نفس عدد الفقرات الأصلية وترتيبها

## عنوان الوثيقة: ${lawName}

## نص الوثيقة (كل سطر = فقرة مستقلة):
${docText}

أعد فقط JSON array بدون أي نص إضافي.`;
}

// ── AI Call with Multi-Model Fallback ──────────────────────────────────

async function callAI(prompt: string): Promise<string> {
  // Try Gemini first
  const gemini = getGeminiClient();
  if (gemini) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await gemini.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        });
        const text = response.text || "";
        if (text.trim()) return text;
      } catch (e: any) {
        console.error(`  [Gemini] Attempt ${attempt + 1} failed: ${(e.message || "").slice(0, 100)}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
        }
      }
    }
  }

  // Try DeepSeek
  const deepseek = getDeepSeekClient();
  if (deepseek) {
    try {
      console.log("  [Fallback] Trying DeepSeek...");
      const response = await deepseek.chat.completions.create({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" },
      });
      const text = response.choices[0]?.message?.content || "";
      if (text.trim()) return text;
    } catch (e: any) {
      console.error(`  [DeepSeek] Failed: ${(e.message || "").slice(0, 100)}`);
    }
  }

  // Try Groq (Qwen)
  const groq = getGroqClient();
  if (groq) {
    try {
      console.log("  [Fallback] Trying Groq/Qwen...");
      const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" },
      });
      const text = response.choices[0]?.message?.content || "";
      if (text.trim()) return text;
    } catch (e: any) {
      console.error(`  [Groq] Failed: ${(e.message || "").slice(0, 100)}`);
    }
  }

  throw new Error("All AI models failed");
}

// ── Parse AI Response ──────────────────────────────────────────────────

interface ParsedParagraph {
  marker: string;
  text: string;
  level: number;
  section_type: "preamble" | "operative" | "closing";
}

function parseResponse(responseText: string): ParsedParagraph[] | null {
  try {
    const parsed = JSON.parse(responseText);
    // Response might be { paragraphs: [...] } or just [...]
    const arr = Array.isArray(parsed) ? parsed : (parsed.paragraphs || parsed.result || parsed.data);
    if (!Array.isArray(arr)) return null;
    return arr.map((p: any) => ({
      marker: (p.marker || "").trim(),
      text: (p.text || "").trim(),
      level: typeof p.level === "number" ? p.level : 0,
      section_type: ["preamble", "operative", "closing"].includes(p.section_type) ? p.section_type : "operative",
    }));
  } catch {
    // Try to extract JSON array from response
    const match = responseText.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr)) {
          return arr.map((p: any) => ({
            marker: (p.marker || "").trim(),
            text: (p.text || "").trim(),
            level: typeof p.level === "number" ? p.level : 0,
            section_type: ["preamble", "operative", "closing"].includes(p.section_type) ? p.section_type : "operative",
          }));
        }
      } catch {}
    }
    return null;
  }
}

// ── Process a Single Document ──────────────────────────────────────────

async function processDocument(docId: string, lawName: string): Promise<boolean> {
  // Find the file
  let filePath = "";
  for (const suffix of [`${docId}_uqn.json`, `${docId}_boe.json`, `${docId}.json`]) {
    const p = path.join(LAWS_DIR, suffix);
    if (fs.existsSync(p)) {
      filePath = p;
      break;
    }
  }
  if (!filePath) {
    console.log(`  SKIP: File not found for ${docId}`);
    totalSkipped++;
    return false;
  }

  // Read the file
  const raw = fs.readFileSync(filePath, "utf-8");
  const doc = JSON.parse(raw);

  if (!doc.articles || doc.articles.length === 0) {
    console.log(`  SKIP: No articles in ${docId}`);
    totalSkipped++;
    return false;
  }

  // Build flat list of all paragraph texts (preserving original index mapping)
  const flatParagraphs: { articleIdx: number; paraIdx: number; originalText: string }[] = [];

  for (let aIdx = 0; aIdx < doc.articles.length; aIdx++) {
    const article = doc.articles[aIdx];
    if (article.paragraphs && article.paragraphs.length > 0) {
      for (let pIdx = 0; pIdx < article.paragraphs.length; pIdx++) {
        const text = (article.paragraphs[pIdx].text || "").trim();
        if (text) {
          flatParagraphs.push({ articleIdx: aIdx, paraIdx: pIdx, originalText: text });
        }
      }
    } else if (article.text) {
      // Article with no paragraphs — treat the full text as one paragraph
      flatParagraphs.push({ articleIdx: aIdx, paraIdx: -1, originalText: article.text.trim() });
    }
  }

  if (flatParagraphs.length === 0) {
    console.log(`  SKIP: No text in ${docId}`);
    totalSkipped++;
    return false;
  }

  // Build document text for prompt (numbered lines)
  const docText = flatParagraphs.map((p, i) => `[${i}] ${p.originalText}`).join("\n");

  // Limit text size (max ~6000 chars to stay within token limits)
  const truncatedText = docText.length > 6000 ? docText.slice(0, 6000) + "\n[... بقية النص محذوف للاختصار]" : docText;

  const prompt = buildPrompt(truncatedText, lawName);

  // Call AI
  const responseText = await callAI(prompt);
  const parsed = parseResponse(responseText);

  if (!parsed || parsed.length === 0) {
    console.log(`  FAIL: Could not parse AI response for ${docId}`);
    totalFailed++;
    return false;
  }

  // Apply parsed results back to the document
  // Match by index — AI returns same number of paragraphs in order
  const minLen = Math.min(parsed.length, flatParagraphs.length);

  for (let i = 0; i < minLen; i++) {
    const { articleIdx, paraIdx } = flatParagraphs[i];
    const aiResult = parsed[i];

    if (paraIdx >= 0 && doc.articles[articleIdx].paragraphs) {
      // Update paragraph
      doc.articles[articleIdx].paragraphs[paraIdx].marker = aiResult.marker;
      doc.articles[articleIdx].paragraphs[paraIdx].text = aiResult.text;
      doc.articles[articleIdx].paragraphs[paraIdx].level = aiResult.level;
      doc.articles[articleIdx].paragraphs[paraIdx].section_type = aiResult.section_type;
    } else if (paraIdx === -1) {
      // Article with no paragraphs — create paragraphs array
      doc.articles[articleIdx].paragraphs = [{
        marker: aiResult.marker,
        text: aiResult.text,
        level: aiResult.level,
        section_type: aiResult.section_type,
      }];
    }
  }

  // Add reparse metadata
  doc._reparse_metadata = {
    reparsed_at: new Date().toISOString(),
    model: "gemini-2.5-flash",
    version: "1.0",
    paragraphs_processed: minLen,
  };

  // Write back
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), "utf-8");
  totalSuccess++;
  return true;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("=== AI Document Structure Reparser ===");
  console.log(`Gemini: ${process.env.GEMINI_API_KEY ? "configured" : "NOT configured"}`);
  console.log(`DeepSeek: ${process.env.DEEPSEEK_API_KEY ? "configured" : "NOT configured"}`);
  console.log(`Groq: ${process.env.GROQ_API_KEY ? "configured" : "NOT configured"}`);

  if (!process.env.GEMINI_API_KEY && !process.env.DEEPSEEK_API_KEY && !process.env.GROQ_API_KEY) {
    console.error("ERROR: No AI API key configured. Set GEMINI_API_KEY, DEEPSEEK_API_KEY, or GROQ_API_KEY");
    process.exit(1);
  }

  // Load library and filter non-law documents
  const library = JSON.parse(fs.readFileSync(LIBRARY_PATH, "utf-8"));
  const nonLawDocs = library.filter((entry: any) => entry.category && entry.category !== "law");

  console.log(`\nTotal documents: ${library.length}`);
  console.log(`Non-law documents to process: ${nonLawDocs.length}`);

  // Check for --limit flag
  const limitArg = process.argv.find(a => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1]) : nonLawDocs.length;

  // Check for --offset flag
  const offsetArg = process.argv.find(a => a.startsWith("--offset="));
  const offset = offsetArg ? parseInt(offsetArg.split("=")[1]) : 0;

  // Check for --category flag
  const catArg = process.argv.find(a => a.startsWith("--category="));
  const categoryFilter = catArg ? catArg.split("=")[1] : null;

  let docsToProcess = nonLawDocs;
  if (categoryFilter) {
    docsToProcess = docsToProcess.filter((d: any) => d.category === categoryFilter);
    console.log(`Filtered to category '${categoryFilter}': ${docsToProcess.length} documents`);
  }

  docsToProcess = docsToProcess.slice(offset, offset + limit);
  console.log(`Processing ${docsToProcess.length} documents (offset=${offset}, limit=${limit})\n`);

  const startTime = Date.now();

  for (let i = 0; i < docsToProcess.length; i++) {
    const entry = docsToProcess[i];
    totalProcessed++;

    const pct = ((i + 1) / docsToProcess.length * 100).toFixed(1);
    console.log(`[${pct}%] (${i + 1}/${docsToProcess.length}) ${entry.category}: ${entry.id}`);

    try {
      await processDocument(entry.id, entry.title_ar || entry.id);
    } catch (e: any) {
      console.error(`  ERROR: ${(e.message || "").slice(0, 200)}`);
      totalFailed++;
    }

    // Rate limiting
    if (i < docsToProcess.length - 1) {
      await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log("\n=== RESULTS ===");
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Success: ${totalSuccess}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Time: ${elapsed} minutes`);
}

main().catch(console.error);
