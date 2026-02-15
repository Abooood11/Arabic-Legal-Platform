/**
 * Import CRSD Judicial Principles into the platform database
 * المبادئ القضائية - لجنة الاستئناف في منازعات الأوراق المالية
 *
 * Sections:
 *   civil (المبادئ المدنية) - 111 principles
 *   penalty (المبادئ الجزائية) - 80 principles
 *   administrative (المبادئ الإدارية) - 29 principles
 *   public (المبادئ القضائية العامة) - 133 principles
 *   Total: 353 principles
 *
 * Usage: npx tsx scripts/import_crsd_principles.ts
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data.db");
const DATA_DIR = path.join(process.cwd(), "..", "scraper", "data", "crsd_principles");

const SECTIONS = [
    { file: "civil.json", section: "civil", sectionAr: "المبادئ المدنية" },
    { file: "penalty.json", section: "penalty", sectionAr: "المبادئ الجزائية" },
    { file: "administrative.json", section: "administrative", sectionAr: "المبادئ الإدارية" },
    { file: "public.json", section: "public", sectionAr: "المبادئ القضائية العامة" },
];

function main() {
    console.log("=== CRSD Principles Importer ===\n");

    // Connect to database
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Create table if not exists
    db.exec(`
        CREATE TABLE IF NOT EXISTS crsd_principles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section TEXT NOT NULL,
            section_ar TEXT NOT NULL,
            principle_text TEXT NOT NULL,
            decision_numbers TEXT,
            source TEXT NOT NULL DEFAULT 'crsd_appeal_committee',
            source_ar TEXT NOT NULL DEFAULT 'لجنة الاستئناف في منازعات الأوراق المالية',
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS crsd_section_idx ON crsd_principles(section);`);
    db.exec(`CREATE INDEX IF NOT EXISTS crsd_source_idx ON crsd_principles(source);`);

    // Create FTS5 virtual table
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS crsd_principles_fts USING fts5(
            principle_text,
            section_ar,
            content='crsd_principles',
            content_rowid='id',
            tokenize='unicode61 remove_diacritics 2'
        );
    `);

    // Check existing data
    const existingCount = (db.prepare("SELECT count(*) as cnt FROM crsd_principles").get() as any).cnt;
    if (existingCount > 0) {
        console.log(`Found ${existingCount} existing principles. Clearing for fresh import...`);
        db.exec("DELETE FROM crsd_principles;");
        db.exec("DELETE FROM crsd_principles_fts;");
    }

    // Prepare insert statement
    const insert = db.prepare(`
        INSERT INTO crsd_principles (section, section_ar, principle_text, decision_numbers, source, source_ar)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    let grandTotal = 0;

    // Process each section
    const insertBatch = db.transaction((principles: any[], section: string, sectionAr: string) => {
        for (const p of principles) {
            insert.run(
                section,
                sectionAr,
                p.principle_text,
                JSON.stringify(p.decision_numbers || []),
                p.source || "crsd_appeal_committee",
                p.source_ar || "لجنة الاستئناف في منازعات الأوراق المالية"
            );
        }
    });

    for (const sec of SECTIONS) {
        const filePath = path.join(DATA_DIR, sec.file);
        if (!fs.existsSync(filePath)) {
            console.log(`  SKIP: ${sec.file} not found`);
            continue;
        }

        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        console.log(`  Importing ${sec.sectionAr} (${sec.section}): ${data.length} principles...`);

        insertBatch(data, sec.section, sec.sectionAr);
        grandTotal += data.length;
        console.log(`    Done.`);
    }

    // Populate FTS index
    console.log("\nPopulating FTS5 index...");
    db.exec(`
        INSERT INTO crsd_principles_fts(rowid, principle_text, section_ar)
        SELECT id, principle_text, section_ar FROM crsd_principles;
    `);

    // Verify
    const finalCount = (db.prepare("SELECT count(*) as cnt FROM crsd_principles").get() as any).cnt;
    const ftsCount = (db.prepare("SELECT count(*) as cnt FROM crsd_principles_fts").get() as any).cnt;

    console.log(`\n=== Import Complete ===`);
    console.log(`Total principles: ${finalCount}`);
    console.log(`FTS index entries: ${ftsCount}`);

    // Show breakdown
    const sections = db.prepare("SELECT section, section_ar, count(*) as count FROM crsd_principles GROUP BY section ORDER BY count DESC").all() as any[];
    console.log("\nBreakdown by section:");
    for (const s of sections) {
        console.log(`  ${s.section_ar} (${s.section}): ${s.count}`);
    }

    // Test FTS search
    console.log("\nTesting FTS search...");
    const testResults = db.prepare(`
        SELECT p.id, p.section_ar, substr(p.principle_text, 1, 80) as preview
        FROM crsd_principles p
        INNER JOIN crsd_principles_fts fts ON p.id = fts.rowid
        WHERE crsd_principles_fts MATCH 'تعويض'
        LIMIT 3
    `).all() as any[];
    console.log(`  Search 'تعويض': ${testResults.length} results`);
    for (const r of testResults) {
        console.log(`    [${r.section_ar}] ${r.preview}...`);
    }

    db.close();
    console.log("\nDatabase closed. Import successful!");
}

main();
