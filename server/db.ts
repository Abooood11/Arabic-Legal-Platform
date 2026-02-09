import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data.db");
const sqlite = new Database(dbPath);

// Enable WAL mode for better performance
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

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

console.log(`Database connected: ${dbPath}`);
