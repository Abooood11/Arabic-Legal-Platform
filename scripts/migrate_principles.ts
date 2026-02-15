/**
 * Migrate Principle Text from Original EMJ JSON Files
 * ====================================================
 * Reads the original scraped JSON files from scraper/data/ and populates
 * the new `principle_text` column in the judgments table for eg_naqd records.
 *
 * This script does NOT modify the existing `text` column.
 * It only adds the principle text as a separate column value.
 *
 * Usage:
 *   npx tsx scripts/migrate_principles.ts
 *
 * Options (env vars):
 *   DRY_RUN=1  - Parse and count without writing to DB
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const __script_dir = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    if (typeof __dirname !== "undefined") return __dirname;
    return path.join(process.cwd(), "scripts");
  }
})();

const PLATFORM_DIR = path.resolve(__script_dir, "..");
const DB_PATH = path.join(PLATFORM_DIR, "data.db");
const DEFAULT_EMJ_DIR = path.resolve(PLATFORM_DIR, "..", "scraper", "data");
const EMJ_DATA_DIR = process.env.EMJ_DATA_DIR || DEFAULT_EMJ_DIR;
const DRY_RUN = process.env.DRY_RUN === "1";

const SECTIONS = [
  "civil_cassation",
  "criminal_cassation",
  "constitutional",
  "economic",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlaceholder(s: string | null | undefined): boolean {
  if (!s) return true;
  const t = s.trim();
  return !t || t === "-" || t === "0" || t === "null" || t === '""' || t === "''";
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSec}s`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const totalStart = Date.now();

  console.log("=".repeat(70));
  console.log("  Principle Text Migration - EMJ Data");
  console.log("=".repeat(70));
  console.log(`  Database:  ${DB_PATH}`);
  console.log(`  EMJ Data:  ${EMJ_DATA_DIR}`);
  console.log(`  Dry Run:   ${DRY_RUN ? "YES" : "No"}`);
  console.log("=".repeat(70));
  console.log();

  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: Database not found at ${DB_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(EMJ_DATA_DIR)) {
    console.error(`ERROR: EMJ data directory not found at ${EMJ_DATA_DIR}`);
    process.exit(1);
  }

  // Open database
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("cache_size = -131072");
  sqlite.pragma("mmap_size = 536870912");
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("synchronous = NORMAL");

  // Verify principle_text column exists
  const cols = sqlite.prepare("PRAGMA table_info(judgments)").all() as any[];
  if (!cols.find((c: any) => c.name === "principle_text")) {
    console.error("ERROR: principle_text column does not exist in judgments table.");
    console.error("Start the server first to run the migration, or add it manually:");
    console.error("  ALTER TABLE judgments ADD COLUMN principle_text TEXT;");
    sqlite.close();
    process.exit(1);
  }

  // Check how many already have principle_text
  const alreadyDone = sqlite
    .prepare("SELECT count(*) as cnt FROM judgments WHERE source = 'eg_naqd' AND principle_text IS NOT NULL")
    .get() as any;
  console.log(`Already populated: ${alreadyDone.cnt} records\n`);

  // Build a map of source_id -> DB id for eg_naqd records
  // We use case_id since that's what source_id maps to
  console.log("Loading eg_naqd case_id -> id mapping...");
  const mapStart = Date.now();
  const rows = sqlite
    .prepare("SELECT id, case_id FROM judgments WHERE source = 'eg_naqd'")
    .all() as { id: number; case_id: string }[];

  const caseIdToDbId = new Map<string, number>();
  for (const row of rows) {
    caseIdToDbId.set(row.case_id, row.id);
  }
  console.log(`  Loaded ${caseIdToDbId.size} mappings in ${formatElapsed(Date.now() - mapStart)}\n`);

  // Prepare update statement
  const updateStmt = sqlite.prepare(
    "UPDATE judgments SET principle_text = ? WHERE id = ?"
  );

  // Batch update in transactions
  const BATCH_SIZE = 1000;
  let batch: { principle: string; dbId: number }[] = [];

  const flushBatch = sqlite.transaction((items: { principle: string; dbId: number }[]) => {
    for (const item of items) {
      updateStmt.run(item.principle, item.dbId);
    }
  });

  // Stats
  const stats = {
    totalJsonRecords: 0,
    matched: 0,
    updated: 0,
    skippedPlaceholder: 0,
    skippedNotInDb: 0,
    skippedAlreadySet: 0,
    perSection: {} as Record<string, { records: number; updated: number; skipped: number; notInDb: number }>,
  };

  // Process each section
  for (const section of SECTIONS) {
    const sectionDir = path.join(EMJ_DATA_DIR, section);
    if (!fs.existsSync(sectionDir)) {
      console.warn(`WARNING: ${sectionDir} not found -- skipping`);
      continue;
    }

    const sectionStart = Date.now();
    const secStats = { records: 0, updated: 0, skipped: 0, notInDb: 0 };

    const files = fs
      .readdirSync(sectionDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    console.log(`--- ${section} (${files.length} files) ---`);

    for (const file of files) {
      const filePath = path.join(sectionDir, file);
      let data: any[];
      try {
        data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch (e: any) {
        console.warn(`  Error reading ${file}: ${e.message}`);
        continue;
      }

      for (const record of data) {
        stats.totalJsonRecords++;
        secStats.records++;

        const sourceId = String(record.source_id);
        const principleText = (record.principle_text || "").trim();

        // Skip empty/placeholder principles
        if (isPlaceholder(principleText)) {
          stats.skippedPlaceholder++;
          secStats.skipped++;
          continue;
        }

        // Find matching DB record
        const dbId = caseIdToDbId.get(sourceId);
        if (dbId === undefined) {
          stats.skippedNotInDb++;
          secStats.notInDb++;
          continue;
        }

        stats.matched++;
        secStats.updated++;

        if (!DRY_RUN) {
          batch.push({ principle: principleText, dbId });
          if (batch.length >= BATCH_SIZE) {
            flushBatch(batch);
            stats.updated += batch.length;
            batch = [];
          }
        }
      }
    }

    // Flush remaining batch for this section
    if (!DRY_RUN && batch.length > 0) {
      flushBatch(batch);
      stats.updated += batch.length;
      batch = [];
    }

    stats.perSection[section] = secStats;
    console.log(
      `  ${secStats.records} records | ${secStats.updated} updated | ` +
      `${secStats.skipped} placeholder | ${secStats.notInDb} not in DB | ` +
      `${formatElapsed(Date.now() - sectionStart)}`
    );
  }

  // Final stats
  console.log();
  console.log("=".repeat(70));
  console.log("  Migration Summary");
  console.log("=".repeat(70));
  console.log(`  Total JSON records:        ${stats.totalJsonRecords.toLocaleString()}`);
  console.log(`  Matched & updated:         ${stats.updated.toLocaleString()}`);
  console.log(`  Skipped (placeholder):     ${stats.skippedPlaceholder.toLocaleString()}`);
  console.log(`  Skipped (not in DB):       ${stats.skippedNotInDb.toLocaleString()}`);
  console.log(`  Total time:                ${formatElapsed(Date.now() - totalStart)}`);

  if (DRY_RUN) {
    console.log();
    console.log("  *** DRY RUN - no changes written to database ***");
    console.log(`  Would update: ${stats.matched.toLocaleString()} records`);
  }

  // Verify
  if (!DRY_RUN) {
    const finalCount = sqlite
      .prepare("SELECT count(*) as cnt FROM judgments WHERE source = 'eg_naqd' AND principle_text IS NOT NULL")
      .get() as any;
    console.log();
    console.log(`  Verification: ${finalCount.cnt.toLocaleString()} eg_naqd records now have principle_text`);
  }

  console.log("=".repeat(70));

  sqlite.close();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
