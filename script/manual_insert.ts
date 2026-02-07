
import "dotenv/config";
import { db } from "../server/db";
import { judgments } from "../shared/models/judgments";

async function main() {
    console.log("Attempting manual insert...");
    try {
        await db.insert(judgments).values({
            caseId: "MANUAL-001",
            text: "Manual insert test",
            city: "Debug City"
        });
        console.log("Insert successful.");
        process.exit(0);
    } catch (e) {
        console.error("Insert failed:", e);
        process.exit(1);
    }
}
main();
