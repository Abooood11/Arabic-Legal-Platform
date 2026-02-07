import { pgTable, varchar, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const articleOverrides = pgTable("article_overrides", {
  lawId: varchar("law_id").notNull(),
  articleNumber: varchar("article_number").notNull(),
  overrideText: text("override_text").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: varchar("updated_by").notNull(),
}, (table) => [
  primaryKey({ columns: [table.lawId, table.articleNumber] })
]);

export type ArticleOverride = typeof articleOverrides.$inferSelect;
export type InsertArticleOverride = typeof articleOverrides.$inferInsert;
