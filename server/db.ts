import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data.db");
const sqlite = new Database(dbPath);

// Enable WAL mode for better performance
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
// Performance optimizations
sqlite.pragma("cache_size = -65536");       // 64MB cache
sqlite.pragma("mmap_size = 268435456");     // 256MB memory-mapped I/O
sqlite.pragma("temp_store = MEMORY");       // temp tables in RAM
sqlite.pragma("synchronous = NORMAL");      // faster writes

export const db = drizzle(sqlite);
export { sqlite };

// Create FTS5 virtual table for full-text search if not exists
try {
    sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS judgments_fts USING fts5(
            text,
            court_body,
            content='judgments',
            content_rowid='id',
            tokenize='unicode61 remove_diacritics 2'
        );
    `);

    // Check if FTS table is populated
    const ftsCount = sqlite.prepare("SELECT count(*) as cnt FROM judgments_fts").get() as any;
    const mainCount = sqlite.prepare("SELECT count(*) as cnt FROM judgments").get() as any;

    if (ftsCount.cnt === 0 && mainCount.cnt > 0) {
        console.log("Populating FTS index... this may take a moment");
        sqlite.exec(`INSERT INTO judgments_fts(rowid, text, court_body) SELECT id, text, court_body FROM judgments;`);
        console.log("FTS index populated.");
    }
} catch (e: any) {
    console.warn("FTS5 setup skipped:", e.message);
}

// ============================================
// Gazette Index Table + FTS5
// ============================================
try {
    // Create gazette_index table
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS gazette_index (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_year INTEGER,
            issue_number TEXT,
            title TEXT NOT NULL,
            legislation_number TEXT,
            legislation_year TEXT,
            category TEXT
        );
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS gi_issue_year_idx ON gazette_index(issue_year);`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS gi_category_idx ON gazette_index(category);`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS gi_leg_year_idx ON gazette_index(legislation_year);`);

    // Create FTS5 for gazette search
    sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS gazette_fts USING fts5(
            title,
            category,
            content='gazette_index',
            content_rowid='id',
            tokenize='unicode61 remove_diacritics 2'
        );
    `);

    // Load data from JSON if table is empty
    const giCount = sqlite.prepare("SELECT count(*) as cnt FROM gazette_index").get() as any;
    if (giCount.cnt === 0) {
        const dataPath = path.join(process.cwd(), "client", "public", "data", "gazette_index.json");
        if (fs.existsSync(dataPath)) {
            console.log("Loading gazette index data...");
            const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
            const insert = sqlite.prepare(`
                INSERT INTO gazette_index (issue_year, issue_number, title, legislation_number, legislation_year, category)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            const insertMany = sqlite.transaction((items: any[]) => {
                for (const item of items) {
                    insert.run(
                        item.issueYear || null,
                        item.issueNumber || null,
                        item.title || "",
                        item.legislationNumber || null,
                        item.legislationYear || null,
                        item.category || null
                    );
                }
            });
            insertMany(data);
            console.log(`Loaded ${data.length} gazette index records.`);

            // Populate FTS
            sqlite.exec(`INSERT INTO gazette_fts(rowid, title, category) SELECT id, title, category FROM gazette_index;`);
            console.log("Gazette FTS index populated.");
        }
    } else {
        // Check if FTS is populated
        const giFtsCount = sqlite.prepare("SELECT count(*) as cnt FROM gazette_fts").get() as any;
        if (giFtsCount.cnt === 0 && giCount.cnt > 0) {
            console.log("Populating gazette FTS index...");
            sqlite.exec(`INSERT INTO gazette_fts(rowid, title, category) SELECT id, title, category FROM gazette_index;`);
            console.log("Gazette FTS index populated.");
        }
    }
} catch (e: any) {
    console.warn("Gazette index setup:", e.message);
}

