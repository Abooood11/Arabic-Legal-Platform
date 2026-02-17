import { z } from "zod";

// ============================================
// DATA SCHEMAS (Matches JSON structure)
// ============================================

export const sourceSchema = z.object({
  id: z.string(),
  name_ar: z.string(),
  type: z.enum(["official", "legal-gazette", "archive", "guide"]),
  base_url: z.string().url().optional(),
});

export const libraryItemSchema = z.object({
  id: z.string(),
  title_ar: z.string(),
  jurisdiction_ar: z.string(),
  doc_type: z.enum(["official_text", "rights_reserved"]),
  category: z.enum(["law", "regulation", "decision", "guide", "gazette"]),
  primary_source_id: z.string(),
  links: z.array(z.object({
    source_id: z.string(),
    url: z.string(),
    label_ar: z.string().optional()
  })),
  notes_ar: z.string().optional(),
  laws_included: z.array(z.string()).optional(),
});

export const relatedArticleSchema = z.object({
  no: z.number(),
  score: z.number(),
  reasons_ar: z.array(z.string())
});

export const crossSimilarSchema = z.object({
  country_code: z.string(),
  country_ar: z.string(),
  law_name_ar: z.string(),
  article_no: z.union([z.number(), z.string()]),
  article_text_ar: z.string(),
  similarity_score: z.number().optional(),
  source_url: z.string().optional()
});

export const paragraphSchema = z.object({
  marker: z.string(),
  text: z.string(),
  level: z.number().optional()
});

export const regulationSchema: z.ZodType<any> = z.lazy(() => z.object({
  number: z.string(),
  text: z.string(),
  sub_items: z.array(paragraphSchema).optional(),
  regulations: z.array(regulationSchema).optional()
}));

export const articleSchema = z.object({
  number: z.number(),
  heading: z.string().optional(),
  text: z.string(),
  tags: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  cross_similar: z.array(crossSimilarSchema).optional(),
  number_text: z.string().optional(),
  paragraphs: z.array(paragraphSchema).optional(),
  regulations: z.array(regulationSchema).optional(),
  status: z.string().optional()
});

export const royalDecreeSchema = z.object({
  number: z.string(),
  date_hijri: z.string()
});

export const cabinetDecisionSchema = z.object({
  number: z.string(),
  date_hijri: z.string()
});

export const lawSchema = z.object({
  law_name: z.string(),
  category: z.string().optional(),
  doc_type: z.string().optional(),
  preamble: z.any().optional(),
  preamble_text: z.string().optional(),
  royal_decree: z.any().optional(),
  cabinet_decision: z.any().optional(),
  cabinet_decision_text: z.string().optional(),
  issuing_authority: z.string().optional(),
  total_articles: z.number().optional(),
  articles: z.array(articleSchema),
  // Backward compatibility fields (optional)
  law_id: z.string().optional(),
  title_ar: z.string().optional(),
  short_title_ar: z.string().optional(),
  jurisdiction_ar: z.string().optional(),
  primary_source_id: z.string().optional(),
  source_links: z.array(z.object({
    source_id: z.string(),
    url: z.string().url(),
    label_ar: z.string().optional()
  })).optional(),
  structure: z.any().optional()
});

// ============================================
// TYPES
// ============================================
export type Source = z.infer<typeof sourceSchema>;
export type LibraryItem = z.infer<typeof libraryItemSchema>;
export type Law = z.infer<typeof lawSchema>;
export type Article = z.infer<typeof articleSchema>;

// ============================================
// DATABASE MODELS (Re-export from models)
// ============================================
export * from "./models/auth";
export * from "./models/articleOverrides";
export * from "./models/errorReports";
export * from "./models/judgments";
export * from "./models/gazetteIndex";

export * from "./models/chat";
export * from "./models/crsdPrinciples";
