import { pgTable, text, serial, integer, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const judgments = pgTable(
    "judgments",
    {
        id: serial("id").primaryKey(),
        caseId: varchar("case_id").notNull(),
        yearHijri: integer("year_hijri"),
        city: varchar("city"),
        courtBody: varchar("court_body"),
        circuitType: varchar("circuit_type"),
        judgmentNumber: varchar("judgment_number"),
        judgmentDate: varchar("judgment_date"), // Keeping as string as dates might be Hijri or varying formats
        text: text("text").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        // Indexes for common filters
        cityIdx: index("city_idx").on(table.city),
        yearIdx: index("year_idx").on(table.yearHijri),
        courtBodyIdx: index("court_body_idx").on(table.courtBody),
        // Full text search index would ideally be:
        // searchIdx: index("search_idx").using("gin", sql`to_tsvector('arabic', ${table.text})`),
        // keeping it simple for now, relying on ILIKE or external search if needed later.
    })
);

export const insertJudgmentSchema = createInsertSchema(judgments);
export const selectJudgmentSchema = createSelectSchema(judgments);

export type Judgment = typeof judgments.$inferSelect;
export type InsertJudgment = typeof judgments.$inferInsert;
