/**
 * Migration Script: Extract and populate judges from existing judgments
 * Run: npx tsx scripts/migrate_judges.ts
 */

import { db } from "../server/db";
import { judgments } from "../shared/schema";
import { extractJudges } from "../client/src/lib/judgment-parser";
import { eq } from "drizzle-orm";

const BATCH_SIZE = 100;

async function migrateJudges() {
    console.log("🔄 Starting judges migration...\n");

    // Get all Saudi judgments (judges extraction only works for Saudi)
    const allJudgments = await db
        .select({ id: judgments.id, text: judgments.text })
        .from(judgments)
        .where(eq(judgments.source, "sa_judicial"))
        .all();

    console.log(`📊 Found ${allJudgments.length} Saudi judgments\n`);

    let updated = 0;
    let withJudges = 0;
    let noJudges = 0;

    for (let i = 0; i < allJudgments.length; i += BATCH_SIZE) {
        const batch = allJudgments.slice(i, i + BATCH_SIZE);

        for (const judgment of batch) {
            const judgesData = extractJudges(judgment.text, "sa_judicial");

            await db
                .update(judgments)
                .set({ judges: judgesData })
                .where(eq(judgments.id, judgment.id))
                .execute();

            updated++;

            if (judgesData && judgesData.length > 0) {
                withJudges++;
            } else {
                noJudges++;
            }
        }

        const progress = ((i + batch.length) / allJudgments.length * 100).toFixed(1);
        console.log(`✅ Progress: ${progress}% | Updated: ${updated} | With judges: ${withJudges} | No judges: ${noJudges}`);
    }

    console.log("\n🎉 Migration complete!");
    console.log(`📈 Summary:`);
    console.log(`   Total processed: ${updated}`);
    console.log(`   With judges: ${withJudges} (${(withJudges / updated * 100).toFixed(1)}%)`);
    console.log(`   Without judges: ${noJudges} (${(noJudges / updated * 100).toFixed(1)}%)`);

    process.exit(0);
}

migrateJudges().catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
});
