/**
 * Judgment Text Parser
 * Parses judgment text into display sections WITHOUT modifying content.
 * All returned text is exact substrings of the original.
 * Supports both Saudi MOJ and Egyptian court judgments.
 */

export interface JudgmentSection {
    id: string;
    title: string;
    content: string;
    startIndex: number;
    endIndex: number;
    color: string;
}

/**
 * Section markers for Saudi MOJ judgments.
 * ONLY the explicit parenthesized headers that appear in the actual text.
 * We do NOT invent our own sections.
 */
const SA_SECTION_MARKERS = [
    { pattern: /\(الوقائع\)/g, title: "الوقائع", id: "facts", color: "amber" },
    { pattern: /\(الأسباب\)/g, title: "الأسباب", id: "reasons", color: "purple" },
    { pattern: /\(منطوق الحكم\)/g, title: "منطوق الحكم", id: "ruling", color: "rose" },
];

/**
 * Egyptian judgments typically have these structure markers.
 * "الوقائع" and "الأسباب" only match when at the START of a line/section.
 */
const EG_SECTION_MARKERS = [
    { pattern: /الوقائع\s/g, title: "الوقائع", id: "facts", color: "amber", mustBeStandalone: true },
    { pattern: /وحيث إن(?:ه)? لما تقدم/g, title: "الخلاصة", id: "conclusion", color: "rose" },
];

/**
 * Known Egyptian court names to extract from judgment text
 */
const EGYPTIAN_COURT_PATTERNS = [
    { pattern: /المحكمة الإدارية العليا/, name: "المحكمة الإدارية العليا" },
    { pattern: /المحكمة الدستورية العليا/, name: "المحكمة الدستورية العليا" },
    { pattern: /محكمة القضاء الإداري/, name: "محكمة القضاء الإداري" },
    { pattern: /المحكمة التأديبية/, name: "المحكمة التأديبية" },
    { pattern: /محكمة النقض/, name: "محكمة النقض" },
    { pattern: /محكمة الجنايات/, name: "محكمة الجنايات" },
    { pattern: /محكمة الأمور المستعجلة/, name: "محكمة الأمور المستعجلة" },
];

/**
 * Extract the actual court name from Egyptian judgment text.
 * Returns the name with "المصرية" suffix to match DB convention.
 */
export function extractCourtName(text: string, source?: string): string | null {
    if (!text || source !== "eg_naqd") return null;

    const header = text.substring(0, 800);

    for (const court of EGYPTIAN_COURT_PATTERNS) {
        if (court.pattern.test(header)) {
            return court.name + " المصرية";
        }
    }

    for (const court of EGYPTIAN_COURT_PATTERNS) {
        if (court.pattern.test(text)) {
            return court.name + " المصرية";
        }
    }

    return null;
}

export function parseJudgmentText(text: string, source?: string): JudgmentSection[] {
    if (!text || text.trim().length === 0) {
        return [];
    }

    if (source === "sa_judicial") {
        return parseSaudiJudgment(text);
    }
    if (source === "eg_naqd") {
        return parseEgyptianJudgment(text);
    }

    // Unknown source - show as single formatted block
    return [{
        id: "full-text",
        title: "نص الحكم",
        content: text,
        startIndex: 0,
        endIndex: text.length,
        color: "slate",
    }];
}

function parseSaudiJudgment(text: string): JudgmentSection[] {
    const foundMarkers: { index: number; length: number; title: string; id: string; color: string }[] = [];

    for (const marker of SA_SECTION_MARKERS) {
        let match: RegExpExecArray | null;
        const regex = new RegExp(marker.pattern.source, 'g');
        while ((match = regex.exec(text)) !== null) {
            // Only take the first occurrence of each marker
            const exists = foundMarkers.some(m => m.id === marker.id);
            if (!exists) {
                foundMarkers.push({
                    index: match.index,
                    length: match[0].length,
                    title: marker.title,
                    id: marker.id,
                    color: marker.color,
                });
                break; // first occurrence only
            }
        }
    }

    foundMarkers.sort((a, b) => a.index - b.index);

    // If no markers found at all, show as single block
    if (foundMarkers.length === 0) {
        return [{
            id: "full-text",
            title: "نص الحكم",
            content: text,
            startIndex: 0,
            endIndex: text.length,
            color: "slate",
        }];
    }

    const sections: JudgmentSection[] = [];

    // Each section starts from its marker and goes to the next marker (or end)
    // Content before the first marker is included as part of the first section
    for (let i = 0; i < foundMarkers.length; i++) {
        const marker = foundMarkers[i];
        const nextMarker = foundMarkers[i + 1];

        // First section includes everything from the beginning of text
        const startIndex = i === 0 ? 0 : marker.index;
        const endIndex = nextMarker ? nextMarker.index : text.length;
        const content = text.substring(startIndex, endIndex).trim();

        if (content.length > 0) {
            sections.push({
                id: marker.id,
                title: marker.title,
                content,
                startIndex,
                endIndex,
                color: marker.color,
            });
        }
    }

    return sections;
}

