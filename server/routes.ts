import type { Express, RequestHandler } from "express";
import type { Server } from "http";
import fs from "fs/promises";
import path from "path";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { registerAuthRoutes, isAuthenticated, isAdmin, setupAuthSchema } from "./authSystem";
import { db, sqlite } from "./db";
import { articleOverrides, errorReports, judgments, gazetteIndex, crsdPrinciples, crsdDecisions } from "@shared/schema";
import { eq, and, desc, sql, like } from "drizzle-orm";
import { readLatestLegalMonitoringReport, runLegalMonitoringScan } from "./legalMonitoring";
import { setupAnalyticsSchema, recordAnalyticsEvent } from "./analytics";
import { buildLegalFtsQuery, buildLiteralFtsQuery } from "./searchUtils";
import { arabicNormalizerMiddleware } from "./arabicTextNormalizer";

const saudiGazetteCategoryCaseSql = (alias: string) => `
  CASE
    WHEN COALESCE(${alias}.category, '') LIKE '%مرسوم ملكي%' THEN 'مراسيم ملكية'
    WHEN COALESCE(${alias}.category, '') LIKE '%أمر ملكي%' OR COALESCE(${alias}.category, '') LIKE '%أمر سام%' THEN 'أوامر ملكية وسامية'
    WHEN COALESCE(${alias}.category, '') LIKE '%قرار مجلس الوزراء%' THEN 'قرارات مجلس الوزراء'
    WHEN COALESCE(${alias}.category, '') IN ('نظام', 'نظام أساسي', 'قانون')
      OR ${alias}.title LIKE '%نظام %'
      OR ${alias}.title LIKE 'نظام%'
      THEN 'أنظمة'
    WHEN COALESCE(${alias}.category, '') LIKE '%لائحة%'
      OR ${alias}.title LIKE '%اللائحة%'
      OR ${alias}.title LIKE '%لائحة%'
      THEN 'لوائح تنفيذية وتنظيمية'
    WHEN (
      COALESCE(${alias}.category, '') IN ('إعلان', 'بلاغ', 'بيان', 'تنويه', 'إشعار')
      OR ${alias}.title LIKE '%إعلان%'
      OR ${alias}.title LIKE '%بلاغ%'
      OR ${alias}.title LIKE '%تنويه%'
    )
      AND (
        ${alias}.title LIKE '%شركة%'
        OR ${alias}.title LIKE '%شركاء%'
        OR ${alias}.title LIKE '%مساهمة%'
        OR ${alias}.title LIKE '%ذات مسؤولية محدودة%'
      )
      THEN 'إعلانات الشركات'
    WHEN COALESCE(${alias}.category, '') = 'عقد تأسيس'
      OR ${alias}.title LIKE '%عقد تأسيس%'
      OR ${alias}.title LIKE '%تأسيس شركة%'
      THEN 'الشركات والكيانات التجارية'
    WHEN COALESCE(${alias}.category, '') IN ('اتفاقية', 'ميثاق', 'مذكرة')
      OR ${alias}.title LIKE '%اتفاقية%'
      OR ${alias}.title LIKE '%مذكرة تفاهم%'
      OR ${alias}.title LIKE '%بروتوكول%'
      THEN 'اتفاقيات ومعاهدات'
    WHEN COALESCE(${alias}.category, '') LIKE '%قرار%'
      OR ${alias}.title LIKE 'قرار %'
      THEN 'قرارات تنظيمية'
    WHEN COALESCE(${alias}.category, '') IN ('تعليمات', 'قواعد', 'ضوابط', 'آلية')
      OR ${alias}.title LIKE '%قواعد%'
      OR ${alias}.title LIKE '%ضوابط%'
      OR ${alias}.title LIKE '%تعليمات%'
      THEN 'قواعد وضوابط'
    WHEN COALESCE(${alias}.category, '') IN ('بيان', 'إعلان', 'بلاغ', 'تنويه', 'تعميم', 'خبر', 'إشعار')
      OR ${alias}.title LIKE '%إعلان%'
      OR ${alias}.title LIKE '%بيان%'
      OR ${alias}.title LIKE '%بلاغ%'
      THEN 'إعلانات وبيانات رسمية'
    WHEN COALESCE(${alias}.category, '') LIKE '%مواصفات قياسية%'
      OR ${alias}.title LIKE '%مواصفات%'
      THEN 'مواصفات ومعايير'
    ELSE 'وثائق رسمية أخرى'
  END
`;

