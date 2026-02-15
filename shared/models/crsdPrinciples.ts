import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const crsdPrinciples = sqliteTable(
    "crsd_principles",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        section: text("section").notNull(),        // civil, penalty, administrative, public
        sectionAr: text("section_ar").notNull(),   // المبادئ المدنية, المبادئ الجزائية, etc.
        principleText: text("principle_text").notNull(),
        decisionNumbers: text("decision_numbers", { mode: "json" }).$type<string[]>(),
        source: text("source").notNull().default("crsd_appeal_committee"),
        sourceAr: text("source_ar").notNull().default("لجنة الاستئناف في منازعات الأوراق المالية"),
        createdAt: text("created_at").notNull().default("(datetime('now'))"),
    },
    (table) => ({
        sectionIdx: index("crsd_section_idx").on(table.section),
        sourceIdx: index("crsd_source_idx").on(table.source),
    })
);

export const insertCrsdPrincipleSchema = createInsertSchema(crsdPrinciples);
export const selectCrsdPrincipleSchema = createSelectSchema(crsdPrinciples);

export type CrsdPrinciple = typeof crsdPrinciples.$inferSelect;
export type InsertCrsdPrinciple = typeof crsdPrinciples.$inferInsert;
