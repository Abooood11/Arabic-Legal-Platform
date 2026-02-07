
import "dotenv/config";
import { db } from "../server/db";
import { judgments } from "../shared/models/judgments";
import { sql, isNotNull, eq } from "drizzle-orm";

async function main() {
    console.log("=== FINAL VERIFICATION ===");

    // 1. Total Count
    const [countRes] = await db.select({ count: sql<number>`count(*)` }).from(judgments);
    const count = Number(countRes.count);
    console.log(`Total Judgments: ${count}`);

    if (count < 100) {
        console.error("WARNING: Low record count. Import might be incomplete.");
    }

    // 2. Check for missing text
    const [nullTextRes] = await db.select({ count: sql<number>`count(*)` })
        .from(judgments)
        .where(sql`text IS NULL OR length(text) < 10`);
    const badRows = Number(nullTextRes.count);
    if (badRows > 0) {
        console.error(`WARNING: ${badRows} rows have missing or short text.`);
    } else {
        console.log("Data Quality Check: All rows have valid text.");
    }

    // 3. Sample Date Year Distribution (Top 5)
    const yearStats = await db.select({
        year: judgments.yearHijri,
        count: sql<number>`count(*)`
    })
        .from(judgments)
        .groupBy(judgments.yearHijri)
        .orderBy(sql`count(*) DESC`)
        .limit(5);

    console.log("Year Distribution (Top 5):");
    console.table(yearStats);

    // 4. Sample Record
    const [sample] = await db.select().from(judgments).limit(1);
    console.log("\nSample Record:");
    console.log(`- Case ID: ${sample.caseId}`);
    console.log(`- City: ${sample.city}`);
    console.log(`- Text Length: ${sample.text.length}`);
    console.log(`- Preview: ${sample.text.substring(0, 100)}...`);

    process.exit(0);
}

main().catch(console.error);
