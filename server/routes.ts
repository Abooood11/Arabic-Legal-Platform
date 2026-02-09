import type { Express, RequestHandler } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
// import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";

// Mock auth functions
const setupAuth = async (app: any) => { };
const registerAuthRoutes = (app: any) => { };
const isAuthenticated: RequestHandler = (req, res, next) => {
  // Mock a user for protected routes
  (req as any).user = { claims: { sub: "dev_admin" } };
  next();
};
import { db, sqlite } from "./db";
import { articleOverrides, errorReports, judgments } from "@shared/schema";
import { eq, and, desc, sql, like } from "drizzle-orm";
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "").split(",").filter(Boolean);

const isAdmin: RequestHandler = async (req, res, next) => {
  // Bypass admin check
  next();
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // await setupAuth(app);
  // registerAuthRoutes(app);

  app.get("/api/auth/admin-status", isAuthenticated, (req: any, res) => {
    const userId = req.user?.claims?.sub;
    const isAdminUser = ADMIN_USER_IDS.includes(userId);
    res.json({ isAdmin: isAdminUser });
  });

  app.get(api.sources.list.path, async (req, res) => {
    const sources = await storage.getSources();
    res.json(sources);
  });

  app.get(api.library.list.path, async (req, res) => {
    const library = await storage.getLibrary();
    res.json(library);
  });

  app.get(api.laws.get.path, async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const law = await storage.getLaw(id);
    if (!law) {
      return res.status(404).json({ message: "Law not found" });
    }
    res.json(law);
  });

  // Judgments API
  app.get("/api/judgments", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;
      const sort = (req.query.sort as string) || "date";

      const { q, city, year, court, hasDate, source, judge } = req.query;

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
          const ftsQuery = q.trim().split(/\s+/).map((w: string) => `${w}*`).join(" ");

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

  return httpServer;
}
