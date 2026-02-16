import { GoogleGenAI } from "@google/genai";

let aiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

const GEMINI_TIMEOUT_MS = 90_000; // 90 seconds per request
const MAX_RETRIES = 2;

export async function analyzeWithGemini(prompt: string): Promise<string> {
  const ai = getClient();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      clearTimeout(timer);
      return response.text || "{}";
    } catch (e: any) {
      const msg = e.message || String(e);
      console.error(`[Gemini] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${msg.slice(0, 200)}`);

      if (attempt < MAX_RETRIES) {
        // Wait before retry (exponential backoff: 5s, 15s)
        const delay = (attempt + 1) * 5000 + Math.random() * 3000;
        console.log(`[Gemini] Retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }

  return "{}";
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