// ============================================
// Law Articles FTS5 Index (for unified search)
// ============================================
try {
    // Create a regular table to back the FTS content
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS law_articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            law_id TEXT NOT NULL,
            law_name TEXT NOT NULL,
            article_number INTEGER,
            article_text TEXT NOT NULL,
            article_heading TEXT
        );
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS la_law_id_idx ON law_articles(law_id);`);

    // Create FTS5 for law articles search
    sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS law_articles_fts USING fts5(
            law_id UNINDEXED,
            law_name,
            article_number UNINDEXED,
            article_text,
            article_heading,
            content='law_articles',
            content_rowid='id',
            tokenize='unicode61 remove_diacritics 2'
        );
    `);

    // Populate from law JSON files if table is empty
    const laCount = sqlite.prepare("SELECT count(*) as cnt FROM law_articles").get() as any;
    if (laCount.cnt === 0) {
        const libraryPath = path.join(process.cwd(), "client", "public", "data", "library.json");
        const lawsDir = path.join(process.cwd(), "client", "public", "data", "laws");

        if (fs.existsSync(libraryPath) && fs.existsSync(lawsDir)) {
            console.log("Building law articles FTS index... this may take a moment");
            const library = JSON.parse(fs.readFileSync(libraryPath, "utf-8"));

            const insert = sqlite.prepare(`
                INSERT INTO law_articles (law_id, law_name, article_number, article_text, article_heading)
                VALUES (?, ?, ?, ?, ?)
            `);

            let totalArticles = 0;
            const insertBatch = sqlite.transaction((articles: any[]) => {
                for (const a of articles) {
                    insert.run(a.law_id, a.law_name, a.article_number, a.article_text, a.article_heading);
                }
            });

            for (const item of library) {
                // Try to load law file with different suffixes
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

                if (lawData?.articles && Array.isArray(lawData.articles)) {
                    const batch = lawData.articles.map((article: any) => ({
                        law_id: item.id,
                        law_name: lawData.law_name || item.title_ar || "",
                        article_number: article.number || 0,
                        article_text: article.text || "",
                        article_heading: article.heading || "",
                    }));
                    if (batch.length > 0) {
                        insertBatch(batch);
                        totalArticles += batch.length;
                    }
                }
            }

            console.log(`Loaded ${totalArticles} law articles from ${library.length} laws.`);

            // Populate FTS from the backing table
            sqlite.exec(`
                INSERT INTO law_articles_fts(rowid, law_id, law_name, article_number, article_text, article_heading)
                SELECT id, law_id, law_name, article_number, article_text, article_heading FROM law_articles;
            `);
            console.log("Law articles FTS index populated.");
        }
    } else {
        // Check if FTS is populated
        const laFtsCount = sqlite.prepare("SELECT count(*) as cnt FROM law_articles_fts").get() as any;
        if (laFtsCount.cnt === 0 && laCount.cnt > 0) {
            console.log("Populating law articles FTS index...");
            sqlite.exec(`
                INSERT INTO law_articles_fts(rowid, law_id, law_name, article_number, article_text, article_heading)
                SELECT id, law_id, law_name, article_number, article_text, article_heading FROM law_articles;
            `);
            console.log("Law articles FTS index populated.");
        }
    }
} catch (e: any) {
    console.warn("Law articles FTS setup:", e.message);
}

// ============================================
// Search Analytics Tables
// ============================================
try {
    // Log every search query with results count
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS search_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL,
            query_normalized TEXT NOT NULL,
            result_count INTEGER DEFAULT 0,
            result_type TEXT DEFAULT 'all',
            time_taken INTEGER DEFAULT 0,
            has_results INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS sl_query_idx ON search_logs(query_normalized);`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS sl_created_idx ON search_logs(created_at);`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS sl_no_results_idx ON search_logs(has_results, created_at);`);

    // Track which result a user clicked after searching
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS search_clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL,
            result_type TEXT NOT NULL,
            result_id TEXT NOT NULL,
            result_position INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS sc_query_idx ON search_clicks(query);`);

    console.log("Search analytics tables ready.");
} catch (e: any) {
    console.warn("Search analytics setup:", e.message);
}

console.log(`Database connected: ${dbPath}`);
