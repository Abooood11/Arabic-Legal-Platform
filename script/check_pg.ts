import pg from "pg";

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
});

pool.connect().then(client => {
    console.log("Connected successfully");
    client.release();
    process.exit(0);
}).catch(e => {
    console.error("Connection failed:", e);
    process.exit(1);
});
