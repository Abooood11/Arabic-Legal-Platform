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

          // Better Arabic search: allow partial matches and handle diacritics
          const exactMatch = exact === "true";
          const ftsQuery = exactMatch ? buildLiteralFtsQuery(q) : buildLegalFtsQuery(q);

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
          const exactMatch = exact === "true";
          const ftsQuery = exactMatch ? buildLiteralFtsQuery(q) : buildLegalFtsQuery(q);

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
