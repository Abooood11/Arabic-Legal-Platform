import { useQuery } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type Law, type LibraryItem, type Source } from "@shared/schema";

// Sources Hook
export function useSources() {
  return useQuery({
    queryKey: [api.sources.list.path],
    queryFn: async () => {
      const res = await fetch(api.sources.list.path);
      if (!res.ok) throw new Error("Failed to fetch sources");
      const data = await res.json();
      return api.sources.list.responses[200].parse(data);
    },
  });
}

// Library Hook
export function useLibrary() {
  return useQuery({
    queryKey: [api.library.list.path],
    queryFn: async () => {
      const res = await fetch(api.library.list.path);
      if (!res.ok) throw new Error("Failed to fetch library");
      const data = await res.json();
      // Return raw data without validation to avoid schema issues
      return data as LibraryItem[];
    },
  });
}

// Law Detail Hook
export function useLaw(id: string) {
  return useQuery({
    queryKey: [api.laws.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.laws.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch law");
      }
      const data = await res.json();
      // Return raw data directly - schema validation was causing issues with new structure
      return data as Law;
    },
    enabled: !!id, // Only run if ID exists
  });
}

// Helper hook for filtering articles on the client side
export function useLawSearch(law: Law | null | undefined, query: string) {
  if (!law || !query) return law?.articles || [];
  
  return law.articles.filter((article) => {
    // Search in text
    if (article.text.includes(query)) return true;
    
    // Search in number
    if (String(article.number).includes(query)) return true;
    
    // Search in tags
    if (article.tags?.some(tag => tag.includes(query))) return true;
    
    // Search in keywords
    if (article.keywords?.some(kw => kw.includes(query))) return true;
    
    // Search in heading
    if (article.heading?.includes(query)) return true;

    return false;
  });
}
