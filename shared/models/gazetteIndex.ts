import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const gazetteIndex = sqliteTable(
    "gazette_index",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        issueYear: integer("issue_year"),
        issueNumber: text("issue_number"),
        title: text("title").notNull(),
        legislationNumber: text("legislation_number"),
        legislationYear: text("legislation_year"),
        category: text("category"),
    },
    (table) => ({
        issueYearIdx: index("gi_issue_year_idx").on(table.issueYear),
        categoryIdx: index("gi_category_idx").on(table.category),
        legYearIdx: index("gi_leg_year_idx").on(table.legislationYear),
    })
);

export const insertGazetteIndexSchema = createInsertSchema(gazetteIndex);
export const selectGazetteIndexSchema = createSelectSchema(gazetteIndex);

export type GazetteIndexItem = typeof gazetteIndex.$inferSelect;
export type InsertGazetteIndexItem = typeof gazetteIndex.$inferInsert;
