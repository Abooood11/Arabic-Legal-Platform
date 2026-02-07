
import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

async function main() {
    console.log("Starting PURGE of invalid judgments...");
    const client = new pg.Client({ connectionString });
    await client.connect();

    try {
        await client.query("BEGIN");

        // 1. Get initial count
        const resStart = await client.query("SELECT count(*) as c FROM judgments");
        const initialCount = parseInt(resStart.rows[0].c);
        console.log(`Initial Total Rows: ${initialCount}`);

        // Criteria A: Empty / missing / < 50 chars
        // text IS NULL OR trim(text) = '' OR length(trim(text)) < 50
        const criteriaA = `
      (text IS NULL OR trim(text) = '' OR length(trim(text)) < 50)
    `;

        // Criteria B: "Loading..." placeholders
        // trim(text) ILIKE 'Loading...%' OR text ILIKE '%Large Spinner%'
        const criteriaB = `
      (trim(text) ILIKE 'Loading...%' OR text ILIKE '%Large Spinner%')
    `;

        // Criteria C: MOJ portal boilerplate
        // Contains boilerplate markers AND does NOT contain 'نص الحكم'
        const markers = [
            'البوابة العدلية',
            'وزارة العدل',
            'جميع الحقوق محفوظة',
            'rc@moj.gov.sa',
            'سياسة الخصوصية',
            'شروط استخدام',
            'خريطة الموقع'
        ];
        // generating OR conditions for markers
        const markersSql = markers.map(m => `text ILIKE '%${m}%'`).join(' OR ');

        const criteriaC = `
      ((${markersSql}) AND text NOT ILIKE '%نص الحكم%')
    `;

        // We need to count and delete.
        // Ideally we delete and capture the count, but we want distinct counts per category for reporting.
        // Some rows might match multiple (unlikely given the definitions, but possible). 
        // We will prioritize A -> B -> C for categorization if overlap, or just count disjointly.
        // Simplest is to run DELETEs sequentially and count deleted rows.

        // Delete A
        const resA = await client.query(`DELETE FROM judgments WHERE ${criteriaA}`);
        console.log(`Deleted Category A (Empty/Short): ${resA.rowCount}`);

        // Delete B
        const resB = await client.query(`DELETE FROM judgments WHERE ${criteriaB}`);
        console.log(`Deleted Category B (Placeholders): ${resB.rowCount}`);

        // Delete C
        const resC = await client.query(`DELETE FROM judgments WHERE ${criteriaC}`);
        console.log(`Deleted Category C (Boilerplate): ${resC.rowCount}`);

        const totalDeleted = (resA.rowCount || 0) + (resB.rowCount || 0) + (resC.rowCount || 0);
        console.log(`Total Deleted: ${totalDeleted}`);

        // Commit
        await client.query("COMMIT");

        // Final count
        const resEnd = await client.query("SELECT count(*) as c FROM judgments");
        const finalCount = parseInt(resEnd.rows[0].c);
        console.log(`Final Total Rows: ${finalCount}`);

    } catch (e) {
        await client.query("ROLLBACK");
        console.error("Purge failed:", e);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main().catch(console.error);
