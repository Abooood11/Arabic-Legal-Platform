import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const errorReports = sqliteTable("error_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lawId: text("law_id").notNull(),
  articleNumber: integer("article_number").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  resolvedAt: text("resolved_at"),
});

export const insertErrorReportSchema = createInsertSchema(errorReports).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
  status: true,
});

export type InsertErrorReport = z.infer<typeof insertErrorReportSchema>;
export type ErrorReport = typeof errorReports.$inferSelect;
