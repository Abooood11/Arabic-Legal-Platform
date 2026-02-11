import { Source, LibraryItem, Law } from "@shared/schema";
import fs from "fs/promises";
import path from "path";

export interface IStorage {
  getSources(): Promise<Source[]>;
  getLibrary(): Promise<LibraryItem[]>;
  getLaw(id: string): Promise<Law | undefined>;
}

export class FileStorage implements IStorage {
  private dataDir: string;
  // In-memory caches to avoid re-reading large JSON files from disk
  private libraryCache: LibraryItem[] | null = null;
  private sourcesCache: Source[] | null = null;
  private lawCache: Map<string, Law> = new Map();
  private readonly MAX_LAW_CACHE = 50; // Keep up to 50 laws in memory

  constructor() {
    this.dataDir = path.join(process.cwd(), "client", "public", "data");
  }

  async getSources(): Promise<Source[]> {
    if (this.sourcesCache) return this.sourcesCache;
    const data = await fs.readFile(path.join(this.dataDir, "sources.json"), "utf-8");
    this.sourcesCache = JSON.parse(data);
    return this.sourcesCache!;
  }

  async getLibrary(): Promise<LibraryItem[]> {
    if (this.libraryCache) return this.libraryCache;
    const data = await fs.readFile(path.join(this.dataDir, "library.json"), "utf-8");
    this.libraryCache = JSON.parse(data);
    return this.libraryCache!;
  }

  async getLaw(id: string): Promise<Law | undefined> {
    // Check cache first
    if (this.lawCache.has(id)) return this.lawCache.get(id);

    const suffixes = ["", "_boe", "_uqn"];
    for (const suffix of suffixes) {
      try {
        const data = await fs.readFile(path.join(this.dataDir, "laws", `${id}${suffix}.json`), "utf-8");
        const law = JSON.parse(data);
        // Cache the law (evict oldest if full)
        if (this.lawCache.size >= this.MAX_LAW_CACHE) {
          const firstKey = this.lawCache.keys().next().value;
          if (firstKey) this.lawCache.delete(firstKey);
        }
        this.lawCache.set(id, law);
        return law;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

export const storage = new FileStorage();
