import type { Request } from "express";
import { sqlite } from "./db";

/** Maximum session duration in seconds (30 minutes) */
const MAX_SESSION_DURATION = 30 * 60;

export function setupAnalyticsSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS analytics_sessions (
      session_id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      user_id TEXT,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      page_views INTEGER NOT NULL DEFAULT 0,
      entry_page TEXT,
      last_page TEXT,
      entry_referrer TEXT,
      entry_source TEXT,
      country_code TEXT,
      city TEXT,
      device_type TEXT,
      age_range TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_visitor_id ON analytics_sessions(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_started_at ON analytics_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_country ON analytics_sessions(country_code);
    CREATE INDEX IF NOT EXISTS idx_analytics_is_bot ON analytics_sessions(is_bot);
  `);

  // Add is_bot column if it doesn't exist (migration for existing DBs)
  try {
    sqlite.exec(`ALTER TABLE analytics_sessions ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }
}

const BOT_PATTERNS = /bot|crawl|spider|slurp|bingpreview|mediapartners|google|yandex|baidu|duckduck|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|anthropic|ccbot|applebot|archive\.org|wget|curl|python-requests|httpx|axios|node-fetch|go-http-client|java\/|okhttp|headlesschrome|phantomjs|selenium|puppeteer|playwright/i;

function isBot(userAgent: string): boolean {
  if (!userAgent || userAgent.length < 10) return true;
  return BOT_PATTERNS.test(userAgent);
}

function getFirstHeader(req: Request, names: string[]) {
  for (const n of names) {
    const value = req.headers[n.toLowerCase() as keyof typeof req.headers];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function detectDevice(userAgent: string) {
  const ua = userAgent.toLowerCase();
  if (/mobile|iphone|android/.test(ua)) return "mobile";
  if (/ipad|tablet/.test(ua)) return "tablet";
  return "desktop";
}

function deriveSource(referrer?: string, source?: string) {
  if (source && source.trim()) return source.trim();
  if (!referrer) return "direct";
  try {
    const u = new URL(referrer);
    if (u.hostname.includes("google")) return "google";
    if (u.hostname.includes("x.com") || u.hostname.includes("twitter")) return "x";
    if (u.hostname.includes("linkedin")) return "linkedin";
    if (u.hostname.includes("facebook")) return "facebook";
    return "referral";
  } catch {
    return "referral";
  }
}

export function recordAnalyticsEvent(req: Request, body: any) {
  const sessionId = String(body?.sessionId || "").trim();
  const visitorId = String(body?.visitorId || "").trim();
  const path = String(body?.path || "").trim();
  const eventType = String(body?.eventType || "pageview").trim();
  const referrer = typeof body?.referrer === "string" ? body.referrer : null;
  const source = typeof body?.source === "string" ? body.source : null;
  const ageRange = typeof body?.ageRange === "string" ? body.ageRange : null;
  if (!sessionId || !visitorId || !path) return;

  const userAgent = String(req.headers["user-agent"] || "");

  // Skip bots entirely
  if (isBot(userAgent)) return;

  const now = new Date().toISOString();
  const country = getFirstHeader(req, ["cf-ipcountry", "x-vercel-ip-country", "x-country-code"]) || "unknown";
  const city = getFirstHeader(req, ["x-vercel-ip-city", "x-city"]) || null;
  const deviceType = detectDevice(userAgent);
  const entrySource = deriveSource(referrer || undefined, source || undefined);
  const userId = (req as any).user?.claims?.sub || null;

  sqlite.prepare(`
    INSERT OR IGNORE INTO analytics_sessions (
      session_id, visitor_id, user_id, started_at, last_seen_at,
      duration_seconds, page_views, entry_page, last_page, entry_referrer,
      entry_source, country_code, city, device_type, age_range, is_bot
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    sessionId,
    visitorId,
    userId,
    now,
    now,
    eventType === "pageview" ? 1 : 0,
    path,
    path,
    referrer,
    entrySource,
    country,
    city,
    deviceType,
    ageRange,
  );

  // Cap duration at MAX_SESSION_DURATION
  sqlite.prepare(`
    UPDATE analytics_sessions
    SET
      user_id = COALESCE(?, user_id),
      last_seen_at = ?,
      duration_seconds = MIN(
        CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER),
        ?
      ),
      page_views = page_views + ?,
      last_page = ?,
      age_range = COALESCE(?, age_range)
    WHERE session_id = ?
  `).run(
    userId,
    now,
    now,
    MAX_SESSION_DURATION,
    eventType === "pageview" ? 1 : 0,
    path,
    ageRange,
    sessionId,
  );
}
