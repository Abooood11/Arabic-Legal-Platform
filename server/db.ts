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

console.log(`Database connected: ${dbPath}`);
