import pg from "pg";

// Try standard default: postgres:postgres
const connectionString = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

console.log(`Connecting to ${connectionString}...`);

const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 3000,
});

pool.connect().then(client => {
    console.log("Connected successfully to LOCAL DB");
    client.release();
    process.exit(0);
}).catch(e => {
    console.error("Connection failed:", e.message);
    process.exit(1);
});
