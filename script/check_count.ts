
import "dotenv/config";
import pg from "pg";
const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
async function main() {
    const client = new pg.Client({ connectionString });
    await client.connect();
    const res = await client.query("SELECT count(*) as c FROM judgments");
    console.log(`FINAL_COUNT: ${res.rows[0].c}`);
    await client.end();
}
main();
