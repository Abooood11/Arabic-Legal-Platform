/**
 * Clean Egyptian judgment texts from CSS, HTML artifacts, and junk metadata.
 * Run: npx tsx scripts/clean_egypt_text.ts
 */

import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data.db");
const db = new Database(dbPath);

function cleanText(text: string): string {
    let cleaned = text;

    // Remove CSS blocks: /* ... */ and everything inside them,
    // plus any CSS rules like .class { ... } and @media blocks
    cleaned = cleaned.replace(/\/\*[^]*?\*\//g, ""); // /* comments */
    cleaned = cleaned.replace(/\.\w[\w-]*\s*\{[^}]*\}/g, ""); // .class { ... }
    cleaned = cleaned.replace(/@media\s*\([^)]*\)\s*\{[^}]*\{[^}]*\}[^}]*\}/g, ""); // @media queries
    cleaned = cleaned.replace(/@media[^{]*\{[^}]*\}/g, ""); // simpler @media

    // Remove remaining CSS-like patterns
    cleaned = cleaned.replace(/\{[^}]*font-size[^}]*\}/g, "");
    cleaned = cleaned.replace(/\{[^}]*line-height[^}]*\}/g, "");
    cleaned = cleaned.replace(/\{[^}]*text-align[^}]*\}/g, "");

    // Remove metadata lines like "9 أشهر ago كريم القاضي الرقم المرجعي: 49867"
    cleaned = cleaned.replace(/\d+\s+(?:أشهر|أيام|ساعات?|سنوات?|أسابيع?)\s+ago\s+/g, "");

    // Remove "كريم القاضي" (author attribution from source site)
    cleaned = cleaned.replace(/كريم القاضي\s*/g, "");

    // Remove "الرقم المرجعي: XXXXX" (already stored in caseId)
    cleaned = cleaned.replace(/الرقم المرجعي:\s*\d+\s*/g, "");

    // Remove "قاعدة رقم" header duplicates (often appear at top)
    // Keep only the first occurrence if needed, but remove standalone ones at the very start
    const qaidaPattern = /^قاعدة رقم\s+/;
    if (qaidaPattern.test(cleaned.trim())) {
        // It's OK to keep this, it's part of the judgment
    }

    // Remove any remaining HTML tags that weren't cleaned during import
    cleaned = cleaned.replace(/<[^>]*>/g, "");

    // Remove HTML entities
    cleaned = cleaned.replace(/&nbsp;/g, " ");
    cleaned = cleaned.replace(/&lt;/g, "<");
    cleaned = cleaned.replace(/&gt;/g, ">");
    cleaned = cleaned.replace(/&amp;/g, "&");
    cleaned = cleaned.replace(/&quot;/g, '"');
    cleaned = cleaned.replace(/&#\d+;/g, "");

    // Clean up excessive whitespace
    cleaned = cleaned.replace(/[ \t]{2,}/g, " ");
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, "\n\n");
    cleaned = cleaned.trim();

    return cleaned;
}

console.log("Starting text cleanup for Egyptian judgments...");

const rows = db.prepare("SELECT id, text FROM judgments WHERE source = 'eg_naqd'").all() as { id: number; text: string }[];
console.log(`Found ${rows.length} Egyptian judgments`);

const updateStmt = db.prepare("UPDATE judgments SET text = ? WHERE id = ?");

let cleaned = 0;
let unchanged = 0;

const BATCH_SIZE = 1000;
let batchCount = 0;

const transaction = db.transaction((batch: { id: number; text: string }[]) => {
    for (const row of batch) {
        updateStmt.run(row.text, row.id);
    }
});

let batch: { id: number; text: string }[] = [];

for (const row of rows) {
    const cleanedText = cleanText(row.text);
    if (cleanedText !== row.text) {
        batch.push({ id: row.id, text: cleanedText });
        cleaned++;
    } else {
        unchanged++;
    }

    if (batch.length >= BATCH_SIZE) {
        transaction(batch);
        batch = [];
        batchCount++;
        if (batchCount % 5 === 0) {
            console.log(`  Progress: ${cleaned + unchanged}/${rows.length} processed, ${cleaned} cleaned`);
        }
    }
}

// Process remaining batch
if (batch.length > 0) {
    transaction(batch);
}

console.log(`\nDone!`);
console.log(`  Cleaned: ${cleaned}`);
console.log(`  Unchanged: ${unchanged}`);
console.log(`  Total: ${rows.length}`);

db.close();
process.exit(0);
