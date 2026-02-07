
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { sql } from "drizzle-orm";

const connectionString = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

async function main() {
    console.log("Connecting via Drizzle...");
    const pool = new pg.Pool({ connectionString });
    const db = drizzle(pool);

    try {
        const result = await db.execute(sql`SELECT 1`);
        console.log("Drizzle SELECT 1 success:", result.rows);
        process.exit(0);
    } catch (e) {
        console.error("Drizzle failed:", e);
        process.exit(1);
    }
}

main();
