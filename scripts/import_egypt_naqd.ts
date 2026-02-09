/**
 * Egyptian Court of Cassation (NAQD) Decisions Importer
 * Source: egypt_naqd_decisions (محكمة النقض المصرية)
 * Run: npx tsx scripts/import_egypt_naqd.ts
 */

import { db } from "../server/db";
import { judgments } from "../shared/schema";
import * as fs from "fs";
import * as path from "path";

const DETAILS_DIR = "C:\\Users\\Alemr\\Desktop\\egypt_naqd_decisions\\details";
const LOG_FILE = "C:\\Users\\Alemr\\Downloads\\Arabic-Legal-Platform-Clean\\Arabic-Legal-Platform\\import_eg.log";
const BATCH_SIZE = 50;
const PROGRESS_INTERVAL = 500;

function log(msg: string) {
    const line = msg + "\n";
    process.stdout.write(line);
    fs.appendFileSync(LOG_FILE, line);
}

function cleanHtml(rawHtml: string): string {
    if (!rawHtml) return "";
    let text = rawHtml.replace(/<[^>]*>/g, "");
    text = text
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&hellip;/g, "...")
        .replace(/&ndash;/g, "-")
        .replace(/&#\d+;/g, "");
    text = text.replace(/\s+/g, " ").trim();
    return text;
}

function formatElapsed(ms: number): string {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

async function main() {
    const startTime = Date.now();
    fs.writeFileSync(LOG_FILE, `=== Egyptian NAQD Import Started at ${new Date().toISOString()} ===\n`);

    log(`[EG] Reading directory: ${DETAILS_DIR}`);

    const files = fs.readdirSync(DETAILS_DIR).filter((f) => f.endsWith(".json"));
    const TOTAL = files.length;

    log(`[EG] Found ${TOTAL} JSON files`);
    log(`---`);

    let processed = 0;
    let ok = 0;
    let fail = 0;
    const batch: any[] = [];

    for (const file of files) {
        try {
            const filePath = path.join(DETAILS_DIR, file);
            const content = fs.readFileSync(filePath, "utf-8");
            const data = JSON.parse(content);

            const rawText = data["نص_الحكم"] || "";
            const cleanedText = cleanHtml(rawText);

            if (!cleanedText) {
                fail++;
            } else {
                // Extract year from السنة_القضائية
                const yearRaw = data["السنة_القضائية"];
                let yearHijri: number | null = null;
                if (yearRaw) {
                    const parsed = parseInt(yearRaw);
                    if (!isNaN(parsed)) yearHijri = parsed;
                }

                batch.push({
                    caseId: data["رقم_المرجع"] || file.replace(".json", ""),
                    yearHijri: yearHijri,
                    city: "القاهرة",
                    courtBody: "محكمة النقض المصرية",
                    circuitType: data["نوع_الطعن"] || null,
                    judgmentNumber: data["رقم_الطعن"] || null,
                    judgmentDate: data["تاريخ_الجلسة"] || null,
                    text: cleanedText,
                    source: "eg_naqd",
                    appealType: data["نوع_الطعن"] || null,
                });
                ok++;
            }

            processed++;

            if (batch.length >= BATCH_SIZE) {
                await db.insert(judgments).values(batch);
                batch.length = 0;
            }

            if (processed % PROGRESS_INTERVAL === 0 || processed === TOTAL) {
                const elapsed = Date.now() - startTime;
                const percent = ((processed / TOTAL) * 100).toFixed(1);
                const rate = (processed / (elapsed / 1000)).toFixed(1);
                log(`[EG] ${percent}% | ${processed}/${TOTAL} | ok=${ok} fail=${fail} | ${rate}/s | ${formatElapsed(elapsed)}`);
            }
        } catch (err: any) {
            fail++;
            processed++;
            if (processed % PROGRESS_INTERVAL === 0) {
                log(`[EG] ERROR in ${file}: ${err.message}`);
            }
        }
    }

    if (batch.length > 0) {
        await db.insert(judgments).values(batch);
    }

    const elapsed = Date.now() - startTime;
    log(`---`);
    log(`=== EGYPTIAN NAQD IMPORT COMPLETE ===`);
    log(`Imported: ${ok}`);
    log(`Skipped: ${fail}`);
    log(`Total files: ${TOTAL}`);
    log(`Duration: ${formatElapsed(elapsed)}`);

    process.exit(0);
}

main().catch((err) => {
    log(`[FATAL] ${err.message}`);
    process.exit(1);
});
