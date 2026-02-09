import { sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

export const articleOverrides = sqliteTable("article_overrides", {
  lawId: text("law_id").notNull(),
  articleNumber: text("article_number").notNull(),
  overrideText: text("override_text").notNull(),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
  updatedBy: text("updated_by").notNull(),
}, (table) => [
  primaryKey({ columns: [table.lawId, table.articleNumber] })
]);

export type ArticleOverride = typeof articleOverrides.$inferSelect;
export type InsertArticleOverride = typeof articleOverrides.$inferInsert;
