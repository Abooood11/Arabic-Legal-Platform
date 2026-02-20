import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const judgments = sqliteTable(
    "judgments",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        caseId: text("case_id").notNull(),
        yearHijri: integer("year_hijri"),
        city: text("city"),
        courtBody: text("court_body"),
        circuitType: text("circuit_type"),
        judgmentNumber: text("judgment_number"),
        judgmentDate: text("judgment_date"),
        text: text("text").notNull(),
        principleText: text("principle_text"),
        source: text("source").notNull().default("sa_judicial"),
        appealType: text("appeal_type"),
        judges: text("judges", { mode: "json" }).$type<{ role: string; name: string }[]>(),
        pdfUrl: text("pdf_url"),
        createdAt: text("created_at").notNull().default("(datetime('now'))"),
    },
    (table) => ({
        cityIdx: index("city_idx").on(table.city),
        yearIdx: index("year_idx").on(table.yearHijri),
        courtBodyIdx: index("court_body_idx").on(table.courtBody),
        sourceIdx: index("source_idx").on(table.source),
    })
);

export const insertJudgmentSchema = createInsertSchema(judgments);
export const selectJudgmentSchema = createSelectSchema(judgments);

export type Judgment = typeof judgments.$inferSelect;
export type InsertJudgment = typeof judgments.$inferInsert;
