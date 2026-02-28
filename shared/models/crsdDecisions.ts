import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const crsdDecisions = sqliteTable(
    "crsd_decisions",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        decisionNumber: integer("decision_number").notNull(),
        committee: text("committee").notNull(),              // 'resolutions' | 'appeals'
        committeeAr: text("committee_ar").notNull(),          // لجنة الفصل | لجنة الاستئناف
        caseType: text("case_type"),                          // civil, criminal, administrative (nullable)
        caseTypeAr: text("case_type_ar"),                     // مدني, جزائي, إداري (nullable)
        decisionDate: text("decision_date"),                  // Hijri date (normalized)
        decisionDateRaw: text("decision_date_raw"),           // Date as it appeared in text
        yearHijri: integer("year_hijri"),                     // Hijri year for filtering
        fullText: text("full_text").notNull(),                // Cleaned display text
        fullTextRaw: text("full_text_raw"),                   // Raw OCR text (for auditing)
        pageCount: integer("page_count"),                     // Source PDF page count
        pdfUrl: text("pdf_url").notNull(),                    // URL to original PDF
        pdfSha256: text("pdf_sha256"),                        // PDF file hash
        ocrConfidence: real("ocr_confidence"),                 // Average page similarity
        autoPass: integer("auto_pass", { mode: "boolean" }).default(false),
        needsReview: integer("needs_review", { mode: "boolean" }).default(false),
        qualityJson: text("quality_json"),                    // Full quality metrics JSON
        createdAt: text("created_at").notNull().default("(datetime('now'))"),
    },
    (table) => ({
        decisionNumIdx: index("crsd_dec_number_idx").on(table.decisionNumber),
        committeeIdx: index("crsd_dec_committee_idx").on(table.committee),
        caseTypeIdx: index("crsd_dec_case_type_idx").on(table.caseType),
        yearIdx: index("crsd_dec_year_idx").on(table.yearHijri),
        autoPassIdx: index("crsd_dec_auto_pass_idx").on(table.autoPass),
        reviewIdx: index("crsd_dec_review_idx").on(table.needsReview),
    })
);

export const insertCrsdDecisionSchema = createInsertSchema(crsdDecisions);
export const selectCrsdDecisionSchema = createSelectSchema(crsdDecisions);

export type CrsdDecision = typeof crsdDecisions.$inferSelect;
export type InsertCrsdDecision = typeof crsdDecisions.$inferInsert;
