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

  constructor() {
    this.dataDir = path.join(process.cwd(), "client", "public", "data");
  }

  async getSources(): Promise<Source[]> {
    const data = await fs.readFile(path.join(this.dataDir, "sources.json"), "utf-8");
    return JSON.parse(data);
  }

  async getLibrary(): Promise<LibraryItem[]> {
    const data = await fs.readFile(path.join(this.dataDir, "library.json"), "utf-8");
    return JSON.parse(data);
  }

  async getLaw(id: string): Promise<Law | undefined> {
    try {
      // Try exact match first
      const data = await fs.readFile(path.join(this.dataDir, "laws", `${id}.json`), "utf-8");
      return JSON.parse(data);
    } catch (e) {
      // Try with _boe suffix for BOE laws
      try {
        const data = await fs.readFile(path.join(this.dataDir, "laws", `${id}_boe.json`), "utf-8");
        return JSON.parse(data);
      } catch (e2) {
        return undefined;
      }
    }
  }
}

export const storage = new FileStorage();
