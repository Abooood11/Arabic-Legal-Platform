/**
 * Saudi Judicial Decisions Importer
 * Source: judicial_decisions (Ministry of Justice - Saudi Arabia)
 * Run: npx tsx scripts/import_judgments.ts
 */

import { db } from "../server/db";
import { judgments } from "../shared/schema";
import { extractJudges } from "../client/src/lib/judgment-parser";
import * as fs from "fs";
import * as path from "path";

const DETAILS_DIR = "C:\\Users\\Alemr\\Desktop\\judicial_decisions\\details";
const LOG_FILE = "C:\\Users\\Alemr\\Downloads\\Arabic-Legal-Platform-Clean\\Arabic-Legal-Platform\\import_sa.log";
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
    fs.writeFileSync(LOG_FILE, `=== Saudi Import Started at ${new Date().toISOString()} ===\n`);

    log(`[SA] Reading directory: ${DETAILS_DIR}`);

    const files = fs.readdirSync(DETAILS_DIR).filter((f) => f.endsWith(".json"));
    const TOTAL = files.length;

    log(`[SA] Found ${TOTAL} JSON files`);
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

            const basic = data.basic || {};
            const details = data.details || {};

            const rawText = details.judgmentTextofRulling || "";
            const cleanedText = cleanHtml(rawText);

            if (!cleanedText) {
                fail++;
            } else {
                const judgesData = extractJudges(cleanedText, "sa_judicial");
                batch.push({
                    caseId: basic.caseNumber || file.replace(".json", ""),
                    yearHijri: basic.hijriYear || null,
                    city: basic.city || null,
                    courtBody: basic.courtName || null,
                    circuitType: basic.courtType ? String(basic.courtType) : null,
                    judgmentNumber: basic.judgementNumber || null,
                    judgmentDate: basic.judgementDate || null,
                    text: cleanedText,
                    source: "sa_judicial",
                    appealType: null,
                    judges: judgesData,
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
                log(`[SA] ${percent}% | ${processed}/${TOTAL} | ok=${ok} fail=${fail} | ${rate}/s | ${formatElapsed(elapsed)}`);
            }
        } catch (err: any) {
            fail++;
            processed++;
            if (processed % PROGRESS_INTERVAL === 0) {
                log(`[SA] ERROR in ${file}: ${err.message}`);
            }
        }
    }

    if (batch.length > 0) {
        await db.insert(judgments).values(batch);
    }

    const elapsed = Date.now() - startTime;
    log(`---`);
    log(`=== SAUDI IMPORT COMPLETE ===`);
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
