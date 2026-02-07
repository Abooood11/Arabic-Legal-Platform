
import fs from "fs";
import "dotenv/config";
import path from "path";
import pg from "pg";
import { parse } from "csv-parse";

// Hardcode connection string or use env (env might be issue if not loaded?)
// But we load dotenv/config.
const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const CSV_FILE = "judgments_antigravity.csv";
const BATCH_SIZE = 1000;

async function main() {
    const filePath = path.resolve(process.cwd(), CSV_FILE);
    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found at ${filePath}`);
        process.exit(1);
    }

    console.log("Starting Optimized PG import...");
    console.log("Connecting to DB...");
    const client = new pg.Client({ connectionString });
    await client.connect();

    console.log("Processing CSV...");

    let batch: any[][] = [];
    let totalInserted = 0;
    let batchCount = 0;

    const parser = fs.createReadStream(filePath).pipe(parse({
        columns: (header) => header.map((h: string) => h.trim()),
        trim: true,
        skip_empty_lines: true
    }));

    for await (const row of parser) {
        const record = [
            row.case_id || row.id,
            row.year_hijri ? parseInt(row.year_hijri) : null,
            row.city || null,
            row.court_body || null,
            row.circuit_type || null,
            row.judgment_number || null,
            row.judgment_date || null,
            row.text || ""
        ];

        batch.push(record);

        if (batch.length >= BATCH_SIZE) {
            await insertBatch(client, batch);
            totalInserted += batch.length;
            batchCount++;
            process.stdout.write(`\rInserted: ${totalInserted} (Batch ${batchCount})`);
            batch = [];
        }
    }

    if (batch.length > 0) {
        await insertBatch(client, batch);
        totalInserted += batch.length;
        console.log(`\rInserted: ${totalInserted} (Final Batch)`);
    }

    console.log("\nImport complete.");
    await client.end();
    process.exit(0);
}

async function insertBatch(client: pg.Client, rows: any[][]) {
    if (rows.length === 0) return;

    // Generate placeholders: ($1, $2, ...), ($9, $10, ...), ...
    const values: any[] = [];
    const placeholders: string[] = [];

    let paramIndex = 1;
    const columnsPerRecord = rows[0].length;

    for (const row of rows) {
        const rowPlaceholders: string[] = [];
        for (const val of row) {
            rowPlaceholders.push(`$${paramIndex++}`);
            values.push(val);
        }
        placeholders.push(`(${rowPlaceholders.join(',')}, NOW())`);
    }

    const query = `
    INSERT INTO judgments (
      case_id, year_hijri, city, court_body, circuit_type, judgment_number, judgment_date, text, created_at
    ) VALUES ${placeholders.join(',')}
  `;

    try {
        await client.query(query, values);
    } catch (e) {
        console.error("\nBatch Insert Error:", e);
    }
}

main().catch(console.error);
