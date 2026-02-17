/**
 * Fix flattened tables in UQN law JSON files.
 *
 * Problem: The UQN scraper sometimes flattens HTML <table> elements into
 * individual paragraphs (one per cell), losing the table structure.
 *
 * This script detects flattened tables and reconstructs them as proper
 * { type: "table", table_rows: [...] } paragraph objects.
 *
 * Detection heuristic:
 * 1. Find a paragraph containing "جدول" (table)
 * 2. After it (possibly after a subtitle), find 3-6 consecutive short paragraphs
 *    that look like column headers
 * 3. Verify that subsequent paragraphs follow the same column count pattern
 * 4. Reconstruct into a table object
 *
 * Usage:
 *   node scripts/fix-flattened-tables.js                    # dry-run (report only)
 *   node scripts/fix-flattened-tables.js --fix               # fix all detected
 *   node scripts/fix-flattened-tables.js --fix --file=uqn_28552_uqn.json  # fix one file
 */

const fs = require("fs");
const path = require("path");

const LAWS_DIR = path.join(__dirname, "../client/public/data/laws");
const DIST_DIR = path.join(__dirname, "../dist/public/data/laws");

const args = process.argv.slice(2);
const dryRun = !args.includes("--fix");
const fileFilter = args.find(a => a.startsWith("--file="))?.split("=")[1];

// Common table header keywords
const TABLE_HEADER_KEYWORDS = [
  "الرقم", "م", "رقم", "#",
  "المخالفة", "العقوبة", "الغرامة", "قيمة",
  "الشركة", "المنتجة", "المصدرة",
  "دولة", "المنشأ", "التصدير",
  "النسبة", "المبلغ", "المقابل",
  "المادة", "النص", "التعديل",
  "المدى", "الوصف", "البند", "الفئة",
  "اسم", "عنوان", "صفة",
];

function isLikelyTableHeader(texts) {
  if (texts.length < 3 || texts.length > 8) return false;
  // Most headers should be short
  const shortCount = texts.filter(t => t.length < 40).length;
  if (shortCount < texts.length * 0.6) return false;
  // At least one should match a known header keyword
  const hasKeyword = texts.some(t =>
    TABLE_HEADER_KEYWORDS.some(kw => t.includes(kw))
  );
  return hasKeyword;
}

function detectFlattenedTable(paragraphs, startIdx) {
  // Skip the title paragraph (it has "جدول")
  let headerStart = startIdx + 1;

  // Skip subtitle continuation if present
  while (headerStart < paragraphs.length) {
    const t = (paragraphs[headerStart].text || "").trim();
    if (t.length > 60 || t.includes("أكسيد") || t.includes("محضرات") || t.includes("المستخدم")) {
      headerStart++;
    } else {
      break;
    }
  }

  // Try different column counts (3 to 7)
  for (let numCols = 3; numCols <= 7; numCols++) {
    if (headerStart + numCols > paragraphs.length) continue;

    // Extract candidate headers
    const headerTexts = [];
    let valid = true;
    for (let i = 0; i < numCols; i++) {
      const p = paragraphs[headerStart + i];
      const t = (p.text || "").trim();
      if (!t || p.marker) { valid = false; break; }
      headerTexts.push(t);
    }
    if (!valid) continue;
    if (!isLikelyTableHeader(headerTexts)) continue;

    // Count how many complete rows follow
    let rowStart = headerStart + numCols;
    let numRows = 0;
    while (rowStart + numCols <= paragraphs.length) {
      let isRow = true;
      for (let i = 0; i < numCols; i++) {
        const p = paragraphs[rowStart + i];
        const t = (p.text || "").trim();
        // Allow empty text but paragraph must exist
        if (p.marker && p.marker.length > 3) { isRow = false; break; }
      }
      if (!isRow) break;
      numRows++;
      rowStart += numCols;
    }

    if (numRows >= 2) {
      return {
        titleIdx: startIdx,
        headerStart,
        numCols,
        numRows,
        headerTexts,
        endIdx: headerStart + numCols + numRows * numCols,
      };
    }
  }

  return null;
}

