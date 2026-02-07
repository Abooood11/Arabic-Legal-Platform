
import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

async function main() {
    console.log("Truncating judgments table...");
    const client = new pg.Client({ connectionString });
    await client.connect();

    try {
        await client.query("TRUNCATE TABLE judgments RESTART IDENTITY CASCADE");
        console.log("Table truncated.");
    } catch (e) {
        console.error("Truncate failed:", e);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
