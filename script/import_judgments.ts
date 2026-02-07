
import fs from "fs";
import "dotenv/config";
import path from "path";
import { db } from "../server/db";
import { judgments, insertJudgmentSchema } from "../shared/models/judgments";
import { parse } from "csv-parse";
import { z } from "zod";

const CSV_FILE = "judgments_antigravity.csv";

async function main() {
    const filePath = path.resolve(process.cwd(), CSV_FILE);

    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found at ${filePath}`);
        // Create a dummy file for verification if it doesn't exist, to demonstrate the script works conceptually
        // But better to fail so user knows to provide it.
        process.exit(1);
    }

    console.log("Starting import...");

    const records: any[] = [];
    const parser = fs.createReadStream(filePath).pipe(parse({
        columns: (header) => header.map((h: string) => h.trim()), // Trim headers
        trim: true, // Trim cell values
        skip_empty_lines: true
    }));

    for await (const row of parser) {
        // CSV columns: id, case_id, year_hijri, city, court_body, circuit_type, judgment_number, judgment_date, text
        // We map generic CSV columns to our schema

        const record: any = {
            caseId: row.case_id || row.id, // Fallback to id if case_id missing or same? Assuming case_id is the key.
            yearHijri: row.year_hijri ? parseInt(row.year_hijri) : null,
            city: row.city || null,
            courtBody: row.court_body || null,
            circuitType: row.circuit_type || null,
            judgmentNumber: row.judgment_number || null,
            judgmentDate: row.judgment_date || null,
            text: row.text || ""
        };

        records.push(record);
    }

    console.log(`Parsed ${records.length} records.`);

    // Validate and clean
    const validRecords = [];

    // Get existing IDs to avoid duplicates if we want to be safe, or just rely on DB constraints (we don't have unique constraint on caseId in schema yet unless primary key).
    // Schema has `id` as serial primary key. `caseId` is varchar.
    // Ideally `caseId` should be unique.

    for (const record of records) {
        if (!record.caseId || !record.text) {
            console.log(`Skipping invalid record: ${JSON.stringify(record).substring(0, 100)}...`);
            continue;
        }

        try {
            const validated = insertJudgmentSchema.parse(record);
            validRecords.push(validated);
        } catch (e) {
            console.error(`Validation error for caseId ${record.caseId}:`, e);
        }
    }

    console.log(`Valid records: ${validRecords.length}. Inserting into DB...`);

    if (validRecords.length === 0) {
        console.log("No valid records to insert.");
        process.exit(0);
    }

    // Batch insert
    const BATCH_SIZE = 100;
    for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
        const batch = validRecords.slice(i, i + BATCH_SIZE);
        try {
            await db.insert(judgments).values(batch);
            console.log(`Inserted batch ${Math.min(i + BATCH_SIZE, validRecords.length)}/${validRecords.length}`);
        } catch (e) {
            console.error("Error inserting batch:", e);
        }
    }

    console.log("Import complete.");
    process.exit(0);
}

main().catch(console.error);
