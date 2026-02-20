/**
 * إدراج أحكام وزارة العدل (مركز البحوث) في قاعدة البيانات
 * ====================================================
 *
 * المصدر: مجموعة الأحكام القضائية لعام 1435هـ
 * العدد: ~1,138 حكم من 13 مجلد
 * المعرف: source = 'moj_research'
 *
 * الاستخدام:
 *   npx tsx scripts/moj_judgments/import_moj_judgments.ts
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, "../../data.db");
const JSON_PATH = path.resolve(__dirname, "output/all_moj_judgments.json");

interface MojJudgment {
    volume: number;
    serial_in_volume: number;
    case_id: string;
    case_number_raw: string;
    year_hijri: number;
    city: string;
    court_body: string;
    circuit_type: string;
    judgment_number: string;
    judgment_date: string;
    appeal_court: string;
    appeal_date: string;
    appeal_decision_number: string;
    text: string;
    summary: string;
    keywords: string;
    legal_basis: string;
    source: string;
    pdf_url: string;
    pdf_start_page: number;
    pdf_end_page: number;
    page_count: number;
}

function main() {
    // التحقق من وجود الملفات
    if (!fs.existsSync(JSON_PATH)) {
        console.error(`✗ ملف الأحكام غير موجود: ${JSON_PATH}`);
        console.error("  شغّل سكربت الاستخراج أولاً: python extract_moj_judgments.py");
        process.exit(1);
    }

    if (!fs.existsSync(DB_PATH)) {
        console.error(`✗ قاعدة البيانات غير موجودة: ${DB_PATH}`);
        process.exit(1);
    }

    // قراءة الأحكام
    console.log("📂 قراءة ملف الأحكام...");
    const judgments: MojJudgment[] = JSON.parse(
        fs.readFileSync(JSON_PATH, "utf-8")
    );
    console.log(`   ${judgments.length} حكم`);

    // فتح قاعدة البيانات
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000"); // 64MB cache

    // التحقق من وجود عمود pdf_url
    const columns = db.pragma("table_info(judgments)") as { name: string }[];
    const hasPdfUrl = columns.some((c) => c.name === "pdf_url");

    if (!hasPdfUrl) {
        console.log("📋 إضافة عمود pdf_url إلى جدول judgments...");
        db.exec("ALTER TABLE judgments ADD COLUMN pdf_url TEXT");
        console.log("   ✓ تمت الإضافة");
    }

    // حذف الأحكام القديمة من نفس المصدر (إن وجدت)
    const existing = db
        .prepare("SELECT COUNT(*) as count FROM judgments WHERE source = ?")
        .get("moj_research") as { count: number };

    if (existing.count > 0) {
        console.log(`⚠ يوجد ${existing.count} حكم سابق من نفس المصدر`);
        console.log("   جاري الحذف وإعادة الإدراج...");
        db.prepare("DELETE FROM judgments WHERE source = ?").run("moj_research");
    }

    // إعداد الإدراج
    const insertStmt = db.prepare(`
        INSERT INTO judgments (
            case_id, year_hijri, city, court_body, circuit_type,
            judgment_number, judgment_date, text, principle_text,
            source, appeal_type, judges, pdf_url
        ) VALUES (
            @case_id, @year_hijri, @city, @court_body, @circuit_type,
            @judgment_number, @judgment_date, @text, @principle_text,
            @source, @appeal_type, @judges, @pdf_url
        )
    `);

    // إدراج في معاملة واحدة (سريع جداً)
    console.log("\n💾 جاري الإدراج في قاعدة البيانات...");
    let inserted = 0;
    let errors = 0;

    const insertAll = db.transaction(() => {
        for (const j of judgments) {
            try {
                // تنظيف النص
                const cleanText = j.text
                    ?.replace(/\ufffd/g, "")
                    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
                    .trim();

                if (!cleanText || cleanText.length < 100) {
                    console.log(
                        `   ⚠ تم تخطي حكم قصير جداً: ${j.case_id} (${cleanText?.length || 0} حرف)`
                    );
                    errors++;
                    continue;
                }

                // بناء ملخص كنص المبدأ
                const principleText = [
                    j.summary || "",
                    j.keywords ? `الكلمات المفتاحية: ${j.keywords}` : "",
                    j.legal_basis ? `السند النظامي: ${j.legal_basis}` : "",
                ].filter(Boolean).join("\n\n") || null;

                insertStmt.run({
                    case_id: j.case_id,
                    year_hijri: j.year_hijri || 1435,
                    city: j.city || null,
                    court_body: j.court_body || null,
                    circuit_type: j.circuit_type || null,
                    judgment_number: j.judgment_number || null,
                    judgment_date: j.judgment_date || null,
                    text: cleanText,
                    principle_text: principleText,
                    source: "moj_research",
                    appeal_type: j.circuit_type || null,
                    judges: null, // لا يوجد معلومات قضاة في هذا المصدر
                    pdf_url: j.pdf_url || null,
                });

                inserted++;
            } catch (e) {
                console.error(`   ✗ خطأ في ${j.case_id}: ${e}`);
                errors++;
            }
        }
    });

    insertAll();

    // تحديث FTS5
    console.log("\n📑 تحديث فهرس البحث النصي (FTS5)...");
    try {
        // إعادة بناء FTS5 للأحكام الجديدة
        db.exec("INSERT INTO judgments_fts(judgments_fts) VALUES('rebuild')");
        console.log("   ✓ تم تحديث الفهرس");
    } catch (e) {
        console.log(`   ⚠ تحذير FTS5: ${e}`);
        console.log("   قد يحتاج إعادة بناء يدوي");
    }

    // إحصائيات
    const totalCount = db
        .prepare("SELECT COUNT(*) as count FROM judgments")
        .get() as { count: number };

    const mojCount = db
        .prepare("SELECT COUNT(*) as count FROM judgments WHERE source = ?")
        .get("moj_research") as { count: number };

    const sourceStats = db
        .prepare(
            "SELECT source, COUNT(*) as count FROM judgments GROUP BY source ORDER BY count DESC"
        )
        .all() as { source: string; count: number }[];

    console.log("\n" + "=".repeat(50));
    console.log("  النتائج النهائية");
    console.log("=".repeat(50));
    console.log(`  تم إدراج: ${inserted} حكم`);
    console.log(`  أخطاء: ${errors}`);
    console.log(`  إجمالي أحكام وزارة العدل: ${mojCount.count}`);
    console.log(`  إجمالي كل الأحكام: ${totalCount.count}`);
    console.log(`\n  التوزيع حسب المصدر:`);
    for (const s of sourceStats) {
        console.log(`    ${s.source}: ${s.count.toLocaleString()}`);
    }

    db.close();
    console.log("\n✓ تم بنجاح!");
}

main();
