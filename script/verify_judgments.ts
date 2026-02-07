
import "dotenv/config";
import { db } from "../server/db";
import { judgments } from "../shared/models/judgments";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Verifying Judgments Data...");

    // 1. Check Count
    const [countRes] = await db.select({ count: sql<number>`count(*)` }).from(judgments);
    const count = Number(countRes.count);
    console.log(`Total Judgments in DB: ${count}`);

    if (count === 0) {
        console.error("FAILED: No judgments found.");
        process.exit(1);
    }

    // 2. Check Sample Data Integrity
    const [sample] = await db.select().from(judgments).limit(1);
    if (!sample) {
        console.error("FAILED: Could not fetch sample.");
        process.exit(1);
    }
    console.log("Sample Judgment:", {
        id: sample.id,
        city: sample.city,
        year: sample.yearHijri,
        textLength: sample.text.length
    });

    if (!sample.text || sample.text.length < 10) {
        console.error("FAILED: Sample text is missing or too short.");
        process.exit(1);
    }

    console.log("SUCCESS: Data verification passed.");
    process.exit(0);
}

main().catch(console.error);
