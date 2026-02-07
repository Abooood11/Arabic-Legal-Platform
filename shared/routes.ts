import { z } from 'zod';
import { sourceSchema, libraryItemSchema, lawSchema } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  sources: {
    list: {
      method: 'GET' as const,
      path: '/api/sources',
      responses: {
        200: z.array(sourceSchema),
      },
    },
  },
  library: {
    list: {
      method: 'GET' as const,
      path: '/api/library',
      responses: {
        200: z.array(libraryItemSchema),
      },
    },
  },
  laws: {
    get: {
      method: 'GET' as const,
      path: '/api/laws/:id',
      responses: {
        200: lawSchema,
        404: errorSchemas.notFound,
      },
    },
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
