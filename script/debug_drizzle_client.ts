
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { sql } from "drizzle-orm";

const connectionString = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

async function main() {
    console.log("Connecting via Drizzle Client...");
    const client = new pg.Client({ connectionString });
    await client.connect();
    console.log("Client connected.");

    const db = drizzle(client);

    try {
        const result = await db.execute(sql`SELECT 1`);
        console.log("Drizzle SELECT 1 success:", result.rows);
        await client.end();
        process.exit(0);
    } catch (e) {
        console.error("Drizzle failed:", e);
        await client.end();
        process.exit(1);
    }
}

main().catch(console.error);
