/**
 * EMJ (Egyptian Legal Encyclopedia) Import Script
 * ================================================
 * Imports scraped Egyptian court rulings into the Arabic Legal Platform's
 * SQLite database (judgments table) with source='eg_naqd'.
 *
 * Sections:
 *   - civil_cassation:    ~266,634 rulings (1928-2022)
 *   - criminal_cassation: ~287,352 rulings (1928-2022)
 *   - constitutional:     ~7,133  rulings (1958-2022)
 *   - economic:           ~1,185  rulings (2009-2015)
 *
 * Usage:
 *   npx tsx scripts/import_emj_rulings.ts
 *
 * Options (env vars):
 *   EMJ_DATA_DIR  - Override default path to scraped data
 *   BATCH_SIZE    - Override default batch size (default: 500)
 *   DRY_RUN=1     - Parse and validate without writing to DB
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Resolve PLATFORM_DIR: use the script file's location when available,
// otherwise fall back to process.cwd() (which should be the platform root).
const __script_dir = (() => {
  try {
    // Works when tsx runs the file directly (import.meta.url is set)
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    // Fallback: __dirname is available in CJS context
    if (typeof __dirname !== "undefined") return __dirname;
    // Last resort
    return path.join(process.cwd(), "scripts");
  }
})();

const PLATFORM_DIR = path.resolve(__script_dir, "..");
const DB_PATH = path.join(PLATFORM_DIR, "data.db");
const DEFAULT_EMJ_DIR = path.resolve(PLATFORM_DIR, "..", "scraper", "data");
const EMJ_DATA_DIR = process.env.EMJ_DATA_DIR || DEFAULT_EMJ_DIR;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "500", 10);
const DRY_RUN = process.env.DRY_RUN === "1";

const SECTIONS = [
  "civil_cassation",
  "criminal_cassation",
  "constitutional",
  "economic",
] as const;

type SectionName = (typeof SECTIONS)[number];

const COURT_BODY_MAP: Record<SectionName, string> = {
  civil_cassation: "محكمة النقض - الدوائر المدنية",
  criminal_cassation: "محكمة النقض - الدوائر الجنائية",
  constitutional: "المحكمة الدستورية العليا",
  economic: "محكمة النقض - الدوائر الاقتصادية",
};

// ---------------------------------------------------------------------------
// EMJ JSON row type
// ---------------------------------------------------------------------------

interface EmjRuling {
  source_id: string;
  section_id: number;
  section_name: string;
  case_number: string;
  case_year: string;
  session_date: string;
  court_ruling: string;
  has_principle: boolean;
  principle_text: string;
  facts_text: string;
  page_no: string;
  part_no: string;
  pdf_path: string;
  country_id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSec}s`;
}

/** Build the text column from principle_text + facts_text. */
function buildText(ruling: EmjRuling): string {
  const principle = (ruling.principle_text || "").trim();
  const facts = (ruling.facts_text || "").trim();

  // Skip placeholder values
  const isPlaceholder = (s: string) => !s || s === "-" || s === "0" || s === "null";

  if (isPlaceholder(principle) && isPlaceholder(facts)) {
    // Edge case: no text at all. Use a minimal placeholder so NOT NULL constraint is met.
    return `حكم رقم ${ruling.case_number} لسنة ${ruling.case_year} - ${ruling.session_date}`;
  }

  if (isPlaceholder(principle)) return facts;
  if (isPlaceholder(facts)) return principle;

  // If principle and facts are identical (common in the data), just use one copy
  if (principle === facts) return principle;

  return principle + "\n\n" + facts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const totalStart = Date.now();

  console.log("=".repeat(70));
  console.log("  EMJ Import Script - Egyptian Legal Encyclopedia");
  console.log("=".repeat(70));
  console.log(`  Database:   ${DB_PATH}`);
  console.log(`  EMJ Data:   ${EMJ_DATA_DIR}`);
  console.log(`  Batch Size: ${BATCH_SIZE}`);
  console.log(`  Dry Run:    ${DRY_RUN ? "YES" : "No"}`);
  console.log("=".repeat(70));
  console.log();

  // Validate paths
  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: Database not found at ${DB_PATH}`);
    console.error("Make sure the platform has been initialized first (npm run dev).");
    process.exit(1);
  }
  if (!fs.existsSync(EMJ_DATA_DIR)) {
    console.error(`ERROR: EMJ data directory not found at ${EMJ_DATA_DIR}`);
    process.exit(1);
  }

  // Open database
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("cache_size = -131072"); // 128MB cache for bulk import
  sqlite.pragma("mmap_size = 536870912"); // 512MB mmap
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("synchronous = OFF"); // Faster for bulk import (safe because WAL + single writer)

  // Ensure judgments table exists
  const tableCheck = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='judgments'")
    .get() as any;
  if (!tableCheck) {
    console.error("ERROR: 'judgments' table does not exist. Run the platform first to create it.");
    sqlite.close();
    process.exit(1);
  }

  // Build a set of existing source_ids for dedup (only eg_naqd ones)
  console.log("Loading existing eg_naqd case_ids for deduplication...");
  const existingRows = sqlite
    .prepare("SELECT case_id FROM judgments WHERE source = 'eg_naqd'")
    .all() as { case_id: string }[];
  const existingIds = new Set(existingRows.map((r) => r.case_id));
  console.log(`  Found ${existingIds.size} existing Egyptian rulings in database.\n`);

  // Prepare insert statement
  const insertStmt = sqlite.prepare(`
    INSERT INTO judgments (case_id, year_hijri, city, court_body, circuit_type,
                           judgment_number, judgment_date, text, source,
                           appeal_type, judges)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Wrap batch inserts in a transaction
  const insertBatch = sqlite.transaction(
    (rows: {
      caseId: string;
      courtBody: string;
      circuitType: string;
      judgmentNumber: string;
      judgmentDate: string;
      text: string;
      appealType: string;
    }[]) => {
      for (const row of rows) {
        insertStmt.run(
          row.caseId,
          null,           // year_hijri (Egyptian = Gregorian)
          null,           // city
          row.courtBody,
          row.circuitType,
          row.judgmentNumber,
          row.judgmentDate,
          row.text,
          "eg_naqd",     // source
          row.appealType,
          null            // judges
        );
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Process each section
  // ---------------------------------------------------------------------------

  const stats = {
    totalFiles: 0,
    totalRead: 0,
    totalInserted: 0,
    totalSkipped: 0,
    totalErrors: 0,
    perSection: {} as Record<string, { files: number; read: number; inserted: number; skipped: number; errors: number }>,
  };

  for (const section of SECTIONS) {
    const sectionDir = path.join(EMJ_DATA_DIR, section);
    if (!fs.existsSync(sectionDir)) {
      console.warn(`WARNING: Section directory not found: ${sectionDir} -- skipping`);
      continue;
    }

    const courtBody = COURT_BODY_MAP[section];
    const sectionStart = Date.now();

    console.log(`----- ${section} (${courtBody}) -----`);

    // Find all year JSON files
    const files = fs
      .readdirSync(sectionDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    if (files.length === 0) {
      console.log("  No JSON files found.\n");
      continue;
    }

    const sectionStats = { files: files.length, read: 0, inserted: 0, skipped: 0, errors: 0 };

    for (const file of files) {
      const year = path.basename(file, ".json");
      const filePath = path.join(sectionDir, file);

      let rulings: EmjRuling[];
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        rulings = JSON.parse(raw);
        if (!Array.isArray(rulings)) {
          console.warn(`  WARNING: ${file} is not an array -- skipping`);
          sectionStats.errors++;
          continue;
        }
      } catch (err: any) {
        console.error(`  ERROR: Failed to parse ${file}: ${err.message}`);
        sectionStats.errors++;
        continue;
      }

      sectionStats.read += rulings.length;

      // Filter out duplicates
      const newRulings: typeof rulings = [];
      for (const ruling of rulings) {
        if (!ruling.source_id) {
          sectionStats.errors++;
          continue;
        }
        if (existingIds.has(ruling.source_id)) {
          sectionStats.skipped++;
          continue;
        }
        newRulings.push(ruling);
      }

      if (newRulings.length === 0) {
        process.stdout.write(`  ${year}: ${rulings.length} read, 0 new (all skipped)\r`);
        continue;
      }

      if (!DRY_RUN) {
        // Insert in batches
        for (let i = 0; i < newRulings.length; i += BATCH_SIZE) {
          const batch = newRulings.slice(i, i + BATCH_SIZE);
          const rows = batch.map((ruling) => ({
            caseId: ruling.source_id,
            courtBody,
            circuitType: ruling.section_name || section,
            judgmentNumber: ruling.case_number || "",
            judgmentDate: ruling.session_date || "",
            text: buildText(ruling),
            appealType: ruling.court_ruling || "",
          }));

          try {
            insertBatch(rows);
            sectionStats.inserted += rows.length;
            // Mark as existing so subsequent files don't try to re-insert
            for (const ruling of batch) {
              existingIds.add(ruling.source_id);
            }
          } catch (err: any) {
            console.error(`\n  ERROR inserting batch for ${year}: ${err.message}`);
            sectionStats.errors += rows.length;
          }
        }
      } else {
        sectionStats.inserted += newRulings.length;
      }

      process.stdout.write(
        `  ${year}: ${rulings.length} read, ${newRulings.length} new` +
        `${DRY_RUN ? " (dry run)" : ""}\n`
      );
    }

    const sectionElapsed = Date.now() - sectionStart;
    console.log(
      `  => ${section}: ${sectionStats.inserted} inserted, ${sectionStats.skipped} skipped, ` +
      `${sectionStats.errors} errors (${formatElapsed(sectionElapsed)})\n`
    );

    stats.totalFiles += sectionStats.files;
    stats.totalRead += sectionStats.read;
    stats.totalInserted += sectionStats.inserted;
    stats.totalSkipped += sectionStats.skipped;
    stats.totalErrors += sectionStats.errors;
    stats.perSection[section] = sectionStats;
  }

  // ---------------------------------------------------------------------------
  // Rebuild FTS index
  // ---------------------------------------------------------------------------

  if (!DRY_RUN && stats.totalInserted > 0) {
    console.log("Rebuilding FTS index for judgments...");
    const ftsStart = Date.now();

    try {
      // Check if the FTS table exists
      const ftsExists = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='judgments_fts'")
        .get();

      if (ftsExists) {
        // Delete all FTS content and rebuild from scratch
        // This is more reliable than trying to insert only new rows,
        // since the FTS content table is linked by rowid.
        sqlite.exec("DELETE FROM judgments_fts;");
        sqlite.exec(
          "INSERT INTO judgments_fts(rowid, text, court_body) SELECT id, text, court_body FROM judgments;"
        );
        const ftsCount = sqlite
          .prepare("SELECT count(*) as cnt FROM judgments_fts")
          .get() as any;
        console.log(`  FTS index rebuilt: ${ftsCount.cnt} entries (${formatElapsed(Date.now() - ftsStart)})`);
      } else {
        console.log("  WARNING: judgments_fts table not found. FTS will be built on next server start.");
      }
    } catch (err: any) {
      console.error(`  ERROR rebuilding FTS: ${err.message}`);
      console.error("  FTS will be rebuilt automatically on next server start.");
    }
  } else if (DRY_RUN) {
    console.log("Dry run -- FTS rebuild skipped.\n");
  } else {
    console.log("No new rulings inserted -- FTS rebuild not needed.\n");
  }

  // ---------------------------------------------------------------------------
  // Create indexes that help Egyptian data queries (if not already present)
  // ---------------------------------------------------------------------------

  if (!DRY_RUN && stats.totalInserted > 0) {
    try {
      sqlite.exec("CREATE INDEX IF NOT EXISTS judgment_date_idx ON judgments(judgment_date);");
      sqlite.exec("CREATE INDEX IF NOT EXISTS case_id_source_idx ON judgments(case_id, source);");
      console.log("  Additional indexes ensured.\n");
    } catch (err: any) {
      console.warn(`  Index creation note: ${err.message}\n`);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const totalElapsed = Date.now() - totalStart;
  const finalCount = DRY_RUN
    ? "(dry run)"
    : (sqlite.prepare("SELECT count(*) as cnt FROM judgments").get() as any).cnt;
  const egCount = DRY_RUN
    ? "(dry run)"
    : (sqlite.prepare("SELECT count(*) as cnt FROM judgments WHERE source = 'eg_naqd'").get() as any).cnt;
  const saCount = DRY_RUN
    ? "(dry run)"
    : (sqlite.prepare("SELECT count(*) as cnt FROM judgments WHERE source = 'sa_judicial'").get() as any).cnt;

  sqlite.close();

  console.log("=".repeat(70));
  console.log("  IMPORT COMPLETE");
  console.log("=".repeat(70));
  console.log();
  console.log("  Per-section breakdown:");
  for (const section of SECTIONS) {
    const s = stats.perSection[section];
    if (!s) continue;
    console.log(
      `    ${section.padEnd(22)} ${s.files.toString().padStart(3)} files | ` +
      `${s.read.toLocaleString().padStart(8)} read | ` +
      `${s.inserted.toLocaleString().padStart(8)} inserted | ` +
      `${s.skipped.toLocaleString().padStart(8)} skipped | ` +
      `${s.errors.toLocaleString().padStart(5)} errors`
    );
  }
  console.log();
  console.log(`  Total files processed: ${stats.totalFiles}`);
  console.log(`  Total rulings read:    ${stats.totalRead.toLocaleString()}`);
  console.log(`  Total inserted:        ${stats.totalInserted.toLocaleString()}`);
  console.log(`  Total skipped (dupes): ${stats.totalSkipped.toLocaleString()}`);
  console.log(`  Total errors:          ${stats.totalErrors.toLocaleString()}`);
  console.log();
  console.log(`  Database totals:`);
  console.log(`    Egyptian (eg_naqd):    ${egCount.toLocaleString?.() || egCount}`);
  console.log(`    Saudi (sa_judicial):   ${saCount.toLocaleString?.() || saCount}`);
  console.log(`    Total judgments:       ${finalCount.toLocaleString?.() || finalCount}`);
  console.log();
  console.log(`  Time elapsed: ${formatElapsed(totalElapsed)}`);
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