function reconstructTable(paragraphs, detection) {
  const { headerStart, numCols, numRows } = detection;
  const rows = [];

  // Header row
  const headerRow = [];
  for (let i = 0; i < numCols; i++) {
    headerRow.push((paragraphs[headerStart + i].text || "").trim());
  }
  rows.push(headerRow);

  // Data rows
  for (let r = 0; r < numRows; r++) {
    const row = [];
    const rowStart = headerStart + numCols + r * numCols;
    for (let c = 0; c < numCols; c++) {
      row.push((paragraphs[rowStart + c].text || "").trim());
    }
    rows.push(row);
  }

  return rows;
}

function processFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = JSON.parse(raw);
  if (!doc.articles) return null;

  const fixes = [];

  doc.articles.forEach((article, artIdx) => {
    if (!article.paragraphs || article.paragraphs.length < 8) return;

    // Find paragraphs with "جدول"
    for (let i = 0; i < article.paragraphs.length - 5; i++) {
      const text = (article.paragraphs[i].text || "").trim();
      if (!text.includes("جدول") && !text.includes("الجدول")) continue;

      const detection = detectFlattenedTable(article.paragraphs, i);
      if (detection) {
        fixes.push({
          artIdx,
          detection,
          tableRows: reconstructTable(article.paragraphs, detection),
        });
        // Skip past this table to avoid double-detection
        i = detection.endIdx;
      }
    }
  });

  return fixes.length > 0 ? { doc, fixes } : null;
}

function applyFixes(doc, fixes) {
  // Apply fixes in reverse order so indices don't shift
  const sortedFixes = [...fixes].sort((a, b) => {
    if (a.artIdx !== b.artIdx) return b.artIdx - a.artIdx;
    return b.detection.headerStart - a.detection.headerStart;
  });

  for (const fix of sortedFixes) {
    const article = doc.articles[fix.artIdx];
    const { headerStart, endIdx } = fix.detection;

    // Create the table paragraph object
    const tablePara = {
      marker: "",
      text: "",
      level: 0,
      type: "table",
      table_rows: fix.tableRows,
    };

    // Replace the header + data paragraphs with a single table paragraph
    // Keep the title paragraph (before headerStart) and anything after endIdx
    const before = article.paragraphs.slice(0, headerStart);
    const after = article.paragraphs.slice(endIdx);
    article.paragraphs = [...before, tablePara, ...after];
  }

  return doc;
}

// Main
function main() {
  console.log(`=== Flattened Table Fixer ===`);
  console.log(`Mode: ${dryRun ? "DRY RUN (use --fix to apply)" : "FIXING"}`);
  console.log("");

  const files = fs.readdirSync(LAWS_DIR)
    .filter(f => f.endsWith(".json"))
    .filter(f => !fileFilter || f === fileFilter);

  console.log(`Scanning ${files.length} files...`);

  let totalFixed = 0;
  let totalTables = 0;

  for (const file of files) {
    const filePath = path.join(LAWS_DIR, file);
    const result = processFile(filePath);

    if (result) {
      const { doc, fixes } = result;
      totalTables += fixes.length;

      console.log(`\n${file}:`);
      console.log(`  Title: ${(doc.title || "").substring(0, 70)}`);

      for (const fix of fixes) {
        console.log(`  Art ${fix.artIdx}: ${fix.detection.numCols} cols x ${fix.detection.numRows + 1} rows`);
        console.log(`    Headers: ${fix.detection.headerTexts.join(" | ")}`);
      }

      if (!dryRun) {
        const fixed = applyFixes(doc, fixes);
        fs.writeFileSync(filePath, JSON.stringify(fixed, null, 2), "utf8");

        // Also update dist if it exists
        const distPath = path.join(DIST_DIR, file);
        if (fs.existsSync(distPath)) {
          fs.writeFileSync(distPath, JSON.stringify(fixed, null, 2), "utf8");
        }

        totalFixed++;
        console.log(`  -> FIXED`);
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Tables detected: ${totalTables}`);
  console.log(`Files ${dryRun ? "would be fixed" : "fixed"}: ${totalFixed}`);
}

main();
