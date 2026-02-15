import fs from "fs";

const html = fs.readFileSync("C:/Users/Alemr/AppData/Local/Temp/cc_archived.html", "utf-8");
console.log("HTML Length:", html.length);

// Find key markers
const markers = ["الطعن", "الوقائع", "حيثيات", "المنطوق", "باسم الشعب", "بعد الاطلاع", "judgment_single", "card-body", "principle", "judgment-text", "judgment_text", "ja_text", "content-section"];
for (const m of markers) {
    const idx = html.indexOf(m);
    if (idx > -1) {
        const snippet = html.substring(Math.max(0, idx - 50), Math.min(html.length, idx + 100));
        console.log(`\n[${m}] found at index ${idx}:`);
        console.log("  " + snippet.replace(/[\n\r]+/g, " ").substring(0, 200));
    } else {
        console.log(`[${m}]: NOT FOUND`);
    }
}

// Extract text content (strip all HTML tags)
let text = html;
text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
text = text.replace(/<[^>]+>/g, "\n");
text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
text = text.replace(/\n\s*\n/g, "\n").trim();

const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 10);

console.log("\n\n=== TEXT CONTENT (first 60 meaningful lines) ===");
lines.slice(0, 60).forEach((l, i) => console.log(`${i}: ${l}`));
console.log(`\n... Total meaningful lines: ${lines.length}`);

// Look for the actual ruling text (long paragraphs)
console.log("\n=== LONG PARAGRAPHS (>100 chars) ===");
const longLines = lines.filter(l => l.length > 100);
console.log(`Found ${longLines.length} long paragraphs`);
longLines.slice(0, 5).forEach((l, i) => console.log(`\n[${i}]: ${l.substring(0, 200)}...`));