function parseEgyptianJudgment(text: string): JudgmentSection[] {
    // Egyptian judgments are typically a continuous text.
    // Don't try to split them into sections using unreliable markers.
    // Just return as a single block - the formatting will handle readability.
    return [{
        id: "full-text",
        title: "نص الحكم",
        content: text,
        startIndex: 0,
        endIndex: text.length,
        color: "slate",
    }];
}

/**
 * Extract ruling/منطوق if reliably detected
 */
export function extractRuling(text: string, source?: string): string | null {
    if (source === "sa_judicial") {
        return extractSaudiRuling(text);
    }
    if (source === "eg_naqd") {
        return extractEgyptianRuling(text);
    }
    return null;
}

function extractSaudiRuling(text: string): string | null {
    // Look for (منطوق الحكم) marker and take everything after it
    const mantouqIdx = text.indexOf("(منطوق الحكم)");
    if (mantouqIdx !== -1) {
        const rulingText = text.substring(mantouqIdx + "(منطوق الحكم)".length).trim();
        if (rulingText.length > 10 && rulingText.length < 2000) {
            return rulingText;
        }
    }

    const patterns = [
        /حكمت الدائرة[^]*$/,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[0].length > 20 && match[0].length < 2000) {
            return match[0];
        }
    }

    return null;
}

function extractEgyptianRuling(text: string): string | null {
    // Egyptian rulings typically end with specific phrases
    const patterns = [
        /ف(?:لهذه الأسباب|لذلك)\s*(?:\n\s*)*حكمت المحكمة[^]*/,
        /وحيث إنه لما تقدم يكون الطعن على غير أساس[^]*/,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[0].length > 20 && match[0].length < 1500) {
            return match[0];
        }
    }
    return null;
}

/**
 * Format judgment text for better readability.
 * Adds line breaks at natural sentence/clause boundaries
 * without modifying the actual content.
 */
export function formatJudgmentText(text: string): string {
    if (!text) return "";

    let f = text;

    // Ensure section headers start on their own line.
    // These are the actual section markers in Saudi judgments.
    // Insert a line break BEFORE them if they're stuck to preceding text.
    const sectionHeaders = [
        // Format B (parenthesized)
        /(?<=\S)\s*(?=\(الوقائع\))/g,
        /(?<=\S)\s*(?=\(الأسباب\))/g,
        /(?<=\S)\s*(?=\(منطوق الحكم\))/g,
        // Format A (colon)
        /(?<=\S)\s*(?=الوقائع\s*:)/g,
        /(?<=\S)\s*(?=الأسباب\s*:)/g,
        /(?<=\S)\s*(?=نص الحكم\s*:)/g,
        // Standalone headers (no colon, no parens)
        /(?<=\S)\s*(?=الأسباب\s+لما كان)/g,
        /(?<=\S)\s*(?=الحكم\s+حكمت الدائرة)/g,
    ];
    for (const sh of sectionHeaders) {
        f = f.replace(sh, "\n");
    }

    // Split into paragraphs at natural legal Arabic boundaries.
    // After a period/comma followed by a common clause opener → new paragraph.
    const paragraphBreaks = [
        /([.،])\s+(?=وحيث (?:إن|أن))/g,
        /([.،])\s+(?=ومن حيث (?:إن|أن))/g,
        /([.،])\s+(?=ولما كان)/g,
        /([.،])\s+(?=لما كان (?:ذلك|ما تقدم))/g,
        /([.،])\s+(?=وبما أن)/g,
        /([.،])\s+(?=وعليه فإن)/g,
        /([.،])\s+(?=وقد (?:تبين|ثبت|تقدم|نص))/g,
        /([.،])\s+(?=وباطلاع)/g,
        /([.،])\s+(?=استناد[اً])/g,
        /([.،])\s+(?=وطلب)/g,
        /([.،])\s+(?=وبسؤال)/g,
        /([.،])\s+(?=فختمت)/g,
        /([.،])\s+(?=وذكر بأن)/g,
        /([.،])\s+(?=كما أن)/g,
        /([.])\s+(?=\d+ [–-] )/g,
    ];

    for (const p of paragraphBreaks) {
        f = f.replace(p, "$1\n");
    }

    // Collapse excessive whitespace
    f = f.replace(/\n{3,}/g, "\n\n");

    return f;
}

