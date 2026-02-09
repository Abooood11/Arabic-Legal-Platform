/**
 * Fix Egyptian court_body field in existing judgments.
 * Extracts the real court name from the judgment text.
 * Run: npx tsx scripts/fix_egypt_courts.ts
 */

import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data.db");
const db = new Database(dbPath);

const COURT_PATTERNS: { pattern: RegExp; name: string }[] = [
    { pattern: /المحكمة الإدارية العليا/, name: "المحكمة الإدارية العليا" },
    { pattern: /المحكمة الدستورية العليا/, name: "المحكمة الدستورية العليا" },
    { pattern: /محكمة القضاء الإداري/, name: "محكمة القضاء الإداري" },
    { pattern: /المحكمة التأديبية/, name: "المحكمة التأديبية" },
    { pattern: /محكمة النقض/, name: "محكمة النقض" },
];

function extractCourt(text: string): string {
    const header = text.substring(0, 800);
    for (const court of COURT_PATTERNS) {
        if (court.pattern.test(header)) {
            return court.name;
        }
    }
    // Fallback: check whole text
    for (const court of COURT_PATTERNS) {
        if (court.pattern.test(text)) {
            return court.name;
        }
    }
    return "محكمة النقض المصرية";
}

console.log("Starting court_body fix for Egyptian judgments...");

const rows = db.prepare("SELECT id, text FROM judgments WHERE source = 'eg_naqd'").all() as { id: number; text: string }[];
console.log(`Found ${rows.length} Egyptian judgments`);

const updateStmt = db.prepare("UPDATE judgments SET court_body = ? WHERE id = ?");

const counts: Record<string, number> = {};
let updated = 0;

const transaction = db.transaction(() => {
    for (const row of rows) {
        const court = extractCourt(row.text);
        if (court !== "محكمة النقض المصرية") {
            updateStmt.run(court, row.id);
            updated++;
        }
        counts[court] = (counts[court] || 0) + 1;
    }
});

transaction();

console.log(`\nCourt distribution:`);
for (const [court, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${court}: ${count}`);
}
console.log(`\nUpdated ${updated} records`);

db.close();
process.exit(0);