function buildGazetteIssuePdfUrl(issueNumber?: string | null): string | null {
  const normalized = String(issueNumber || "").trim();
  if (!normalized) return null;
  // Link directly to NCAR (المركز الوطني للوثائق والمحفوظات) Umm Al-Qura page
  return `https://ncar.gov.sa/um-elqura?issue=${encodeURIComponent(normalized)}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  setupAuthSchema();
  setupAnalyticsSchema();
  registerAuthRoutes(app);

  // Arabic text normalizer: auto-corrects OCR/extraction typos in legal text responses
  // Applied to law, judgment, and gazette endpoints
  const normalizeArabic = arabicNormalizerMiddleware();
  app.use("/api/laws", normalizeArabic);
  app.use("/api/judgments", normalizeArabic);
  app.use("/api/gazette", normalizeArabic);
  app.use("/api/decisions", normalizeArabic);
  app.use("/api/search", normalizeArabic);


  app.post("/api/analytics/track", (req, res) => {
    try {
      recordAnalyticsEvent(req, req.body);
      res.json({ success: true });
    } catch (error) {
      console.error("Analytics track error:", error);
      res.status(500).json({ message: "Failed to track analytics" });
    }
  });


  app.get("/api/admin/dashboard", isAuthenticated, isAdmin, async (req, res) => {
    const tableExists = (name: string) => {
      const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as any;
      return !!row;
    };

    let pendingErrorReports = 0;
    try {
      pendingErrorReports = tableExists("error_reports")
        ? Number((sqlite.prepare("SELECT COUNT(*) as count FROM error_reports WHERE status = 'pending'").get() as any)?.count || 0)
        : 0;
    } catch {
      pendingErrorReports = 0;
    }

    const overview = sqlite.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users) as usersTotal,
        (SELECT COUNT(*) FROM app_users WHERE role = 'admin') as adminsTotal,
        (SELECT COUNT(*) FROM app_users WHERE subscription_status = 'active') as activeSubscriptions,
        (SELECT COUNT(*) FROM analytics_sessions WHERE is_bot = 0) as visitsTotal,
        (SELECT COUNT(DISTINCT visitor_id) FROM analytics_sessions WHERE is_bot = 0 AND datetime(started_at) >= datetime('now', '-6 days')) as uniqueVisitors7d,
        (SELECT COALESCE(AVG(duration_seconds), 0) FROM analytics_sessions WHERE is_bot = 0 AND duration_seconds > 0 AND duration_seconds <= 7200) as avgSessionDurationSec
    `).get() as any;

    const tiers = sqlite.prepare(`
      SELECT subscription_tier as tier, COUNT(*) as count
      FROM app_users
      GROUP BY subscription_tier
      ORDER BY count DESC
    `).all() as any[];

    const logRows = sqlite.prepare(`
      SELECT strftime('%Y-%m-%d', created_at) as day,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success,
             SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
      FROM login_audit_logs
      WHERE datetime(created_at) >= datetime('now', '-6 days')
      GROUP BY strftime('%Y-%m-%d', created_at)
      ORDER BY day ASC
    `).all() as any[];

    const topEntryPages = sqlite.prepare(`
      SELECT entry_page as label, COUNT(*) as count
      FROM analytics_sessions
      WHERE is_bot = 0 AND entry_page IS NOT NULL AND entry_page != ''
      GROUP BY entry_page
      ORDER BY count DESC
      LIMIT 6
    `).all() as any[];

    const topSources = sqlite.prepare(`
      SELECT entry_source as label, COUNT(*) as count
      FROM analytics_sessions
      WHERE is_bot = 0 AND entry_source IS NOT NULL AND entry_source != ''
      GROUP BY entry_source
      ORDER BY count DESC
      LIMIT 6
    `).all() as any[];

    const countries = sqlite.prepare(`
      SELECT country_code as label, COUNT(*) as count
      FROM analytics_sessions
      WHERE is_bot = 0 AND country_code IS NOT NULL AND country_code != ''
      GROUP BY country_code
      ORDER BY count DESC
      LIMIT 8
    `).all() as any[];

    const ages = sqlite.prepare(`
      SELECT age_range as label, COUNT(*) as count
      FROM analytics_sessions
      WHERE is_bot = 0 AND age_range IS NOT NULL AND age_range != ''
      GROUP BY age_range
      ORDER BY count DESC
      LIMIT 8
    `).all() as any[];

    const map = new Map<string, { day: string; success: number; failed: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const day = d.toISOString().slice(0, 10);
      map.set(day, { day, success: 0, failed: 0 });
    }
    for (const row of logRows) {
      if (map.has(row.day)) {
        map.set(row.day, {
          day: row.day,
          success: Number(row.success || 0),
          failed: Number(row.failed || 0),
        });
      }
    }

    const legalReport = await readLatestLegalMonitoringReport();
    const legalMonitoringFindings = Number(legalReport?.counts?.total || 0);

    res.json({
      overview: {
        ...overview,
        pendingErrorReports,
        legalMonitoringFindings,
      },
      subscriptionsByTier: tiers.map((t) => ({ tier: t.tier || "free", count: Number(t.count || 0) })),
      loginActivity7d: Array.from(map.values()),
      topEntryPages: topEntryPages.map((i) => ({ label: i.label, count: Number(i.count || 0) })),
      topSources: topSources.map((i) => ({ label: i.label, count: Number(i.count || 0) })),
      countries: countries.map((i) => ({ label: i.label, count: Number(i.count || 0) })),
      ageRanges: ages.map((i) => ({ label: i.label, count: Number(i.count || 0) })),
    });
  });

  app.get("/api/admin/users", isAuthenticated, isAdmin, (req, res) => {
    const users = sqlite.prepare(`
      SELECT u.id, u.email, u.first_name as firstName, u.last_name as lastName,
             a.role, a.status, a.mfa_enabled as mfaEnabled,
             a.subscription_tier as subscriptionTier, a.subscription_status as subscriptionStatus,
             a.subscription_expires_at as subscriptionExpiresAt, a.last_login_at as lastLoginAt
      FROM users u
      JOIN app_users a ON a.user_id = u.id
      ORDER BY u.created_at DESC
      LIMIT 200
    `).all();
    res.json({ users });
  });

  app.patch("/api/admin/users/:id/subscription", isAuthenticated, isAdmin, (req, res) => {
    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const tier = String(req.body?.tier || "free");
    const status = String(req.body?.status || "inactive");
    const expiresAt = req.body?.expiresAt ? String(req.body.expiresAt) : null;
    sqlite.prepare(`
      UPDATE app_users
      SET subscription_tier = ?, subscription_status = ?, subscription_expires_at = ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(tier, status, expiresAt, userId);
    res.json({ success: true });
  });

  // ============================================
  // Extraction Debugging API
  // ============================================
  app.get("/api/admin/extraction-debug", isAuthenticated, isAdmin, async (_req: any, res: any) => {
    try {
      const lawsDir = path.join(process.cwd(), "client", "public", "data", "laws");
      const libraryData = await storage.getLibrary();

      // Only check laws referenced in library (not all 3900+ files)
      const lawIds: string[] = [];
      for (const item of libraryData) {
        if (item.laws_included && item.laws_included.length > 0) {
          lawIds.push(...item.laws_included);
        } else {
          lawIds.push(item.id);
        }
      }
      const uniqueIds = [...new Set(lawIds)];

      type Result = {
        id: string; fileName: string; title: string;
        totalArticles: number | null; actualArticles: number;
        hasEmptyArticles: number; hasPreamble: boolean;
        hasRoyalDecree: boolean; hasCabinetDecision: boolean;
        missingText: number; duplicateNumbers: number[];
        issues: string[];
      };

      const analyzeLaw = async (id: string): Promise<Result> => {
        const suffixes = ["", "_boe", "_uqn"];
        for (const suffix of suffixes) {
          const fileName = `${id}${suffix}.json`;
          try {
            const raw = await fs.readFile(path.join(lawsDir, fileName), "utf-8");
            const law = JSON.parse(raw);
            const articles = law.articles || [];
            const libEntry = libraryData.find((l: any) => l.id === id);
            const issues: string[] = [];

            const missingText = articles.filter((a: any) => !a.text || a.text.trim().length === 0).length;
            const nums = articles.map((a: any) => a.number);
            const seen = new Set<number>();
            const dupes: number[] = [];
            for (const n of nums) { if (seen.has(n)) dupes.push(n); seen.add(n); }

            if (law.total_articles && law.total_articles !== articles.length)
              issues.push(`عدد المواد المعلن (${law.total_articles}) لا يطابق الفعلي (${articles.length})`);
            if (missingText > 0) issues.push(`${missingText} مادة بدون نص`);
            if (dupes.length > 0) issues.push(`أرقام مواد مكررة: ${dupes.join(", ")}`);
            if (!law.law_name) issues.push("اسم النظام مفقود");
            if (articles.length === 0) issues.push("لا توجد مواد");

            return {
              id, fileName,
              title: law.law_name || libEntry?.title_ar || "بدون عنوان",
              totalArticles: law.total_articles || null,
              actualArticles: articles.length,
              hasEmptyArticles: missingText,
              hasPreamble: !!(law.preamble || law.preamble_text),
              hasRoyalDecree: !!law.royal_decree,
              hasCabinetDecision: !!(law.cabinet_decision || law.cabinet_decision_text),
              missingText, duplicateNumbers: dupes, issues,
            };
          } catch { continue; }
        }
        return {
          id, fileName: `${id}.json`,
          title: libraryData.find((l: any) => l.id === id)?.title_ar || "ملف مفقود",
          totalArticles: null, actualArticles: 0, hasEmptyArticles: 0,
          hasPreamble: false, hasRoyalDecree: false, hasCabinetDecision: false,
          missingText: 0, duplicateNumbers: [],
          issues: ["ملف القانون غير موجود"],
        };
      };

      // Process in parallel batches of 20
      const results: Result[] = [];
      for (let i = 0; i < uniqueIds.length; i += 20) {
        const batch = uniqueIds.slice(i, i + 20);
        const batchResults = await Promise.all(batch.map(analyzeLaw));
        results.push(...batchResults);
      }

      const withIssues = results.filter((r) => r.issues.length > 0);
      res.json({
        summary: {
          totalLaws: results.length,
          healthyLaws: results.length - withIssues.length,
          lawsWithIssues: withIssues.length,
          totalIssues: withIssues.reduce((s, r) => s + r.issues.length, 0),
        },
        laws: results.sort((a, b) => b.issues.length - a.issues.length),
      });
    } catch (err: any) {
      console.error("[extraction-debug] error:", err);
      res.status(500).json({ message: err.message || "Extraction debug failed" });
    }
  });

  app.get(api.sources.list.path, async (req, res) => {
    const sources = await storage.getSources();
    res.set("Cache-Control", "public, max-age=600");
    res.json(sources);
  });

  app.get(api.library.list.path, async (req, res) => {
    const library = await storage.getLibrary();
    // Cache library for 10 minutes in browser (data changes rarely)
    res.set("Cache-Control", "public, max-age=600");
    res.json(library);
  });

  app.get(api.laws.get.path, async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const law = await storage.getLaw(id);
    if (!law) {
      return res.status(404).json({ message: "Law not found" });
    }
    // In development, don't cache; in production cache for 1 hour
    const isDev = (process.env.NODE_ENV || '').trim() === 'development';
    res.set("Cache-Control", isDev ? "no-cache" : "public, max-age=3600");
    res.json(law);
  });

  // ============================================
  // Unified Search API - with Intent Detection & Smart Query Building
  // ============================================

  // Arabic legal synonyms for query expansion (comprehensive legal thesaurus)
  const ARABIC_SYNONYMS: Record<string, string[]> = {
    "عقد": ["عقود", "تعاقد", "اتفاقية", "اتفاق", "التزام"],
    "زواج": ["نكاح", "زوجة", "زوج", "أسرة", "أحوال شخصية"],
    "طلاق": ["فسخ", "خلع", "تفريق", "عدة"],
    "بيع": ["شراء", "مبيع", "ثمن", "تجارة", "بائع", "مشتري"],
    "إيجار": ["استئجار", "مؤجر", "مستأجر", "إجارة", "أجرة"],
    "عمل": ["عامل", "عمالة", "وظيفة", "موظف", "خدمة", "صاحب عمل"],
    "شركة": ["شركات", "مساهمة", "شريك", "حصة", "تجارية"],
    "جريمة": ["جرائم", "جنائي", "عقوبة", "جزاء", "جناية", "جنحة"],
    "ملكية": ["ملك", "تملك", "عقار", "عقارات", "حيازة"],
    "تعويض": ["ضرر", "أضرار", "مسؤولية", "تبعة", "تضمين"],
    "حقوق": ["حق", "حقوقي", "إنسان"],
    "قاضي": ["قضاء", "محكمة", "دعوى", "حكم", "قضائي"],
    "نفقة": ["إنفاق", "معيشة", "حضانة", "إعالة"],
    "ميراث": ["إرث", "وراثة", "تركة", "ورثة", "فريضة"],
    "تحكيم": ["محكم", "تسوية", "نزاع", "منازعات", "وساطة"],
    "إفلاس": ["تصفية", "ديون", "دائن", "مدين", "إعسار"],
    "ضريبة": ["ضرائب", "زكاة", "رسوم", "جمارك", "جبائي"],
    "استئناف": ["طعن", "نقض", "اعتراض", "تمييز", "مراجعة"],
    "كفالة": ["ضمان", "كفيل", "ضامن", "رهن", "تأمين"],
    "وكالة": ["وكيل", "توكيل", "تفويض", "نيابة", "إنابة"],
    "تنفيذ": ["تنفيذي", "إنفاذ", "سند تنفيذي", "محضر"],
    "تزوير": ["تزييف", "مزور", "احتيال", "غش"],
    "مخدرات": ["مؤثرات عقلية", "مسكرات", "ترويج"],
    "سرقة": ["نهب", "اختلاس", "سارق"],
    "قتل": ["جناية قتل", "دية", "قصاص"],
    "مرور": ["حادث", "سير", "مركبة", "رخصة قيادة"],
    "بيئة": ["تلوث", "بيئي", "حماية البيئة"],
    "تجارة": ["تاجر", "سجل تجاري", "علامة تجارية"],
    "بنك": ["مصرف", "بنوك", "مصرفي", "ائتمان"],
    "تأمين": ["تأمينات", "وثيقة تأمين", "قسط"],
    "إقامة": ["تأشيرة", "جواز", "هجرة", "وافد"],
    "براءة اختراع": ["ملكية فكرية", "حقوق المؤلف", "اختراع"],
  };

  // Legal concepts mapping - maps broad legal domains to specific terms
  const LEGAL_CONCEPTS: Record<string, { terms: string[]; types: ("laws" | "judgments" | "gazette")[] }> = {
    "أحوال شخصية": { terms: ["زواج", "طلاق", "نفقة", "حضانة", "ميراث", "وصية", "نسب", "ولاية"], types: ["laws", "judgments"] },
    "تجاري": { terms: ["شركة", "تجارة", "إفلاس", "أوراق تجارية", "سجل تجاري"], types: ["laws", "judgments", "gazette"] },
    "عقاري": { terms: ["ملكية", "عقار", "رهن", "إيجار", "تسجيل عيني"], types: ["laws", "judgments"] },
    "جزائي": { terms: ["جريمة", "عقوبة", "جناية", "جنحة", "سجن", "غرامة"], types: ["laws", "judgments"] },
    "عمالي": { terms: ["عمل", "عامل", "فصل", "أجر", "إجازة", "تعويض"], types: ["laws", "judgments"] },
    "إداري": { terms: ["قرار إداري", "جهة إدارية", "موظف", "ترخيص", "تظلم"], types: ["laws", "judgments", "gazette"] },
  };

  // Saudi cities list for intent detection
  const SAUDI_CITIES = ["الرياض", "جدة", "مكة", "المدينة", "الدمام", "الخبر", "تبوك", "أبها", "جازان", "نجران", "حائل", "بريدة", "الطائف", "ينبع", "القصيم", "الجوف", "عرعر"];

  // Detect user search intent
  interface SearchIntent {
    type: "all" | "laws" | "judgments" | "gazette";
    priority: ("laws" | "judgments" | "gazette")[];
    expandedTerms: string[];
    articleNumber: number | null;
    isLawName: boolean;
    cityHint: string | null;
  }

  function detectSearchIntent(query: string): SearchIntent {
    const q = query.trim();
    const words = q.split(/\s+/);
    const parsed = parseAdvancedQuery(q);

    let type: SearchIntent["type"] = "all";
    let priority: SearchIntent["priority"] = ["laws", "judgments", "gazette"];
    let articleNumber: number | null = null;
    let isLawName = false;
    let cityHint: string | null = null;
    const expandedTerms: string[] = [];

    // --- Field-based intent detection ---
    if (parsed.fields["محكمة"] || parsed.fields["مدينة"]) {
      priority = ["judgments", "laws", "gazette"];
      if (parsed.fields["مدينة"]) cityHint = parsed.fields["مدينة"];
    }
    if (parsed.fields["مادة"]) {
      articleNumber = parseInt(parsed.fields["مادة"]);
      priority = ["laws", "gazette", "judgments"];
    }
    if (parsed.fields["فئة"]) {
      priority = ["gazette", "laws", "judgments"];
    }

    // Detect article number patterns: "مادة 5", "المادة الخامسة", "م5"
    const articleMatch = q.match(/(?:المادة|مادة|م)\s*(\d+)/);
    if (articleMatch) {
      articleNumber = parseInt(articleMatch[1]);
      priority = ["laws", "gazette", "judgments"];
    }

    // Detect if query looks like a law name: starts with "نظام" or "لائحة" or "قرار"
    if (q.startsWith("نظام") || q.startsWith("لائحة") || q.startsWith("قرار") || q.startsWith("مرسوم")) {
      isLawName = true;
      priority = ["laws", "gazette", "judgments"];
    }

    // Detect city → prioritize judgments
    for (const city of SAUDI_CITIES) {
      if (q.includes(city)) {
        cityHint = city;
        priority = ["judgments", "laws", "gazette"];
        break;
      }
    }

    // Detect court-related terms → prioritize judgments
    if (q.includes("محكمة") || q.includes("دعوى") || q.includes("حكم") || q.includes("قاضي") || q.includes("دائرة")) {
      priority = ["judgments", "laws", "gazette"];
    }

    // Detect gazette-related terms
    if (q.includes("جريدة") || q.includes("أم القرى") || q.includes("عدد") || q.includes("مرسوم ملكي")) {
      priority = ["gazette", "laws", "judgments"];
    }

    // --- Legal concept detection ---
    for (const [concept, config] of Object.entries(LEGAL_CONCEPTS)) {
      // Check if query matches a legal domain concept
      if (q.includes(concept) || config.terms.some(t => q.includes(t))) {
        // Add related terms from this legal concept
        expandedTerms.push(...config.terms.filter(t => !q.includes(t)));
        // Adjust priority based on concept's relevant types
        if (config.types[0] !== priority[0]) {
          priority = [...config.types, ...priority.filter(p => !config.types.includes(p))] as SearchIntent["priority"];
        }
        break; // Only use first matching concept
      }
    }

    // --- Expand query with synonyms ---
    for (const word of words) {
      const cleanWord = word.replace(/^ال/, ""); // Remove ال prefix for matching
      for (const [key, synonyms] of Object.entries(ARABIC_SYNONYMS)) {
        if (word === key || word === `ال${key}` || cleanWord === key) {
          expandedTerms.push(...synonyms.filter(s => !words.includes(s)));
          break;
        }
        // Also check if the word matches a synonym → add the key
        if (synonyms.includes(word) || synonyms.includes(cleanWord)) {
          expandedTerms.push(key);
          break;
        }
      }
    }

    return { type, priority, expandedTerms: Array.from(new Set(expandedTerms)).slice(0, 8), articleNumber, isLawName, cityHint };
  }

  // ============================================
  // Advanced Search Query Parser
  // Supports: "exact phrase", -exclude, field:value, boolean operators
  // ============================================
  interface ParsedQuery {
    phrases: string[];      // Exact phrases in quotes
    required: string[];     // Regular terms (AND)
    excluded: string[];     // Terms prefixed with -
    fields: Record<string, string>; // field:value pairs
    rawTerms: string[];     // All raw terms for FTS
  }

  function parseAdvancedQuery(raw: string): ParsedQuery {
    const phrases: string[] = [];
    const required: string[] = [];
    const excluded: string[] = [];
    const fields: Record<string, string> = {};

    // Extract quoted phrases first: "exact phrase"
    let remaining = raw;
    const phraseRegex = /"([^"]+)"/g;
    let match;
    while ((match = phraseRegex.exec(raw)) !== null) {
      phrases.push(match[1].trim());
      remaining = remaining.replace(match[0], " ");
    }
    // Also support Arabic quotes «exact phrase»
    const arabicQuoteRegex = /«([^»]+)»/g;
    while ((match = arabicQuoteRegex.exec(raw)) !== null) {
      phrases.push(match[1].trim());
      remaining = remaining.replace(match[0], " ");
    }

    // Parse remaining words
    const words = remaining.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      // Exclusion: -term
      if (word.startsWith("-") && word.length > 1) {
        excluded.push(word.slice(1));
        continue;
      }
      // Field search: field:value (e.g., محكمة:الرياض, سنة:1445)
      const fieldMatch = word.match(/^(محكمة|مدينة|سنة|نظام|فئة|مادة):(.+)/);
      if (fieldMatch) {
        fields[fieldMatch[1]] = fieldMatch[2];
        continue;
      }
      required.push(word);
    }

    return {
      phrases,
      required,
      excluded,
      fields,
      rawTerms: [...phrases.flatMap(p => p.split(/\s+/)), ...required],
    };
  }

  // Smart FTS query builder with synonym expansion + advanced operators
  function buildFtsQuery(raw: string, expandedTerms: string[] = []): string {
    const parsed = parseAdvancedQuery(raw);
    const parts: string[] = [];

    // Add required terms with prefix matching
    if (parsed.required.length > 0) {
      parts.push(parsed.required.map(w => `${w}*`).join(" "));
    }

    // Add exact phrases (no wildcard, wrapped in quotes for FTS5)
    for (const phrase of parsed.phrases) {
      parts.push(`"${phrase}"`);
    }

    // Build NOT clauses
    const notClauses = parsed.excluded.map(w => `NOT ${w}*`).join(" ");

    let mainQuery = parts.join(" ");
    if (notClauses) {
      mainQuery = `(${mainQuery}) ${notClauses}`;
    }

    // Synonym expansion removed for performance — OR queries blow up result sets
    // (e.g. "نظام الشركات" OR "شركة*" → 41K results instead of 5K, 5x slower)
    // Synonyms are still returned in intent.expandedTerms for UI suggestions
    return mainQuery || raw.trim().split(/\s+/).map(w => `${w}*`).join(" ");
  }

  // Prepared statements for search (faster than building each time)
  const searchLawsStmt = sqlite.prepare(`
    SELECT la.law_id, la.law_name, la.article_number, la.article_heading,
           snippet(law_articles_fts, 3, '【', '】', '...', 40) as textSnippet,
           bm25(law_articles_fts) as rank
    FROM law_articles la
    INNER JOIN law_articles_fts fts ON la.id = fts.rowid
    WHERE law_articles_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `);

  const countLawsStmt = sqlite.prepare(`
    SELECT count(*) as count
    FROM law_articles la
    INNER JOIN law_articles_fts fts ON la.id = fts.rowid
    WHERE law_articles_fts MATCH ?
  `);

  const searchJudgmentsStmt = sqlite.prepare(`
    SELECT j.id, j.case_id, j.year_hijri, j.city, j.court_body, j.judgment_date, j.source,
           snippet(judgments_fts, 0, '【', '】', '...', 40) as textSnippet,
           bm25(judgments_fts) as rank
    FROM judgments j
    INNER JOIN judgments_fts fts ON j.id = fts.rowid
    WHERE judgments_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `);

  const countJudgmentsStmt = sqlite.prepare(`
    SELECT count(*) as count
    FROM judgments j
    INNER JOIN judgments_fts fts ON j.id = fts.rowid
    WHERE judgments_fts MATCH ?
  `);

  const searchGazetteStmt = sqlite.prepare(`
    SELECT g.id, g.issue_year, g.issue_number, g.legislation_number, g.legislation_year, g.category,
           snippet(gazette_fts, 0, '【', '】', '...', 40) as titleSnippet,
           bm25(gazette_fts) as rank
    FROM gazette_index g
    INNER JOIN gazette_fts fts ON g.id = fts.rowid
    WHERE gazette_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `);

  const countGazetteStmt = sqlite.prepare(`
    SELECT count(*) as count
    FROM gazette_index g
    INNER JOIN gazette_fts fts ON g.id = fts.rowid
    WHERE gazette_fts MATCH ?
  `);

  // MOJ Tameems (تعاميم وزارة العدل) search statements
  let searchTameemsStmt: any = null;
  let countTameemsStmt: any = null;
  try {
    searchTameemsStmt = sqlite.prepare(`
      SELECT t.id, t.serial, t.tameem_number, t.tameem_date, t.subject, t.year_hijri,
             snippet(moj_tameems_fts, 2, '【', '】', '...', 40) as textSnippet,
             bm25(moj_tameems_fts) as rank
      FROM moj_tameems t
      INNER JOIN moj_tameems_fts fts ON t.id = fts.rowid
      WHERE moj_tameems_fts MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `);
    countTameemsStmt = sqlite.prepare(`
      SELECT count(*) as count
      FROM moj_tameems t
      INNER JOIN moj_tameems_fts fts ON t.id = fts.rowid
      WHERE moj_tameems_fts MATCH ?
    `);
  } catch {
    // Table may not exist yet
  }

  // CRSD Principles (المبادئ القضائية) search statements
  let searchCrsdStmt: any = null;
  let countCrsdStmt: any = null;
  try {
    searchCrsdStmt = sqlite.prepare(`
      SELECT p.id, p.section, p.section_ar, p.decision_numbers, p.source_ar,
             snippet(crsd_principles_fts, 0, '【', '】', '...', 40) as textSnippet,
             bm25(crsd_principles_fts) as rank
      FROM crsd_principles p
      INNER JOIN crsd_principles_fts fts ON p.id = fts.rowid
      WHERE crsd_principles_fts MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `);
    countCrsdStmt = sqlite.prepare(`
      SELECT count(*) as count
      FROM crsd_principles p
      INNER JOIN crsd_principles_fts fts ON p.id = fts.rowid
      WHERE crsd_principles_fts MATCH ?
    `);
  } catch {
    // Table may not exist yet
  }

  // CRSD Decisions (أحكام لجان منازعات الأوراق المالية) search statements
  let searchCrsdDecisionsStmt: any = null;
  let countCrsdDecisionsStmt: any = null;
  try {
    searchCrsdDecisionsStmt = sqlite.prepare(`
      SELECT d.id, d.decision_number, d.committee, d.committee_ar,
             d.case_type, d.case_type_ar, d.decision_date, d.year_hijri,
             d.pdf_url, d.page_count, d.auto_pass, d.needs_review,
             snippet(crsd_decisions_fts, 0, '【', '】', '...', 40) as textSnippet,
             bm25(crsd_decisions_fts) as rank
      FROM crsd_decisions d
      INNER JOIN crsd_decisions_fts fts ON d.id = fts.rowid
      WHERE crsd_decisions_fts MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `);
    countCrsdDecisionsStmt = sqlite.prepare(`
      SELECT count(*) as count
      FROM crsd_decisions d
      INNER JOIN crsd_decisions_fts fts ON d.id = fts.rowid
      WHERE crsd_decisions_fts MATCH ?
    `);
  } catch {
    // Table may not exist yet
  }

  app.get("/api/search", async (req, res) => {
    try {
      const startTime = Date.now();
      const q = (req.query.q as string || "").trim();
      const type = (req.query.type as string) || "all";
      const exact = req.query.exact as string;
      const saudiOnly = req.query.saudi_only === "true";
      const withFacets = req.query.facets === "true";
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const offset = (page - 1) * limit;

      if (q.length < 2) {
        return res.json({
          query: q,
          totalResults: 0,
          timeTaken: 0,
          intent: null,
          results: { laws: { items: [], total: 0 }, judgments: { items: [], total: 0 }, gazette: { items: [], total: 0 }, tameems: { items: [], total: 0 }, principles: { items: [], total: 0 }, decisions: { items: [], total: 0 } }
        });
      }

      // Detect user intent for smarter results
      const intent = detectSearchIntent(q);
      const effectiveType = type !== "all" ? type : intent.type;
      // Use literal FTS query for exact mode, otherwise smart query with synonym expansion
      const ftsQuery = exact === "true"
        ? buildLiteralFtsQuery(q)
        : buildFtsQuery(q, intent.expandedTerms);

      // Search all sources — fetch limit+1 rows to detect "has more" without COUNT(*)
      const searchWithEstimate = (stmt: any, ftsQ: string, lim: number, off: number) => {
        const items = stmt.all(ftsQ, lim + 1, off) as any[];
        const hasMore = items.length > lim;
        if (hasMore) items.pop();
        return { items, total: hasMore ? -1 : off + items.length };
      };

      const searchLaws = () => {
        if (type !== "all" && type !== "laws") return { items: [], total: 0 };
        try { return searchWithEstimate(searchLawsStmt, ftsQuery, limit, offset); }
        catch { return { items: [], total: 0 }; }
      };

      const searchJudgments = () => {
        if (type !== "all" && type !== "judgments") return { items: [], total: 0 };
        try {
          if (saudiOnly) {
            const saudiStmt = sqlite.prepare(`
              SELECT j.id, j.case_id, j.year_hijri, j.city, j.court_body, j.judgment_date, j.source,
                     snippet(judgments_fts, 0, '【', '】', '...', 40) as textSnippet,
                     bm25(judgments_fts) as rank
              FROM judgments j
              INNER JOIN judgments_fts fts ON j.id = fts.rowid
              WHERE judgments_fts MATCH ? AND j.source != 'eg_naqd'
              ORDER BY rank
              LIMIT ? OFFSET ?
            `);
            return searchWithEstimate(saudiStmt, ftsQuery, limit, offset);
          }
          return searchWithEstimate(searchJudgmentsStmt, ftsQuery, limit, offset);
        } catch { return { items: [], total: 0 }; }
      };

      const searchGazette = () => {
        if (type !== "all" && type !== "gazette") return { items: [], total: 0 };
        try { return searchWithEstimate(searchGazetteStmt, ftsQuery, limit, offset); }
        catch { return { items: [], total: 0 }; }
      };

      const searchTameems = () => {
        if (type !== "all" && type !== "tameems") return { items: [], total: 0 };
        if (!searchTameemsStmt) return { items: [], total: 0 };
        try { return searchWithEstimate(searchTameemsStmt, ftsQuery, limit, offset); }
        catch { return { items: [], total: 0 }; }
      };

      const searchPrinciples = () => {
        if (type !== "all" && type !== "principles") return { items: [], total: 0 };
        if (!searchCrsdStmt) return { items: [], total: 0 };
        try { return searchWithEstimate(searchCrsdStmt, ftsQuery, limit, offset); }
        catch { return { items: [], total: 0 }; }
      };

      const searchDecisions = () => {
        if (type !== "all" && type !== "decisions") return { items: [], total: 0 };
        if (!searchCrsdDecisionsStmt) return { items: [], total: 0 };
        try { return searchWithEstimate(searchCrsdDecisionsStmt, ftsQuery, limit, offset); }
        catch { return { items: [], total: 0 }; }
      };

      // Execute all searches (SQLite is sync so they run sequentially, but each is fast with FTS5)
      const lawResults = searchLaws();
      const judgmentResults = searchJudgments();
      const gazetteResults = searchGazette();
      const tameemsResults = searchTameems();
      const principlesResults = searchPrinciples();
      const decisionsResults = searchDecisions();

      const timeTaken = Date.now() - startTime;
      // total = -1 means "more than current page" (exact count skipped for performance)
      const allTotals = [lawResults.total, judgmentResults.total, gazetteResults.total, tameemsResults.total, principlesResults.total, decisionsResults.total];
      const hasUnknown = allTotals.some(t => t === -1);
      const totalResults = hasUnknown ? -1 : allTotals.reduce((a, b) => a + b, 0);

      // Cross-reference: find related content across types
      const crossLinks: { lawsToJudgments: string[]; lawsToGazette: string[]; relatedLaws: string[] } = { lawsToJudgments: [], lawsToGazette: [], relatedLaws: [] };
      if (type === "all" && lawResults.items.length > 0) {
        const lawNames = Array.from(new Set(lawResults.items.map((l: any) => l.law_name).filter(Boolean))).slice(0, 3);
        for (const name of lawNames) {
          if (judgmentResults.items.length > 0) crossLinks.lawsToJudgments.push(name as string);
          if (gazetteResults.items.length > 0) crossLinks.lawsToGazette.push(name as string);
        }
        // Extract unique law_ids for cross-law referencing
        const lawIds = Array.from(new Set(lawResults.items.map((l: any) => l.law_id))).slice(0, 5);
        crossLinks.relatedLaws = lawIds as string[];
      }

      // Build faceted counts for advanced filtering
      const facets: { years: {year: number, count: number}[], cities: {city: string, count: number}[], categories: {category: string, count: number}[] } = {
        years: [], cities: [], categories: []
      };

      // Facets are expensive (GROUP BY on FTS) — only compute when explicitly requested
      if (withFacets) {
        try {
          if (type === "all" || type === "judgments") {
            const yearFacets = sqlite.prepare(`
              SELECT j.year_hijri as year, count(*) as count
              FROM judgments j
              INNER JOIN judgments_fts fts ON j.id = fts.rowid
              WHERE judgments_fts MATCH ? AND j.year_hijri IS NOT NULL
              GROUP BY j.year_hijri ORDER BY count DESC LIMIT 10
            `).all(ftsQuery) as any[];
            facets.years = yearFacets;

            const cityFacets = sqlite.prepare(`
              SELECT j.city as city, count(*) as count
              FROM judgments j
              INNER JOIN judgments_fts fts ON j.id = fts.rowid
              WHERE judgments_fts MATCH ? AND j.city IS NOT NULL AND j.city != ''
              GROUP BY j.city ORDER BY count DESC LIMIT 10
            `).all(ftsQuery) as any[];
            facets.cities = cityFacets;
          }

          if (type === "all" || type === "gazette") {
            const catFacets = sqlite.prepare(`
              SELECT g.category as category, count(*) as count
              FROM gazette_index g
              INNER JOIN gazette_fts fts ON g.id = fts.rowid
              WHERE gazette_fts MATCH ? AND g.category IS NOT NULL AND g.category != ''
              GROUP BY g.category ORDER BY count DESC LIMIT 10
            `).all(ftsQuery) as any[];
            facets.categories = catFacets;
          }
        } catch {}
      }

      // Parse advanced query info for frontend display
      const parsedInfo = parseAdvancedQuery(q);

      // Log search to analytics (async, non-blocking)
      try {
        const normalized = q.trim().replace(/\s+/g, " ").toLowerCase();
        sqlite.prepare(`
          INSERT INTO search_logs (query, query_normalized, result_count, result_type, time_taken, has_results)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(q, normalized, totalResults === -1 ? 999 : totalResults, type, timeTaken, totalResults !== 0 ? 1 : 0);
      } catch {}

      res.set("Cache-Control", "public, max-age=300");
      res.json({
        query: q,
        totalResults,
        timeTaken,
        intent: {
          priority: intent.priority,
          expandedTerms: intent.expandedTerms,
          articleNumber: intent.articleNumber,
          isLawName: intent.isLawName,
          cityHint: intent.cityHint,
        },
        advanced: {
          phrases: parsedInfo.phrases,
          excluded: parsedInfo.excluded,
          fields: parsedInfo.fields,
          hasBooleanOps: parsedInfo.phrases.length > 0 || parsedInfo.excluded.length > 0 || Object.keys(parsedInfo.fields).length > 0,
        },
        facets,
        crossLinks,
        results: {
          laws: lawResults,
          judgments: judgmentResults,
          gazette: {
            ...gazetteResults,
            items: gazetteResults.items.map((item: any) => ({
              ...item,
              issuePdfUrl: buildGazetteIssuePdfUrl(item.issue_number),
            })),
          },
          tameems: tameemsResults,
          principles: principlesResults,
          decisions: decisionsResults,
        }
      });
    } catch (err: any) {
      console.error("Search error:", err);
      res.status(500).json({ error: "Search failed", message: err.message });
    }
  });

  // ============================================
  // Related Articles API - finds related content across types
  // ============================================
  app.get("/api/search/related", async (req, res) => {
    try {
      const lawId = req.query.lawId as string;
      const lawName = req.query.lawName as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);

      if (!lawName && !lawId) return res.json({ judgments: [], gazette: [] });

      const searchTerm = (lawName || "").split(/\s+/).slice(0, 4).map(w => `${w}*`).join(" ");

      let relatedJudgments: any[] = [];
      let relatedGazette: any[] = [];

      if (searchTerm) {
        try {
          relatedJudgments = sqlite.prepare(`
            SELECT j.id, j.court_body, j.city, j.year_hijri,
                   snippet(judgments_fts, 0, '【', '】', '...', 30) as textSnippet
            FROM judgments j
            INNER JOIN judgments_fts fts ON j.id = fts.rowid
            WHERE judgments_fts MATCH ?
            ORDER BY bm25(judgments_fts)
            LIMIT ?
          `).all(searchTerm, limit) as any[];
        } catch {}

        try {
          relatedGazette = sqlite.prepare(`
            SELECT g.id, g.issue_year, g.issue_number, g.category,
                   snippet(gazette_fts, 0, '【', '】', '...', 30) as titleSnippet
            FROM gazette_index g
            INNER JOIN gazette_fts fts ON g.id = fts.rowid
            WHERE gazette_fts MATCH ?
            ORDER BY bm25(gazette_fts)
            LIMIT ?
          `).all(searchTerm, limit) as any[];
        } catch {}
      }

      res.set("Cache-Control", "public, max-age=300");
      res.json({
        judgments: relatedJudgments,
        gazette: relatedGazette.map((item: any) => ({
          ...item,
          issuePdfUrl: buildGazetteIssuePdfUrl(item.issue_number),
        })),
      });
    } catch (err: any) {
      res.json({ judgments: [], gazette: [] });
    }
  });

  // ============================================
  // Search Statistics API
  // ============================================
  app.get("/api/search/stats", async (req, res) => {
    try {
      const lawCount = (sqlite.prepare("SELECT count(*) as cnt FROM law_articles").get() as any)?.cnt || 0;
      const judgmentCount = (sqlite.prepare("SELECT count(*) as cnt FROM judgments").get() as any)?.cnt || 0;
      const gazetteCount = (sqlite.prepare("SELECT count(*) as cnt FROM gazette_index").get() as any)?.cnt || 0;
      const lawNamesCount = (sqlite.prepare("SELECT count(DISTINCT law_id) as cnt FROM law_articles").get() as any)?.cnt || 0;
      let tameemsCount = 0;
      try { tameemsCount = (sqlite.prepare("SELECT count(*) as cnt FROM moj_tameems").get() as any)?.cnt || 0; } catch {}
      let principlesCount = 0;
      try { principlesCount = (sqlite.prepare("SELECT count(*) as cnt FROM crsd_principles").get() as any)?.cnt || 0; } catch {}

      res.set("Cache-Control", "public, max-age=3600");
      res.json({
        totalDocuments: lawCount + judgmentCount + gazetteCount + tameemsCount + principlesCount,
        laws: { articles: lawCount, laws: lawNamesCount },
        judgments: { total: judgmentCount },
        gazette: { total: gazetteCount },
        tameems: { total: tameemsCount },
        principles: { total: principlesCount },
      });
    } catch {
      res.json({ totalDocuments: 0, laws: { articles: 0, laws: 0 }, judgments: { total: 0 }, gazette: { total: 0 }, tameems: { total: 0 }, principles: { total: 0 } });
    }
  });

  // ============================================
  // MOJ Tameems (تعاميم وزارة العدل) API
  // ============================================
  app.get("/api/tameems", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = (page - 1) * limit;
      const subject = req.query.subject as string;
      const year = parseInt(req.query.year as string) || null;
      const q = (req.query.q as string || "").trim();

      // FTS search path
      const qClean = q.replace(/\u0640/g, ''); // Strip tatweel for Arabic search
      if (qClean.length >= 2 && searchTameemsStmt) {
        try {
          const ftsQuery = buildLegalFtsQuery(qClean);
          const conditions: string[] = [];
          const params: any[] = [];
          if (subject) { conditions.push('t.subject = ?'); params.push(subject); }
          if (year) { conditions.push('t.year_hijri = ?'); params.push(year); }
          const extraWhere = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

          const items = sqlite.prepare(`
            SELECT t.id, t.serial, t.tameem_number, t.tameem_date, t.subject, t.year_hijri,
                   snippet(moj_tameems_fts, 2, '【', '】', '...', 50) as textPreview,
                   bm25(moj_tameems_fts) as rank
            FROM moj_tameems t
            INNER JOIN moj_tameems_fts fts ON t.id = fts.rowid
            WHERE moj_tameems_fts MATCH ?${extraWhere}
            ORDER BY rank
            LIMIT ? OFFSET ?
          `).all(ftsQuery, ...params, limit, offset) as any[];

          const countResult = sqlite.prepare(`
            SELECT count(*) as c
            FROM moj_tameems t
            INNER JOIN moj_tameems_fts fts ON t.id = fts.rowid
            WHERE moj_tameems_fts MATCH ?${extraWhere}
          `).get(ftsQuery, ...params) as any;

          const subjects = sqlite.prepare(`
            SELECT subject, count(*) as count FROM moj_tameems GROUP BY subject ORDER BY count DESC
          `).all() as any[];

          res.set("Cache-Control", "public, max-age=300");
          return res.json({ items, total: countResult?.c || 0, page, limit, subjects });
        } catch {
          // Fall through to non-FTS path
        }
      }

      // Non-FTS path (browse/filter)
      let where = '';
      const params: any[] = [];
      const conditions: string[] = [];
      if (subject) { conditions.push('subject = ?'); params.push(subject); }
      if (year) { conditions.push('year_hijri = ?'); params.push(year); }
      if (q) {
        // Strip tatweel (ـ) for better Arabic search matching
        const qNorm = q.replace(/\u0640/g, '');
        conditions.push("(REPLACE(subject, 'ـ', '') LIKE ? OR REPLACE(text, 'ـ', '') LIKE ? OR tameem_number LIKE ?)");
        params.push(`%${qNorm}%`, `%${qNorm}%`, `%${q}%`);
      }
      if (conditions.length > 0) where = 'WHERE ' + conditions.join(' AND ');

      const total = (sqlite.prepare(`SELECT count(*) as c FROM moj_tameems ${where}`).get(...params) as any)?.c || 0;
      const items = sqlite.prepare(`
        SELECT id, serial, tameem_number, tameem_date, subject, year_hijri,
               substr(text, 1, 200) as textPreview
        FROM moj_tameems ${where}
        ORDER BY tameem_date DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as any[];

      const subjects = sqlite.prepare(`
        SELECT subject, count(*) as count FROM moj_tameems GROUP BY subject ORDER BY count DESC
      `).all() as any[];

      res.set("Cache-Control", "public, max-age=300");
      res.json({ items, total, page, limit, subjects });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tameems/:id", async (req, res) => {
    try {
      const tameem = sqlite.prepare(`
        SELECT * FROM moj_tameems WHERE id = ? OR serial = ?
      `).get(req.params.id, req.params.id) as any;

      if (!tameem) return res.status(404).json({ error: "تعميم غير موجود" });
      res.set("Cache-Control", "public, max-age=3600");
      res.json(tameem);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // Search Analytics APIs
  // ============================================

  // Track result clicks (called when user clicks a search result)
  app.post("/api/search/click", async (req, res) => {
    try {
      const { query, resultType, resultId, position } = req.body;
      if (!query || !resultType || !resultId) return res.status(400).json({ error: "Missing fields" });
      sqlite.prepare(`
        INSERT INTO search_clicks (query, result_type, result_id, result_position)
        VALUES (?, ?, ?, ?)
      `).run(query, resultType, String(resultId), position || 0);
      res.json({ ok: true });
    } catch {
      res.json({ ok: false });
    }
  });

  // Public trending endpoint is privacy-safe: returns curated legal topics only
  app.get("/api/search/trending", async (req, res) => {
    try {
      const safeTrending = [
        "نظام العمل",
        "العقود",
        "الإثبات",
        "الشركات",
        "التنفيذ",
        "الإيجار",
        "التعويض",
        "التحكيم",
      ].map((query, index) => ({ query, count: 8 - index }));

      res.set("Cache-Control", "public, max-age=300");
      res.json(safeTrending);
    } catch {
      res.json([]);
    }
  });

  // Failed searches (queries with zero results - what users couldn't find)
  app.get("/api/search/failed", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const failed = sqlite.prepare(`
        SELECT query_normalized as query, count(*) as count, MAX(created_at) as lastSearched
        FROM search_logs
        WHERE has_results = 0
          AND created_at >= datetime('now', '-' || ? || ' days')
          AND length(query_normalized) >= 2
        GROUP BY query_normalized
        ORDER BY count DESC
        LIMIT 50
      `).all(days) as any[];

      res.json(failed);
    } catch {
      res.json([]);
    }
  });

  // Search analytics dashboard (admin only)
  app.get("/api/search/analytics", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;

      // Total searches
      const totalSearches = (sqlite.prepare(`
        SELECT count(*) as cnt FROM search_logs WHERE created_at >= datetime('now', '-' || ? || ' days')
      `).get(days) as any)?.cnt || 0;

      // Unique queries
      const uniqueQueries = (sqlite.prepare(`
        SELECT count(DISTINCT query_normalized) as cnt FROM search_logs WHERE created_at >= datetime('now', '-' || ? || ' days')
      `).get(days) as any)?.cnt || 0;

      // Zero-result rate
      const zeroResults = (sqlite.prepare(`
        SELECT count(*) as cnt FROM search_logs WHERE has_results = 0 AND created_at >= datetime('now', '-' || ? || ' days')
      `).get(days) as any)?.cnt || 0;

      // Average response time
      const avgTime = (sqlite.prepare(`
        SELECT AVG(time_taken) as avg FROM search_logs WHERE created_at >= datetime('now', '-' || ? || ' days')
      `).get(days) as any)?.avg || 0;

      // Top queries
      const topQueries = sqlite.prepare(`
        SELECT query_normalized as query, count(*) as count,
               AVG(result_count) as avgResults,
               SUM(CASE WHEN has_results = 0 THEN 1 ELSE 0 END) as failCount
        FROM search_logs
        WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY query_normalized
        ORDER BY count DESC
        LIMIT 20
      `).all(days) as any[];

      // Top clicked results
      const topClicked = sqlite.prepare(`
        SELECT result_type, result_id, query, count(*) as clicks
        FROM search_clicks
        WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY result_type, result_id
        ORDER BY clicks DESC
        LIMIT 20
      `).all(days) as any[];

      // Searches per day trend
      const dailyTrend = sqlite.prepare(`
        SELECT date(created_at) as day, count(*) as searches,
               SUM(CASE WHEN has_results = 0 THEN 1 ELSE 0 END) as failed
        FROM search_logs
        WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY date(created_at)
        ORDER BY day DESC
      `).all(days) as any[];

      res.json({
        period: days,
        totalSearches,
        uniqueQueries,
        zeroResultRate: totalSearches > 0 ? Math.round((zeroResults / totalSearches) * 100) : 0,
        avgResponseTime: Math.round(avgTime),
        topQueries,
        topClicked,
        dailyTrend,
        failedSearchCount: zeroResults,
      });
    } catch (err: any) {
      console.error("Analytics error:", err);
      res.status(500).json({ error: "Failed to load analytics" });
    }
  });

  // Search suggestions API
  let suggestionsCache: { data: any[]; timestamp: number } | null = null;
  const SUGGESTIONS_CACHE_TTL = 3600000; // 1 hour

  app.get("/api/search/suggest", async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      if (q.length < 1) return res.json([]);

      // Build/refresh suggestions corpus (cached for 1 hour)
      if (!suggestionsCache || Date.now() - suggestionsCache.timestamp > SUGGESTIONS_CACHE_TTL) {
        const library = await storage.getLibrary();
        const lawTitles = library.map(item => ({ text: item.title_ar, type: "law" }));

        const courts = sqlite.prepare("SELECT DISTINCT court_body FROM judgments WHERE court_body IS NOT NULL AND court_body != ''").all() as any[];
        const courtSuggestions = courts.map(c => ({ text: c.court_body, type: "court" }));

        const categories = sqlite.prepare("SELECT DISTINCT category FROM gazette_index WHERE category IS NOT NULL AND category != ''").all() as any[];
        const categorySuggestions = categories.map(c => ({ text: c.category, type: "gazette_category" }));

        suggestionsCache = {
          data: [...lawTitles, ...courtSuggestions, ...categorySuggestions],
          timestamp: Date.now()
        };
      }

      // Filter suggestions matching the query
      const results = suggestionsCache.data
        .filter(item => item.text.includes(q))
        .slice(0, 8);

      res.set("Cache-Control", "public, max-age=3600");
      res.json(results);
    } catch (err: any) {
      console.error("Suggest error:", err);
      res.json([]);
    }
  });

  // Judgments API
  app.get("/api/judgments", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;
      const sort = (req.query.sort as string) || "date";

      const { q, city, year, court, hasDate, source, judge, exact } = req.query;

      // Include CRSD decisions (لجان منازعات الأوراق المالية) only under Saudi tab
      // Exclude when city or judge filter is active (CRSD has no geographic/judge data)
      const includeCrsd = source === "sa_all" && !city && !judge;

      // Use FTS5 for text search when q is provided
      if (q && typeof q === "string" && q.trim().length > 0) {
        try {
          // Build additional WHERE filters
          const filters: string[] = [];
          const params: any[] = [];

          if (city) { filters.push("j.city LIKE ?"); params.push(city); }
          if (year) { filters.push("j.year_hijri = ?"); params.push(parseInt(year as string)); }
          if (court) { filters.push("j.court_body LIKE ?"); params.push(`%${court}%`); }
          if (source === "sa_all") { filters.push("j.source IN ('sa_judicial', 'bog_judicial', 'moj_research')"); }
          else if (source) { filters.push("j.source = ?"); params.push(source); }
          if (hasDate === "true") { filters.push("j.judgment_date IS NOT NULL AND j.judgment_date != ''"); }
          if (judge) { filters.push("j.judges LIKE ?"); params.push(`%${judge}%`); }

          const filterSQL = filters.length > 0 ? "AND " + filters.join(" AND ") : "";

          // Sort
          let orderSQL = "ORDER BY j.judgment_date DESC";
          if (sort === "year") orderSQL = "ORDER BY j.year_hijri DESC";
          else if (sort === "city") orderSQL = "ORDER BY j.city";
          else if (sort === "court") orderSQL = "ORDER BY j.court_body";

          // Better Arabic search: use exact/literal search or legal synonym-expanded search
          const ftsQuery = exact === "true"
            ? buildLiteralFtsQuery(q)
            : buildLegalFtsQuery(q) || q.trim().split(/\s+/).map((w: string) => `${w}*`).join(" ");

          // Include CRSD decisions via UNION ALL when applicable
          if (includeCrsd) {
            const crsdFilters: string[] = [];
            const crsdParams: any[] = [];
            if (year) { crsdFilters.push("d.year_hijri = ?"); crsdParams.push(parseInt(year as string)); }
            if (court) { crsdFilters.push("d.committee_ar LIKE ?"); crsdParams.push(`%${court}%`); }
            if (hasDate === "true") { crsdFilters.push("d.decision_date IS NOT NULL AND d.decision_date != ''"); }
            const crsdFilterSQL = crsdFilters.length > 0 ? " AND " + crsdFilters.join(" AND ") : "";

            const countResult = sqlite.prepare(`
              SELECT (
                SELECT count(*) FROM judgments j
                INNER JOIN judgments_fts fts ON j.id = fts.rowid
                WHERE judgments_fts MATCH ? ${filterSQL}
              ) + (
                SELECT count(*) FROM crsd_decisions d
                INNER JOIN crsd_decisions_fts cfts ON d.id = cfts.rowid
                WHERE crsd_decisions_fts MATCH ?${crsdFilterSQL}
              ) as count
            `).get(ftsQuery, ...params, ftsQuery, ...crsdParams) as any;

            const results = sqlite.prepare(`
              SELECT * FROM (
                SELECT j.id, j.case_id as caseId, j.year_hijri as yearHijri, j.city,
                       j.court_body as courtBody, j.circuit_type as circuitType,
                       j.judgment_number as judgmentNumber, j.judgment_date as judgmentDate,
                       j.source, j.appeal_type as appealType,
                       snippet(judgments_fts, 0, '【', '】', '...', 40) as textSnippet,
                       bm25(judgments_fts) as rank
                FROM judgments j
                INNER JOIN judgments_fts fts ON j.id = fts.rowid
                WHERE judgments_fts MATCH ? ${filterSQL}
                UNION ALL
                SELECT d.id + 10000000 as id, 'crsd-' || d.id as caseId, d.year_hijri as yearHijri,
                       '' as city, d.committee_ar as courtBody,
                       COALESCE(d.case_type_ar, '') as circuitType,
                       CAST(d.decision_number AS TEXT) as judgmentNumber,
                       d.decision_date as judgmentDate,
                       'crsd' as source, NULL as appealType,
                       snippet(crsd_decisions_fts, 0, '【', '】', '...', 40) as textSnippet,
                       bm25(crsd_decisions_fts) as rank
                FROM crsd_decisions d
                INNER JOIN crsd_decisions_fts cfts ON d.id = cfts.rowid
                WHERE crsd_decisions_fts MATCH ?${crsdFilterSQL}
              ) combined
              ORDER BY rank
              LIMIT ? OFFSET ?
            `).all(ftsQuery, ...params, ftsQuery, ...crsdParams, limit, offset);

            return res.json({
              data: results,
              pagination: {
                page,
                limit,
                total: Number(countResult.count),
                totalPages: Math.ceil(Number(countResult.count) / limit),
              },
            });
          }

          // Standard FTS query (specific source or city/judge filter active)
          const countStmt = sqlite.prepare(`
            SELECT count(*) as count FROM judgments j
            INNER JOIN judgments_fts fts ON j.id = fts.rowid
            WHERE judgments_fts MATCH ? ${filterSQL}
          `);
          const countResult = countStmt.get(ftsQuery, ...params) as any;

          const dataStmt = sqlite.prepare(`
            SELECT j.id, j.case_id as caseId, j.year_hijri as yearHijri, j.city,
                   j.court_body as courtBody, j.circuit_type as circuitType,
                   j.judgment_number as judgmentNumber, j.judgment_date as judgmentDate,
                   j.source, j.appeal_type as appealType,
                   snippet(judgments_fts, 0, '【', '】', '...', 40) as textSnippet,
                   bm25(judgments_fts) as rank
            FROM judgments j
            INNER JOIN judgments_fts fts ON j.id = fts.rowid
            WHERE judgments_fts MATCH ? ${filterSQL}
            ORDER BY rank
            LIMIT ? OFFSET ?
          `);
          const results = dataStmt.all(ftsQuery, ...params, limit, offset);

          return res.json({
            data: results,
            pagination: {
              page,
              limit,
              total: Number(countResult.count),
              totalPages: Math.ceil(Number(countResult.count) / limit)
            }
          });
        } catch (ftsErr) {
          // Fallback to LIKE if FTS fails
          console.warn("FTS search failed, falling back to LIKE:", ftsErr);
        }
      }

      // Non-FTS path (no search query or FTS fallback)
      // Include CRSD decisions via UNION ALL when applicable
      if (includeCrsd) {
        const jConds: string[] = [];
        const jParams: any[] = [];
        if (source === "sa_all") jConds.push("source IN ('sa_judicial', 'bog_judicial', 'moj_research')");
        if (year) { jConds.push("year_hijri = ?"); jParams.push(parseInt(year as string)); }
        if (court) { jConds.push("court_body LIKE ?"); jParams.push(`%${court}%`); }
        if (q) { jConds.push("text LIKE ?"); jParams.push(`%${q}%`); }
        if (hasDate === "true") jConds.push("judgment_date IS NOT NULL AND judgment_date != ''");
        const jWhere = jConds.length > 0 ? "WHERE " + jConds.join(" AND ") : "";

        const cConds: string[] = [];
        const cParams: any[] = [];
        if (year) { cConds.push("year_hijri = ?"); cParams.push(parseInt(year as string)); }
        if (court) { cConds.push("committee_ar LIKE ?"); cParams.push(`%${court}%`); }
        if (q) { cConds.push("full_text LIKE ?"); cParams.push(`%${q}%`); }
        if (hasDate === "true") cConds.push("decision_date IS NOT NULL AND decision_date != ''");
        const cWhere = cConds.length > 0 ? "WHERE " + cConds.join(" AND ") : "";

        let unionOrder = "ORDER BY judgmentDate DESC";
        if (sort === "year") unionOrder = "ORDER BY yearHijri DESC";
        else if (sort === "city") unionOrder = "ORDER BY city";
        else if (sort === "court") unionOrder = "ORDER BY courtBody";

        const jCount = (sqlite.prepare(`SELECT count(*) as c FROM judgments ${jWhere}`).get(...jParams) as any)?.c || 0;
        const cCount = (sqlite.prepare(`SELECT count(*) as c FROM crsd_decisions ${cWhere}`).get(...cParams) as any)?.c || 0;
        const total = jCount + cCount;

        const results = sqlite.prepare(`
          SELECT * FROM (
            SELECT id, case_id as caseId, year_hijri as yearHijri, city,
                   court_body as courtBody, circuit_type as circuitType,
                   judgment_number as judgmentNumber, judgment_date as judgmentDate,
                   source, appeal_type as appealType,
                   substr(text, 1, 400) as textSnippet
            FROM judgments ${jWhere}
            UNION ALL
            SELECT id + 10000000 as id, 'crsd-' || id as caseId, year_hijri as yearHijri,
                   '' as city, committee_ar as courtBody,
                   COALESCE(case_type_ar, '') as circuitType,
                   CAST(decision_number AS TEXT) as judgmentNumber,
                   decision_date as judgmentDate,
                   'crsd' as source, NULL as appealType,
                   substr(full_text, 1, 400) as textSnippet
            FROM crsd_decisions ${cWhere}
          ) combined
          ${unionOrder}
          LIMIT ? OFFSET ?
        `).all(...jParams, ...cParams, limit, offset);

        return res.json({
          data: results,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
      }

      const conditions = [];

      if (city) {
        conditions.push(sql`city LIKE ${city as string}`);
      }
      if (year) {
        conditions.push(eq(judgments.yearHijri, parseInt(year as string)));
      }
      if (court) {
        conditions.push(sql`court_body LIKE ${`%${court}%`}`);
      }
      if (q) {
        conditions.push(sql`text LIKE ${`%${q}%`}`);
      }
      if (hasDate === "true") {
        conditions.push(sql`judgment_date IS NOT NULL AND judgment_date != ''`);
      }
      if (source === "sa_all") {
        conditions.push(sql`source IN ('sa_judicial', 'bog_judicial', 'moj_research')`);
      } else if (source) {
        conditions.push(eq(judgments.source, source as string));
      }
      if (judge) {
        conditions.push(sql`judges LIKE ${`%${judge}%`}`);
      }

      // Build order clause
      let orderClause;
      switch (sort) {
        case "year":
          orderClause = desc(judgments.yearHijri);
          break;
        case "city":
          orderClause = judgments.city;
          break;
        case "court":
          orderClause = judgments.courtBody;
          break;
        case "date":
        default:
          orderClause = desc(judgments.judgmentDate);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const results = await db
        .select({
          id: judgments.id,
          caseId: judgments.caseId,
          yearHijri: judgments.yearHijri,
          city: judgments.city,
          courtBody: judgments.courtBody,
          circuitType: judgments.circuitType,
          judgmentNumber: judgments.judgmentNumber,
          judgmentDate: judgments.judgmentDate,
          source: judgments.source,
          appealType: judgments.appealType,
          textSnippet: sql<string>`substr(text, 1, 400)`,
        })
        .from(judgments)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(orderClause);

      // Get total count for pagination - use cached counts for source-only filters
      let total: number;
      const countCacheKey = `jcount-${source || "all"}-${city || ""}-${court || ""}-${year || ""}-${hasDate || ""}-${judge || ""}-${q || ""}`;
      const cachedCount = facetsCache.get(countCacheKey);
      if (cachedCount && Date.now() - cachedCount.ts < FACETS_TTL) {
        total = cachedCount.data;
      } else {
        const [countResult] = await db
          .select({ count: sql<number>`count(*)` })
          .from(judgments)
          .where(whereClause);
        total = Number(countResult.count);
        facetsCache.set(countCacheKey, { data: total, ts: Date.now() });
      }

      res.json({
        data: results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error("Error fetching judgments:", error);
      res.status(500).json({ message: "Failed to fetch judgments" });
    }
  });

  // Faceted counts - MUST be before :id route
  // Pre-compute and cache facets (GROUP BY on 568K rows is very slow)
  const facetsCache = new Map<string, { data: any; ts: number }>();
  const FACETS_TTL = 3600_000; // 1 hour

  // Pre-warm facets cache in background after server starts
  function warmFacetsCache(sourceKey: string) {
    const srcFilter = sourceKey === "sa_all" ? " AND source IN ('sa_judicial', 'bog_judicial', 'moj_research')" : sourceKey ? " AND source = ?" : "";
    const srcParam = sourceKey === "sa_all" ? [] : sourceKey ? [sourceKey] : [];
    const includeCrsdFacets = sourceKey === "sa_all";
    try {
      const cities = sqlite.prepare(
        `SELECT city, count(*) as count FROM judgments WHERE city IS NOT NULL AND city != ''${srcFilter} GROUP BY city ORDER BY count DESC LIMIT 50`
      ).all(...srcParam);
      let courts = sqlite.prepare(
        `SELECT court_body as court, count(*) as count FROM judgments WHERE court_body IS NOT NULL AND court_body != ''${srcFilter} GROUP BY court_body ORDER BY count DESC LIMIT 50`
      ).all(...srcParam) as any[];
      let years = sqlite.prepare(
        `SELECT year_hijri as year, count(*) as count FROM judgments WHERE year_hijri IS NOT NULL${srcFilter} GROUP BY year_hijri ORDER BY year_hijri DESC`
      ).all(...srcParam) as any[];

      // Include CRSD committee names in courts and CRSD years
      if (includeCrsdFacets) {
        try {
          const crsdCommittees = sqlite.prepare(
            `SELECT committee_ar as court, count(*) as count FROM crsd_decisions WHERE committee_ar IS NOT NULL AND committee_ar != '' GROUP BY committee_ar ORDER BY count DESC`
          ).all() as any[];
          courts = [...courts, ...crsdCommittees].sort((a: any, b: any) => b.count - a.count);

          const crsdYears = sqlite.prepare(
            `SELECT year_hijri as year, count(*) as count FROM crsd_decisions WHERE year_hijri IS NOT NULL GROUP BY year_hijri ORDER BY year_hijri DESC`
          ).all() as any[];
          const yearMap = new Map<number, number>();
          for (const y of years) yearMap.set(y.year, (yearMap.get(y.year) || 0) + y.count);
          for (const y of crsdYears) yearMap.set(y.year, (yearMap.get(y.year) || 0) + y.count);
          years = Array.from(yearMap.entries()).map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year);
        } catch (crsdErr: any) {
          console.warn("CRSD facets merge skipped:", crsdErr.message);
        }
      }

      const result = { cities, courts, years };
      facetsCache.set(`facets-${sourceKey || "all"}`, { data: result, ts: Date.now() });
      console.log(`Facets cache warmed for ${sourceKey || "all"}`);
    } catch (e: any) {
      console.warn(`Facets cache warm failed for ${sourceKey || "all"}:`, e.message);
    }
  }

  // Warm Saudi facets first (fast, has city/year data), then Egyptian (slow but cached)
  setTimeout(() => warmFacetsCache("sa_all"), 1000);
  setTimeout(() => warmFacetsCache("eg_naqd"), 2000);
  setTimeout(() => warmFacetsCache(""), 4000);

  app.get("/api/judgments/facets", async (req, res) => {
    try {
      const { source } = req.query;
      const cacheKey = `facets-${source || "all"}`;
      const cached = facetsCache.get(cacheKey);
      if (cached) {
        res.set("Cache-Control", "public, max-age=600");
        return res.json(cached.data);
      }

      // If not cached yet, compute now
      const srcFilter = source === "sa_all" ? " AND source IN ('sa_judicial', 'bog_judicial', 'moj_research')" : source ? " AND source = ?" : "";
      const srcParam = source === "sa_all" ? [] : source ? [source] : [];
      const includeCrsdFacets = source === "sa_all";

      const cities = sqlite.prepare(
        `SELECT city, count(*) as count FROM judgments WHERE city IS NOT NULL AND city != ''${srcFilter} GROUP BY city ORDER BY count DESC LIMIT 50`
      ).all(...srcParam);
      let courts = sqlite.prepare(
        `SELECT court_body as court, count(*) as count FROM judgments WHERE court_body IS NOT NULL AND court_body != ''${srcFilter} GROUP BY court_body ORDER BY count DESC LIMIT 50`
      ).all(...srcParam) as any[];
      let years = sqlite.prepare(
        `SELECT year_hijri as year, count(*) as count FROM judgments WHERE year_hijri IS NOT NULL${srcFilter} GROUP BY year_hijri ORDER BY year_hijri DESC`
      ).all(...srcParam) as any[];

      // Include CRSD committee names in courts and years
      if (includeCrsdFacets) {
        try {
          const crsdCommittees = sqlite.prepare(
            `SELECT committee_ar as court, count(*) as count FROM crsd_decisions WHERE committee_ar IS NOT NULL AND committee_ar != '' GROUP BY committee_ar ORDER BY count DESC`
          ).all() as any[];
          courts = [...courts, ...crsdCommittees].sort((a: any, b: any) => b.count - a.count);

          const crsdYears = sqlite.prepare(
            `SELECT year_hijri as year, count(*) as count FROM crsd_decisions WHERE year_hijri IS NOT NULL GROUP BY year_hijri ORDER BY year_hijri DESC`
          ).all() as any[];
          const yearMap = new Map<number, number>();
          for (const y of years) yearMap.set(y.year, (yearMap.get(y.year) || 0) + y.count);
          for (const y of crsdYears) yearMap.set(y.year, (yearMap.get(y.year) || 0) + y.count);
          years = Array.from(yearMap.entries()).map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year);
        } catch (crsdErr: any) {
          console.warn("CRSD facets merge skipped:", crsdErr.message);
        }
      }

      const result = { cities, courts, years };
      facetsCache.set(cacheKey, { data: result, ts: Date.now() });
      res.set("Cache-Control", "public, max-age=600");
      res.json(result);
    } catch (error) {
      console.error("Error fetching facets:", error);
      res.status(500).json({ message: "Failed to fetch facets" });
    }
  });

  // Single Judgment by ID
  app.get("/api/judgments/:id", async (req, res) => {
    try {
      const idParam = req.params.id;
      const id = parseInt(idParam, 10);

      if (isNaN(id)) {
        console.error(`Invalid judgment ID requested: "${idParam}"`);
        return res.status(400).json({ message: "Invalid judgment ID" });
      }

      // CRSD decisions (لجان منازعات الأوراق المالية) use offset IDs >= 10000000
      if (id >= 10000000) {
        const crsdId = id - 10000000;
        const crsdResult = sqlite.prepare(`
          SELECT id, decision_number, committee, committee_ar,
                 case_type, case_type_ar, decision_date, decision_date_raw,
                 year_hijri, full_text, page_count, pdf_url, pdf_sha256,
                 ocr_confidence, auto_pass, needs_review, quality_json, created_at
          FROM crsd_decisions WHERE id = ?
        `).get(crsdId) as any;

        if (!crsdResult) {
          return res.status(404).json({ message: "Decision not found", requestedId: id });
        }

        // Map CRSD decision fields to judgment-compatible shape
        return res.json({
          id: id,
          caseId: `crsd-${crsdResult.id}`,
          yearHijri: crsdResult.year_hijri,
          city: "",
          courtBody: crsdResult.committee_ar,
          circuitType: crsdResult.case_type_ar || "",
          judgmentNumber: crsdResult.decision_number ? String(crsdResult.decision_number) : "",
          judgmentDate: crsdResult.decision_date || "",
          text: crsdResult.full_text || "",
          source: "crsd",
          pdfUrl: crsdResult.pdf_url,
          pageCount: crsdResult.page_count,
          committee: crsdResult.committee,
          committeeAr: crsdResult.committee_ar,
          caseType: crsdResult.case_type,
          caseTypeAr: crsdResult.case_type_ar,
        });
      }

      const [result] = await db
        .select()
        .from(judgments)
        .where(eq(judgments.id, id));

      if (!result) {
        return res.status(404).json({ message: "Judgment not found", requestedId: id });
      }

      res.json(result);
    } catch (error) {
      console.error("Error fetching judgment:", error);
      res.status(500).json({ message: "Failed to fetch judgment" });
    }
  });

  app.get("/api/articles/:lawId/overrides", async (req, res) => {
    try {
      const { lawId } = req.params;
      const overrides = await db
        .select()
        .from(articleOverrides)
        .where(eq(articleOverrides.lawId, lawId));

      const overridesMap: Record<string, { overrideText: string; updatedAt: string; updatedBy: string }> = {};
      overrides.forEach((o) => {
        overridesMap[o.articleNumber] = {
          overrideText: o.overrideText,
          updatedAt: o.updatedAt,
          updatedBy: o.updatedBy,
        };
      });

      res.json({ overrides: overridesMap });
    } catch (error) {
      console.error("Error fetching article overrides:", error);
      res.status(500).json({ message: "Failed to fetch article overrides" });
    }
  });

  app.get("/api/articles/:lawId/:articleNumber", async (req, res) => {
    try {
      const { lawId, articleNumber } = req.params;
      const [override] = await db
        .select()
        .from(articleOverrides)
        .where(
          and(
            eq(articleOverrides.lawId, lawId),
            eq(articleOverrides.articleNumber, articleNumber)
          )
        );

      if (override) {
        return res.json({
          hasOverride: true,
          overrideText: override.overrideText,
          updatedAt: override.updatedAt,
          updatedBy: override.updatedBy
        });
      }

      res.json({ hasOverride: false });
    } catch (error) {
      console.error("Error fetching article override:", error);
      res.status(500).json({ message: "Failed to fetch article override" });
    }
  });

  app.patch("/api/articles/:lawId/:articleNumber/override", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { lawId, articleNumber } = req.params;
      const { overrideText } = req.body;
      const userId = req.user?.claims?.sub;

      if (typeof overrideText !== "string") {
        return res.status(400).json({ message: "overrideText must be a string" });
      }

      const sanitizedText = overrideText
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const now = new Date().toISOString();

      const [result] = await db
        .insert(articleOverrides)
        .values({
          lawId,
          articleNumber,
          overrideText: sanitizedText,
          updatedAt: now,
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [articleOverrides.lawId, articleOverrides.articleNumber],
          set: {
            overrideText: sanitizedText,
            updatedAt: now,
            updatedBy: userId,
          },
        })
        .returning();

      res.json({
        success: true,
        override: result
      });
    } catch (error) {
      console.error("Error saving article override:", error);
      res.status(500).json({ message: "Failed to save article override" });
    }
  });

  app.delete("/api/articles/:lawId/:articleNumber/override", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { lawId, articleNumber } = req.params;

      await db
        .delete(articleOverrides)
        .where(
          and(
            eq(articleOverrides.lawId, lawId),
            eq(articleOverrides.articleNumber, articleNumber)
          )
        );

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting article override:", error);
      res.status(500).json({ message: "Failed to delete article override" });
    }
  });

  app.post("/api/error-reports", async (req, res) => {
    try {
      const { lawId, articleNumber, description } = req.body;

      if (!lawId || !articleNumber || !description) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const [report] = await db
        .insert(errorReports)
        .values({
          lawId,
          articleNumber: parseInt(articleNumber),
          description: description.trim(),
        })
        .returning();

      res.json({ success: true, report });
    } catch (error) {
      console.error("Error creating error report:", error);
      res.status(500).json({ message: "Failed to submit error report" });
    }
  });

  app.get("/api/error-reports", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const reports = await db
        .select()
        .from(errorReports)
        .orderBy(desc(errorReports.createdAt));

      res.json({ reports });
    } catch (error) {
      console.error("Error fetching error reports:", error);
      res.status(500).json({ message: "Failed to fetch error reports" });
    }
  });

  app.get("/api/legal-monitoring/report", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const report = await readLatestLegalMonitoringReport();
      if (!report) {
        return res.status(404).json({ message: "No legal monitoring report found yet" });
      }

      res.json({ report });
    } catch (error) {
      console.error("Error reading legal monitoring report:", error);
      res.status(500).json({ message: "Failed to read legal monitoring report" });
    }
  });

  app.post("/api/legal-monitoring/run", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const report = await runLegalMonitoringScan();
      res.json({ success: true, report });
    } catch (error) {
      console.error("Error running legal monitoring:", error);
      res.status(500).json({ message: "Failed to run legal monitoring scan" });
    }
  });

  // ============================================
  // Pre-Launch Audit API
  // ============================================

  app.post("/api/admin/audit/run", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { startAudit, isAuditRunning } = await import("./scanner");
      if (isAuditRunning()) {
        return res.status(409).json({ message: "مراجعة قيد التشغيل بالفعل" });
      }
      const runId = await startAudit();
      res.json({ success: true, runId });
    } catch (error: any) {
      console.error("Error starting audit:", error);
      res.status(500).json({ message: error.message || "Failed to start audit" });
    }
  });

  app.get("/api/admin/audit/status", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { getLatestAuditRun } = await import("./scanner");
      const run = getLatestAuditRun();
      if (!run) {
        return res.json({ run: null });
      }
      res.json({ run });
    } catch (error) {
      console.error("Error fetching audit status:", error);
      res.status(500).json({ message: "Failed to fetch audit status" });
    }
  });

  app.get("/api/admin/audit/findings", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { getFindings, getLatestAuditRun } = await import("./scanner");
      const run = getLatestAuditRun();
      if (!run) {
        return res.json({ findings: [], total: 0 });
      }
      const result = getFindings({
        runId: run.id,
        severity: req.query.severity as string,
        category: req.query.category as string,
        status: req.query.status as string,
        entityType: req.query.entityType as string,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching audit findings:", error);
      res.status(500).json({ message: "Failed to fetch findings" });
    }
  });

  app.patch("/api/admin/audit/findings/:id/status", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { updateFindingStatus } = await import("./scanner");
      const { status } = req.body;
      if (!["open", "acknowledged", "resolved", "wont_fix"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const success = updateFindingStatus(parseInt(req.params.id), status);
      res.json({ success });
    } catch (error) {
      console.error("Error updating finding status:", error);
      res.status(500).json({ message: "Failed to update finding status" });
    }
  });

  app.get("/api/admin/audit/stats", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { getAuditStats } = await import("./scanner");
      const stats = getAuditStats();
      res.json({ stats });
    } catch (error) {
      console.error("Error fetching audit stats:", error);
      res.status(500).json({ message: "Failed to fetch audit stats" });
    }
  });

  app.patch("/api/error-reports/:id/resolve", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;

      const [report] = await db
        .update(errorReports)
        .set({ status: "resolved", resolvedAt: new Date().toISOString() })
        .where(eq(errorReports.id, parseInt(id)))
        .returning();

      res.json({ success: true, report });
    } catch (error) {
      console.error("Error resolving error report:", error);
      res.status(500).json({ message: "Failed to resolve error report" });
    }
  });

  app.delete("/api/error-reports/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;

      await db
        .delete(errorReports)
        .where(eq(errorReports.id, parseInt(id)));

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting error report:", error);
      res.status(500).json({ message: "Failed to delete error report" });
    }
  });

  // ============================================
  // Gazette Index API  (كشاف أم القرى)
  // ============================================

  // Faceted counts — MUST be before :id route
  app.get("/api/gazette/facets", async (req, res) => {
    try {
      const categories = sqlite.prepare(`
        SELECT ${saudiGazetteCategoryCaseSql("g")} as category, count(*) as count
        FROM gazette_index g
        GROUP BY category
        ORDER BY count DESC
      `).all() as { category: string; count: number }[];

      const years = await db
        .select({ year: gazetteIndex.issueYear, count: sql<number>`count(*)` })
        .from(gazetteIndex)
        .where(sql`issue_year IS NOT NULL`)
        .groupBy(gazetteIndex.issueYear)
        .orderBy(desc(gazetteIndex.issueYear));

      const legislationYears = await db
        .select({ year: gazetteIndex.legislationYear, count: sql<number>`count(*)` })
        .from(gazetteIndex)
        .where(sql`legislation_year IS NOT NULL AND legislation_year != ''`)
        .groupBy(gazetteIndex.legislationYear)
        .orderBy(sql`legislation_year DESC`)
        .limit(100);

      res.set("Cache-Control", "public, max-age=3600");
      res.json({ categories, years, legislationYears });
    } catch (error) {
      console.error("Error fetching gazette facets:", error);
      res.status(500).json({ message: "Failed to fetch gazette facets" });
    }
  });

  // List + Search + Filter
  app.get("/api/gazette", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = (page - 1) * limit;

      const { q, category, year, legislationYear, exact } = req.query;

      // FTS5 path
      if (q && typeof q === "string" && q.trim().length > 0) {
        try {
          const filters: string[] = [];
          const params: any[] = [];

          if (category) { filters.push(`${saudiGazetteCategoryCaseSql("g")} = ?`); params.push(category); }
          if (year) { filters.push("g.issue_year = ?"); params.push(parseInt(year as string)); }
          if (legislationYear) { filters.push("g.legislation_year = ?"); params.push(legislationYear); }

          const filterSQL = filters.length > 0 ? "AND " + filters.join(" AND ") : "";
          const ftsQuery = exact === "true"
            ? buildLiteralFtsQuery(q as string)
            : buildLegalFtsQuery(q as string) || q.trim().split(/\s+/).map((w: string) => `${w}*`).join(" ");

          const countStmt = sqlite.prepare(`
            SELECT count(*) as count FROM gazette_index g
            INNER JOIN gazette_fts fts ON g.id = fts.rowid
            WHERE gazette_fts MATCH ? ${filterSQL}
          `);
          const countResult = countStmt.get(ftsQuery, ...params) as any;

          const dataStmt = sqlite.prepare(`
            SELECT g.id, g.issue_year as issueYear, g.issue_number as issueNumber,
                   g.title, g.legislation_number as legislationNumber,
                   g.legislation_year as legislationYear,
                   ${saudiGazetteCategoryCaseSql("g")} as category,
                   snippet(gazette_fts, 0, '【', '】', '...', 40) as titleSnippet,
                   bm25(gazette_fts) as rank
            FROM gazette_index g
            INNER JOIN gazette_fts fts ON g.id = fts.rowid
            WHERE gazette_fts MATCH ? ${filterSQL}
            ORDER BY rank
            LIMIT ? OFFSET ?
          `);
          const results = dataStmt.all(ftsQuery, ...params, limit, offset);

          return res.json({
            data: (results as any[]).map((item) => ({
              ...item,
              issuePdfUrl: buildGazetteIssuePdfUrl(item.issueNumber),
            })),
            pagination: {
              page, limit,
              total: Number(countResult.count),
              totalPages: Math.ceil(Number(countResult.count) / limit)
            }
          });
        } catch (ftsErr) {
          console.warn("Gazette FTS failed, falling back to LIKE:", ftsErr);
        }
      }

      // Non-FTS path
      const filters: string[] = [];
      const params: any[] = [];

      if (category) { filters.push(`${saudiGazetteCategoryCaseSql("g")} = ?`); params.push(category); }
      if (year) { filters.push("g.issue_year = ?"); params.push(parseInt(year as string)); }
      if (legislationYear) { filters.push("g.legislation_year = ?"); params.push(legislationYear); }
      if (q) { filters.push("g.title LIKE ?"); params.push(`%${q}%`); }

      const whereSql = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

      const dataStmt = sqlite.prepare(`
        SELECT g.id, g.issue_year as issueYear, g.issue_number as issueNumber,
               g.title, g.legislation_number as legislationNumber,
               g.legislation_year as legislationYear,
               ${saudiGazetteCategoryCaseSql("g")} as category
        FROM gazette_index g
        ${whereSql}
        ORDER BY g.issue_year DESC
        LIMIT ? OFFSET ?
      `);
      const results = (dataStmt.all(...params, limit, offset) as any[]).map((item) => ({
        ...item,
        issuePdfUrl: buildGazetteIssuePdfUrl(item.issueNumber),
      }));

      const countStmt = sqlite.prepare(`
        SELECT count(*) as count
        FROM gazette_index g
        ${whereSql}
      `);
      const countResult = countStmt.get(...params) as any;

      res.json({
        data: results,
        pagination: {
          page, limit,
          total: Number(countResult.count),
          totalPages: Math.ceil(Number(countResult.count) / limit)
        }
      });
    } catch (error) {
      console.error("Error fetching gazette:", error);
      res.status(500).json({ message: "Failed to fetch gazette data" });
    }
  });

  // ============================================
  // CRSD Principles (المبادئ القضائية) API
  // ============================================
  app.get("/api/principles", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = (page - 1) * limit;
      const section = req.query.section as string;
      const q = (req.query.q as string || "").trim();

      // FTS search path
      if (q.length >= 2 && searchCrsdStmt) {
        try {
          const ftsQuery = buildLegalFtsQuery(q);
          const extraWhere = section ? ' AND p.section = ?' : '';
          const params = section ? [ftsQuery, section, limit, offset] : [ftsQuery, limit, offset];
          const countParams = section ? [ftsQuery, section] : [ftsQuery];

          const items = sqlite.prepare(`
            SELECT p.id, p.section, p.section_ar, p.principle_text, p.decision_numbers, p.source_ar,
                   snippet(crsd_principles_fts, 0, '【', '】', '...', 50) as textSnippet,
                   bm25(crsd_principles_fts) as rank
            FROM crsd_principles p
            INNER JOIN crsd_principles_fts fts ON p.id = fts.rowid
            WHERE crsd_principles_fts MATCH ?${extraWhere}
            ORDER BY rank
            LIMIT ? OFFSET ?
          `).all(...params) as any[];

          const countResult = sqlite.prepare(`
            SELECT count(*) as c
            FROM crsd_principles p
            INNER JOIN crsd_principles_fts fts ON p.id = fts.rowid
            WHERE crsd_principles_fts MATCH ?${extraWhere}
          `).get(...countParams) as any;

          // Get section facets for this query
          const sectionFacets = sqlite.prepare(`
            SELECT p.section, p.section_ar, count(*) as count
            FROM crsd_principles p
            INNER JOIN crsd_principles_fts fts ON p.id = fts.rowid
            WHERE crsd_principles_fts MATCH ?
            GROUP BY p.section
            ORDER BY count DESC
          `).all(ftsQuery) as any[];

          res.set("Cache-Control", "public, max-age=300");
          return res.json({ items, total: countResult?.c || 0, page, limit, sections: sectionFacets });
        } catch {
          // Fall through to non-FTS path
        }
      }

      // Non-FTS path (browse/filter)
      const conditions: string[] = [];
      const params: any[] = [];
      if (section) { conditions.push('section = ?'); params.push(section); }
      if (q) {
        conditions.push("principle_text LIKE ?");
        params.push(`%${q}%`);
      }
      const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const total = (sqlite.prepare(`SELECT count(*) as c FROM crsd_principles ${where}`).get(...params) as any)?.c || 0;
      const items = sqlite.prepare(`
        SELECT id, section, section_ar, principle_text, decision_numbers, source_ar
        FROM crsd_principles ${where}
        ORDER BY section, id
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as any[];

      // Section facets
      const sectionFacets = sqlite.prepare(`
        SELECT section, section_ar, count(*) as count
        FROM crsd_principles
        GROUP BY section
        ORDER BY count DESC
      `).all() as any[];

      res.set("Cache-Control", "public, max-age=300");
      res.json({
        items: items.map((i: any) => ({
          ...i,
          decision_numbers: typeof i.decision_numbers === 'string' ? JSON.parse(i.decision_numbers) : i.decision_numbers,
        })),
        total,
        page,
        limit,
        sections: sectionFacets,
      });
    } catch (error) {
      console.error("Error fetching principles:", error);
      res.status(500).json({ message: "Failed to fetch principles" });
    }
  });

  app.get("/api/principles/facets", async (req, res) => {
    try {
      const sections = sqlite.prepare(`
        SELECT section, section_ar, count(*) as count
        FROM crsd_principles
        GROUP BY section
        ORDER BY count DESC
      `).all() as any[];

      const total = (sqlite.prepare("SELECT count(*) as cnt FROM crsd_principles").get() as any)?.cnt || 0;

      res.set("Cache-Control", "public, max-age=3600");
      res.json({ sections, total });
    } catch (error) {
      console.error("Error fetching principle facets:", error);
      res.status(500).json({ message: "Failed to fetch principle facets" });
    }
  });

  app.get("/api/principles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid principle ID" });
      }

      const result = sqlite.prepare(`
        SELECT id, section, section_ar, principle_text, decision_numbers, source, source_ar, created_at
        FROM crsd_principles WHERE id = ?
      `).get(id) as any;

      if (!result) {
        return res.status(404).json({ message: "Principle not found" });
      }

      res.json({
        ...result,
        decision_numbers: typeof result.decision_numbers === 'string' ? JSON.parse(result.decision_numbers) : result.decision_numbers,
      });
    } catch (error) {
      console.error("Error fetching principle:", error);
      res.status(500).json({ message: "Failed to fetch principle" });
    }
  });

  // ============================================
  // CRSD Decisions (أحكام لجان منازعات الأوراق المالية) API
  // ============================================

  // Cache for decisions facets
  const decisionsFacetsCache = new Map<string, { data: any; ts: number }>();
  const DECISIONS_FACETS_TTL = 3600_000; // 1 hour

  // List / Search decisions
  app.get("/api/decisions", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = (page - 1) * limit;
      const sort = (req.query.sort as string) || "number";

      const q = (req.query.q as string || "").trim();
      const committee = req.query.committee as string;
      const caseType = req.query.case_type as string;
      const year = req.query.year as string;
      const exact = req.query.exact as string;
      const reviewStatus = req.query.review as string; // "auto_pass", "needs_review", or omit for all

      // FTS search path
      if (q.length >= 2 && searchCrsdDecisionsStmt) {
        try {
          const ftsQuery = exact === "true"
            ? buildLiteralFtsQuery(q)
            : buildLegalFtsQuery(q) || q.trim().split(/\s+/).map((w: string) => `${w}*`).join(" ");

          // Build additional WHERE filters
          const filters: string[] = [];
          const params: any[] = [];

          if (committee) { filters.push("d.committee = ?"); params.push(committee); }
          if (caseType) { filters.push("d.case_type = ?"); params.push(caseType); }
          if (year) { filters.push("d.year_hijri = ?"); params.push(parseInt(year)); }
          if (reviewStatus === "auto_pass") { filters.push("d.auto_pass = 1"); }
          else if (reviewStatus === "needs_review") { filters.push("d.needs_review = 1"); }
          // Default: show all decisions (single OCR mode)

          const filterSQL = filters.length > 0 ? " AND " + filters.join(" AND ") : "";

          const countResult = sqlite.prepare(`
            SELECT count(*) as count
            FROM crsd_decisions d
            INNER JOIN crsd_decisions_fts fts ON d.id = fts.rowid
            WHERE crsd_decisions_fts MATCH ?${filterSQL}
          `).get(ftsQuery, ...params) as any;

          const items = sqlite.prepare(`
            SELECT d.id, d.decision_number, d.committee, d.committee_ar,
                   d.case_type, d.case_type_ar, d.decision_date, d.year_hijri,
                   d.pdf_url, d.page_count, d.auto_pass, d.needs_review,
                   snippet(crsd_decisions_fts, 0, '【', '】', '...', 50) as textSnippet,
                   bm25(crsd_decisions_fts) as rank
            FROM crsd_decisions d
            INNER JOIN crsd_decisions_fts fts ON d.id = fts.rowid
            WHERE crsd_decisions_fts MATCH ?${filterSQL}
            ORDER BY rank
            LIMIT ? OFFSET ?
          `).all(ftsQuery, ...params, limit, offset) as any[];

          // Committee facets for this query
          const committeeFacets = sqlite.prepare(`
            SELECT d.committee, d.committee_ar, count(*) as count
            FROM crsd_decisions d
            INNER JOIN crsd_decisions_fts fts ON d.id = fts.rowid
            WHERE crsd_decisions_fts MATCH ? AND d.auto_pass = 1
            GROUP BY d.committee
            ORDER BY count DESC
          `).all(ftsQuery) as any[];

          res.set("Cache-Control", "public, max-age=300");
          return res.json({
            data: items,
            pagination: {
              page,
              limit,
              total: Number(countResult.count),
              totalPages: Math.ceil(Number(countResult.count) / limit),
            },
            facets: { committees: committeeFacets },
          });
        } catch (ftsErr) {
          console.warn("CRSD Decisions FTS search failed, falling back to LIKE:", ftsErr);
        }
      }

      // Non-FTS path (browse / filter)
      const conditions: string[] = [];
      const params: any[] = [];

      if (committee) { conditions.push("committee = ?"); params.push(committee); }
      if (caseType) { conditions.push("case_type = ?"); params.push(caseType); }
      if (year) { conditions.push("year_hijri = ?"); params.push(parseInt(year)); }
      if (q) { conditions.push("full_text LIKE ?"); params.push(`%${q}%`); }

      // Filter by review status if specified
      if (reviewStatus === "needs_review") { conditions.push("needs_review = 1"); }
      else if (reviewStatus === "auto_pass") { conditions.push("auto_pass = 1"); }
      // Default: show all decisions

      const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

      // Sort
      let orderSQL = "ORDER BY decision_number DESC";
      if (sort === "date") orderSQL = "ORDER BY decision_date DESC";
      else if (sort === "year") orderSQL = "ORDER BY year_hijri DESC";
      else if (sort === "committee") orderSQL = "ORDER BY committee, decision_number DESC";

      const total = (sqlite.prepare(`SELECT count(*) as c FROM crsd_decisions ${where}`).get(...params) as any)?.c || 0;
      const items = sqlite.prepare(`
        SELECT id, decision_number, committee, committee_ar,
               case_type, case_type_ar, decision_date, year_hijri,
               pdf_url, page_count, auto_pass, needs_review,
               substr(full_text, 1, 400) as textSnippet
        FROM crsd_decisions ${where}
        ${orderSQL}
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as any[];

      res.set("Cache-Control", "public, max-age=300");
      res.json({
        data: items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Error fetching decisions:", error);
      res.status(500).json({ message: "Failed to fetch decisions" });
    }
  });

  // Decisions facets — MUST be before :id route
  app.get("/api/decisions/facets", async (req, res) => {
    try {
      const cacheKey = "decisions-facets";
      const cached = decisionsFacetsCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < DECISIONS_FACETS_TTL) {
        res.set("Cache-Control", "public, max-age=600");
        return res.json(cached.data);
      }

      const committees = sqlite.prepare(`
        SELECT committee, committee_ar, count(*) as count
        FROM crsd_decisions
        GROUP BY committee
        ORDER BY count DESC
      `).all() as any[];

      const caseTypes = sqlite.prepare(`
        SELECT case_type, case_type_ar, count(*) as count
        FROM crsd_decisions
        WHERE case_type IS NOT NULL AND case_type != ''
        GROUP BY case_type
        ORDER BY count DESC
      `).all() as any[];

      const years = sqlite.prepare(`
        SELECT year_hijri as year, count(*) as count
        FROM crsd_decisions
        WHERE year_hijri IS NOT NULL
        GROUP BY year_hijri
        ORDER BY year_hijri DESC
      `).all() as any[];

      const total = (sqlite.prepare("SELECT count(*) as cnt FROM crsd_decisions").get() as any)?.cnt || 0;
      const totalAll = (sqlite.prepare("SELECT count(*) as cnt FROM crsd_decisions").get() as any)?.cnt || 0;
      const totalReview = (sqlite.prepare("SELECT count(*) as cnt FROM crsd_decisions WHERE needs_review = 1").get() as any)?.cnt || 0;

      const result = { committees, caseTypes, years, total, totalAll, totalReview };
      decisionsFacetsCache.set(cacheKey, { data: result, ts: Date.now() });
      res.set("Cache-Control", "public, max-age=600");
      res.json(result);
    } catch (error) {
      console.error("Error fetching decisions facets:", error);
      res.status(500).json({ message: "Failed to fetch decisions facets" });
    }
  });

  // Single Decision by ID
  app.get("/api/decisions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid decision ID" });
      }

      const result = sqlite.prepare(`
        SELECT id, decision_number, committee, committee_ar,
               case_type, case_type_ar, decision_date, decision_date_raw,
               year_hijri, full_text, page_count, pdf_url, pdf_sha256,
               ocr_confidence, auto_pass, needs_review, quality_json, created_at
        FROM crsd_decisions WHERE id = ?
      `).get(id) as any;

      if (!result) {
        return res.status(404).json({ message: "Decision not found" });
      }

      // Parse quality_json if present
      if (result.quality_json) {
        try {
          result.quality = JSON.parse(result.quality_json);
        } catch {
          result.quality = null;
        }
        delete result.quality_json;
      }

      res.json(result);
    } catch (error) {
      console.error("Error fetching decision:", error);
      res.status(500).json({ message: "Failed to fetch decision" });
    }
  });

  return httpServer;
}