/**
 * Highlight tokens for display
 * Does NOT modify the underlying text
 */
export interface HighlightedToken {
    text: string;
    type: "amount" | "article" | "date";
    startIndex: number;
    endIndex: number;
}

export function findHighlightableTokens(text: string): HighlightedToken[] {
    const tokens: HighlightedToken[] = [];

    // Monetary amounts
    const amountPattern = /(\d[\d,\.]*)\s*(ريال|ر\.س|ر\.ي|جنيه|جنيها)/g;
    let match;
    while ((match = amountPattern.exec(text)) !== null) {
        tokens.push({
            text: match[0],
            type: "amount",
            startIndex: match.index,
            endIndex: match.index + match[0].length,
        });
    }

    // Article references
    const articlePattern = /الماد[ةه]\s*(رقم\s*)?\(?\d+\)?/g;
    while ((match = articlePattern.exec(text)) !== null) {
        tokens.push({
            text: match[0],
            type: "article",
            startIndex: match.index,
            endIndex: match.index + match[0].length,
        });
    }

    // Dates (Hijri and Gregorian)
    const datePattern = /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\s*[هـم]?/g;
    while ((match = datePattern.exec(text)) !== null) {
        tokens.push({
            text: match[0],
            type: "date",
            startIndex: match.index,
            endIndex: match.index + match[0].length,
        });
    }

    return tokens.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Judge information extracted from Saudi judgments.
 */
export interface JudgeInfo {
    role: "رئيس الدائرة" | "عضو";
    name: string;
}

/**
 * Extract judge names from the end of Saudi judgment text.
 * Saudi judgments end with: عضو [name] عضو [name] رئيس الدائرة [name]
 * Returns null if no judges detected or if source is not Saudi.
 */
export function extractJudges(text: string, source?: string): JudgeInfo[] | null {
    if (!text || source !== "sa_judicial") return null;

    // Find the LAST occurrence of "رئيس الدائرة" in the text
    const lastHeadIdx = text.lastIndexOf("رئيس الدائرة");
    if (lastHeadIdx === -1) return null;

    // Only consider this a judge block if it's near the end (within 200 chars of text end)
    if (text.length - lastHeadIdx > 200) return null;

    // Extract the judge block: from a bit before رئيس الدائرة to the end
    // We look backwards to find عضو markers (typically within 300 chars before رئيس الدائرة)
    const blockStart = Math.max(0, lastHeadIdx - 300);
    const judgeBlock = text.substring(blockStart);

    const judges: JudgeInfo[] = [];

    // Arabic name regex: Arabic chars + spaces (covers basic Arabic, extended, ligatures like ﷲ)
    const arabicNameRe = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s]+/;

    // Extract رئيس الدائرة name (everything after it to end of text)
    const headPattern = /رئيس الدائرة\s*([\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s]+)/;
    const headMatch = judgeBlock.match(headPattern);
    if (headMatch) {
        const name = headMatch[1].trim()
            .replace(/\s+/g, ' ')
            .replace(/[.،؛\s]+$/, '')
            .trim();
        if (name.length > 3 && name.length < 80) {
            judges.push({ role: "رئيس الدائرة", name });
        }
    }

    // Find عضو names - only in the region between blockStart and رئيس الدائرة
    const headIdx = judgeBlock.indexOf("رئيس الدائرة");
    const beforeHead = judgeBlock.substring(0, headIdx);

    // Split by عضو to get member names
    // Pattern handles both "عضو name" and "عضوname" (no space)
    const memberParts = beforeHead.split(/عضو\s*/);
    for (let i = 1; i < memberParts.length; i++) { // skip first part (before first عضو)
        let name = memberParts[i].trim()
            .replace(/\s+/g, ' ')
            .replace(/[.،؛\s]+$/, '')
            .trim();
        // Only take the Arabic name portion
        const arabicOnly = name.match(/^[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s]+/);
        if (arabicOnly) {
            name = arabicOnly[0].trim();
        }
        if (name.length > 3 && name.length < 80 && !name.includes('(')) {
            judges.push({ role: "عضو", name });
        }
    }

    return judges.length > 0 ? judges : null;
}
