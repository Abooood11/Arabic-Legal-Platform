import type { Express, RequestHandler } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { registerAuthRoutes, isAuthenticated, isAdmin, setupAuthSchema } from "./authSystem";
import { db, sqlite } from "./db";
import { articleOverrides, errorReports, judgments, gazetteIndex } from "@shared/schema";
import { eq, and, desc, sql, like } from "drizzle-orm";
import { readLatestLegalMonitoringReport, runLegalMonitoringScan } from "./legalMonitoring";
import { setupAnalyticsSchema, recordAnalyticsEvent } from "./analytics";
import { buildLegalFtsQuery, buildLiteralFtsQuery } from "./searchUtils";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  setupAuthSchema();
  setupAnalyticsSchema();
  registerAuthRoutes(app);


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
        (SELECT COUNT(*) FROM analytics_sessions) as visitsTotal,
        (SELECT COUNT(DISTINCT visitor_id) FROM analytics_sessions WHERE datetime(started_at) >= datetime('now', '-6 days')) as uniqueVisitors7d,
        (SELECT COALESCE(AVG(duration_seconds), 0) FROM analytics_sessions WHERE duration_seconds > 0) as avgSessionDurationSec
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
      WHERE entry_page IS NOT NULL AND entry_page != ''
      GROUP BY entry_page
      ORDER BY count DESC
      LIMIT 6
    `).all() as any[];

    const topSources = sqlite.prepare(`
      SELECT entry_source as label, COUNT(*) as count
      FROM analytics_sessions
      WHERE entry_source IS NOT NULL AND entry_source != ''
      GROUP BY entry_source
      ORDER BY count DESC
      LIMIT 6
    `).all() as any[];

    const countries = sqlite.prepare(`
      SELECT country_code as label, COUNT(*) as count
      FROM analytics_sessions
      WHERE country_code IS NOT NULL AND country_code != ''
      GROUP BY country_code
      ORDER BY count DESC
      LIMIT 8
    `).all() as any[];

    const ages = sqlite.prepare(`
      SELECT age_range as label, COUNT(*) as count
      FROM analytics_sessions
      WHERE age_range IS NOT NULL AND age_range != ''
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
    // Cache individual law for 1 hour in browser
    res.set("Cache-Control", "public, max-age=3600");
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

    if (expandedTerms.length === 0) return mainQuery || raw.trim().split(/\s+/).map(w => `${w}*`).join(" ");

    // Build OR expansion: (original terms) OR (synonym1*) OR (synonym2*)
    const expansions = expandedTerms.map(t => `${t}*`);
    return `(${mainQuery}) OR (${expansions.join(" OR ")})`;
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

  app.get("/api/search", async (req, res) => {
    try {
      const startTime = Date.now();
      const q = (req.query.q as string || "").trim();
      const type = (req.query.type as string) || "all";
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const offset = (page - 1) * limit;

      if (q.length < 2) {
        return res.json({
          query: q,
          totalResults: 0,
          timeTaken: 0,
          intent: null,
          results: { laws: { items: [], total: 0 }, judgments: { items: [], total: 0 }, gazette: { items: [], total: 0 } }
        });
      }

      // Detect user intent for smarter results
      const intent = detectSearchIntent(q);
      const effectiveType = type !== "all" ? type : intent.type;
      const ftsQuery = buildFtsQuery(q, intent.expandedTerms);

      // Search all sources - priority order affects "all" tab display
      const searchLaws = () => {
        if (type !== "all" && type !== "laws") return { items: [], total: 0 };
        try {
          const items = searchLawsStmt.all(ftsQuery, limit, offset) as any[];
          const countResult = countLawsStmt.get(ftsQuery) as any;
          return { items, total: countResult?.count || 0 };
        } catch { return { items: [], total: 0 }; }
      };

      const searchJudgments = () => {
        if (type !== "all" && type !== "judgments") return { items: [], total: 0 };
        try {
          const items = searchJudgmentsStmt.all(ftsQuery, limit, offset) as any[];
          const countResult = countJudgmentsStmt.get(ftsQuery) as any;
          return { items, total: countResult?.count || 0 };
        } catch { return { items: [], total: 0 }; }
      };

      const searchGazette = () => {
        if (type !== "all" && type !== "gazette") return { items: [], total: 0 };
        try {
          const items = searchGazetteStmt.all(ftsQuery, limit, offset) as any[];
          const countResult = countGazetteStmt.get(ftsQuery) as any;
          return { items, total: countResult?.count || 0 };
        } catch { return { items: [], total: 0 }; }
      };

      // Execute all searches (SQLite is sync so they run sequentially, but each is fast with FTS5)
      const lawResults = searchLaws();
      const judgmentResults = searchJudgments();
      const gazetteResults = searchGazette();

      const timeTaken = Date.now() - startTime;
      const totalResults = lawResults.total + judgmentResults.total + gazetteResults.total;

      // Cross-reference: find related content across types
      const crossLinks: { lawsToJudgments: string[]; lawsToGazette: string[]; relatedLaws: string[] } = { lawsToJudgments: [], lawsToGazette: [], relatedLaws: [] };
      if (type === "all" && lawResults.items.length > 0) {
        const lawNames = Array.from(new Set(lawResults.items.map((l: any) => l.law_name).filter(Boolean))).slice(0, 3);
        for (const name of lawNames) {
          if (judgmentResults.total > 0) crossLinks.lawsToJudgments.push(name as string);
          if (gazetteResults.total > 0) crossLinks.lawsToGazette.push(name as string);
        }
        // Extract unique law_ids for cross-law referencing
        const lawIds = Array.from(new Set(lawResults.items.map((l: any) => l.law_id))).slice(0, 5);
        crossLinks.relatedLaws = lawIds as string[];
      }

      // Build faceted counts for advanced filtering
      const facets: { years: {year: number, count: number}[], cities: {city: string, count: number}[], categories: {category: string, count: number}[] } = {
        years: [], cities: [], categories: []
      };

      try {
        if (type === "all" || type === "judgments") {
          // Get judgment year facets for this query
          const yearFacets = sqlite.prepare(`
            SELECT j.year_hijri as year, count(*) as count
            FROM judgments j
            INNER JOIN judgments_fts fts ON j.id = fts.rowid
            WHERE judgments_fts MATCH ? AND j.year_hijri IS NOT NULL
            GROUP BY j.year_hijri ORDER BY count DESC LIMIT 10
          `).all(ftsQuery) as any[];
          facets.years = yearFacets;

          // Get city facets
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
          // Get gazette category facets
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

      // Parse advanced query info for frontend display
      const parsedInfo = parseAdvancedQuery(q);

      // Log search to analytics (async, non-blocking)
      try {
        const normalized = q.trim().replace(/\s+/g, " ").toLowerCase();
        sqlite.prepare(`
          INSERT INTO search_logs (query, query_normalized, result_count, result_type, time_taken, has_results)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(q, normalized, totalResults, type, timeTaken, totalResults > 0 ? 1 : 0);
      } catch {}

      res.set("Cache-Control", "public, max-age=60");
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
          gazette: gazetteResults,
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
      res.json({ judgments: relatedJudgments, gazette: relatedGazette });
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

      res.set("Cache-Control", "public, max-age=3600");
      res.json({
        totalDocuments: lawCount + judgmentCount + gazetteCount,
        laws: { articles: lawCount, laws: lawNamesCount },
        judgments: { total: judgmentCount },
        gazette: { total: gazetteCount },
      });
    } catch {
      res.json({ totalDocuments: 0, laws: { articles: 0, laws: 0 }, judgments: { total: 0 }, gazette: { total: 0 } });
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

  // Trending searches (most popular queries in last 7 days)
  app.get("/api/search/trending", async (req, res) => {
    try {
      const trending = sqlite.prepare(`
        SELECT query_normalized as query, count(*) as count
        FROM search_logs
        WHERE created_at >= datetime('now', '-7 days')
          AND has_results = 1
          AND length(query_normalized) >= 3
        GROUP BY query_normalized
        ORDER BY count DESC
        LIMIT 10
      `).all() as any[];

      res.set("Cache-Control", "public, max-age=300");
      res.json(trending);
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

      // Use FTS5 for text search when q is provided
      if (q && typeof q === "string" && q.trim().length > 0) {
        try {
          // Build additional WHERE filters
          const filters: string[] = [];
          const params: any[] = [];

          if (city) { filters.push("j.city LIKE ?"); params.push(city); }
          if (year) { filters.push("j.year_hijri = ?"); params.push(parseInt(year as string)); }
          if (court) { filters.push("j.court_body LIKE ?"); params.push(`%${court}%`); }
          if (source) { filters.push("j.source = ?"); params.push(source); }
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
      if (source) {
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

      // Get total count for pagination
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(judgments)
        .where(whereClause);

      res.json({
        data: results,
        pagination: {
          page,
          limit,
          total: Number(countResult.count),
          totalPages: Math.ceil(Number(countResult.count) / limit)
        }
      });
    } catch (error) {
      console.error("Error fetching judgments:", error);
      res.status(500).json({ message: "Failed to fetch judgments" });
    }
  });

  // Faceted counts - MUST be before :id route
  app.get("/api/judgments/facets", async (req, res) => {
    try {
      const { source } = req.query;
      const sourceCondition = source ? eq(judgments.source, source as string) : undefined;

      const cities = await db
        .select({ city: judgments.city, count: sql<number>`count(*)` })
        .from(judgments)
        .where(sourceCondition ? and(sql`city IS NOT NULL AND city != ''`, sourceCondition) : sql`city IS NOT NULL AND city != ''`)
        .groupBy(judgments.city)
        .orderBy(sql`count(*) DESC`)
        .limit(50);

      const courts = await db
        .select({ court: judgments.courtBody, count: sql<number>`count(*)` })
        .from(judgments)
        .where(sourceCondition ? and(sql`court_body IS NOT NULL AND court_body != ''`, sourceCondition) : sql`court_body IS NOT NULL AND court_body != ''`)
        .groupBy(judgments.courtBody)
        .orderBy(sql`count(*) DESC`)
        .limit(50);

      const years = await db
        .select({ year: judgments.yearHijri, count: sql<number>`count(*)` })
        .from(judgments)
        .where(sourceCondition ? and(sql`year_hijri IS NOT NULL`, sourceCondition) : sql`year_hijri IS NOT NULL`)
        .groupBy(judgments.yearHijri)
        .orderBy(desc(judgments.yearHijri));

      res.set("Cache-Control", "public, max-age=3600");
      res.json({ cities, courts, years });
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
      const categories = await db
        .select({ category: gazetteIndex.category, count: sql<number>`count(*)` })
        .from(gazetteIndex)
        .where(sql`category IS NOT NULL AND category != ''`)
        .groupBy(gazetteIndex.category)
        .orderBy(sql`count(*) DESC`);

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

          if (category) { filters.push("g.category = ?"); params.push(category); }
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
                   g.legislation_year as legislationYear, g.category,
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
            data: results,
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
      const conditions = [];
      if (category) conditions.push(eq(gazetteIndex.category, category as string));
      if (year) conditions.push(eq(gazetteIndex.issueYear, parseInt(year as string)));
      if (legislationYear) conditions.push(eq(gazetteIndex.legislationYear, legislationYear as string));
      if (q) conditions.push(sql`title LIKE ${`%${q}%`}`);

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const results = await db
        .select({
          id: gazetteIndex.id,
          issueYear: gazetteIndex.issueYear,
          issueNumber: gazetteIndex.issueNumber,
          title: gazetteIndex.title,
          legislationNumber: gazetteIndex.legislationNumber,
          legislationYear: gazetteIndex.legislationYear,
          category: gazetteIndex.category,
        })
        .from(gazetteIndex)
        .where(whereClause)
        .orderBy(desc(gazetteIndex.issueYear))
        .limit(limit)
        .offset(offset);

      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(gazetteIndex)
        .where(whereClause);

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

  return httpServer;
}
