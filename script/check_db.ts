import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function check() {
    try {
        const result = await db.execute(sql`SELECT to_regclass('public.judgments')`);
        console.log("Table exists check:", result.rows[0]);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
