
import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

async function main() {
    console.log("=== DATABASE INVESTIGATION & CLEANUP ===");
    const client = new pg.Client({ connectionString });
    await client.connect();

    try {
        // 1. List Databases
        const resDbs = await client.query("SELECT datname FROM pg_database WHERE datistemplate = false;");
        console.log("\n[Databases]:");
        resDbs.rows.forEach(r => console.log(` - ${r.datname}`));

        // 2. Identify DB with 'judgments'
        // We are connected to 'postgres' (from env). Let's check tables here.
        const resTables = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
        console.log(`\n[Tables in '${client.database}']:`);
        resTables.rows.forEach(r => console.log(` - ${r.table_schema}.${r.table_name}`));

        const hasJudgments = resTables.rows.some(r => r.table_name === 'judgments');
        if (!hasJudgments) {
            console.error("ERROR: 'judgments' table not found in current DB.");
            return;
        }

        // 3. Cleanup: Remove Footer
        // Pattern: Starts with "عن البوابة" ... contains "rc@moj.gov.sa" ... to end?
        // User sample: "... عن البوابة من نحن ... rc@moj.gov.sa جميع الحقوق محفوظة ..."
        // We'll trust the user's description.
        console.log("\n[Cleanup]: removing footer...");

        // Get count before
        const countBefore = await getCount(client);
        console.log(`Rows Before: ${countBefore}`);

        // Update with Regex
        // Note: Postgres regex '.' does usually not match newline unless 'n' flag used? 
        // Or we use [\s\S] equivalent.
        // Let's try to match the specific footer start.
        const footerMarker = 'عن البوابة';

        // We will update only rows containing the marker.
        // Using substring to chop off from the marker onwards might be safer/simpler if it's always at the end.
        // "UPDATE judgments SET text = left(text, position('عن البوابة' in text) - 1) WHERE text LIKE '%عن البوابة%'"
        const resUpdate = await client.query(`
      UPDATE judgments 
      SET text = substring(text from 1 for position($1 in text) - 1)
      WHERE text LIKE $2
        AND text LIKE '%rc@moj.gov.sa%' 
    `, [footerMarker, `%${footerMarker}%`]);

        console.log(`Updated (Trimmed Footer): ${resUpdate.rowCount} rows`);

        // 4. Purge remaining invalid
        // A) Empty/Short
        const criteriaA = `(text IS NULL OR trim(text) = '' OR length(trim(text)) < 50)`;
        // B) Loading
        const criteriaB = `(trim(text) ILIKE 'Loading...%' OR text ILIKE '%Large Spinner%')`;
        // C) Boilerplate (leftover)
        const markers = [
            'البوابة العدلية', 'وزارة العدل', 'جميع الحقوق محفوظة', 'rc@moj.gov.sa',
            'سياسة الخصوصية', 'شروط استخدام', 'خريطة الموقع'
        ];
        const markersSql = markers.map(m => `text ILIKE '%${m}%'`).join(' OR ');
        const criteriaC = `((${markersSql}) AND text NOT ILIKE '%نص الحكم%')`;

        // Execute Delete
        const resDelete = await client.query(`
      DELETE FROM judgments 
      WHERE ${criteriaA} OR ${criteriaB} OR ${criteriaC}
    `);
        console.log(`Deleted Invalid Rows: ${resDelete.rowCount}`);

        // Final Count
        const countAfter = await getCount(client);
        console.log(`Rows After: ${countAfter}`);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await client.end();
    }
}

async function getCount(client) {
    const res = await client.query("SELECT count(*) as c FROM judgments");
    return parseInt(res.rows[0].c);
}

main();
