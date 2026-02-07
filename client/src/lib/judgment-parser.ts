/**
 * Judgment Text Parser
 * Parses judgment text into display sections WITHOUT modifying content.
 * All returned text is exact substrings of the original.
 */

export interface JudgmentSection {
    id: string;
    title: string;
    content: string;
    startIndex: number;
    endIndex: number;
    color: string;
}

// Section markers commonly found in MOJ judgments
const SECTION_MARKERS = [
    { pattern: /بيانات الحكم/g, title: "بيانات الحكم", id: "metadata", color: "blue" },
    { pattern: /نص الحكم/g, title: "نص الحكم", id: "judgment-text", color: "emerald" },
    { pattern: /\(?\s*الوقائع\s*\)?/g, title: "الوقائع", id: "facts", color: "amber" },
    { pattern: /\(?\s*الأسباب\s*\)?/g, title: "الأسباب", id: "reasons", color: "purple" },
    { pattern: /ولهذه الأسباب حكمت/g, title: "منطوق الحكم", id: "ruling", color: "rose" },
    { pattern: /حكمت الدائرة/g, title: "منطوق الحكم", id: "ruling", color: "rose" },
    { pattern: /لذلك قررت/g, title: "القرار", id: "decision", color: "rose" },
    { pattern: /أحكام محكمة الاستئناف/g, title: "حكم الاستئناف", id: "appeal", color: "indigo" },
    { pattern: /نص الاستئناف/g, title: "نص الاستئناف", id: "appeal-text", color: "indigo" },
    { pattern: /القرار/g, title: "القرار", id: "decision", color: "rose" },
];

export function parseJudgmentText(text: string): JudgmentSection[] {
    if (!text || text.trim().length === 0) {
        return [];
    }

    const sections: JudgmentSection[] = [];
    const foundMarkers: { index: number; title: string; id: string; color: string }[] = [];

    // Find all markers in the text
    for (const marker of SECTION_MARKERS) {
        let match: RegExpExecArray | null;
        const regex = new RegExp(marker.pattern.source, 'g');
        while ((match = regex.exec(text)) !== null) {
            // Avoid duplicate sections with same id at same position
            const exists = foundMarkers.some(m =>
                m.id === marker.id && Math.abs(m.index - match!.index) < 50
            );
            if (!exists) {
                foundMarkers.push({
                    index: match.index,
                    title: marker.title,
                    id: marker.id,
                    color: marker.color,
                });
            }
        }
    }

    // Sort by position in text
    foundMarkers.sort((a, b) => a.index - b.index);

    if (foundMarkers.length === 0) {
        // No markers found - split by paragraphs
        return splitIntoParagraphs(text);
    }

    // Create sections from markers
    for (let i = 0; i < foundMarkers.length; i++) {
        const marker = foundMarkers[i];
        const nextMarker = foundMarkers[i + 1];

        const startIndex = marker.index;
        const endIndex = nextMarker ? nextMarker.index : text.length;
        const content = text.substring(startIndex, endIndex).trim();

        if (content.length > 0) {
            sections.push({
                id: `${marker.id}-${i}`,
                title: marker.title,
                content,
                startIndex,
                endIndex,
                color: marker.color,
            });
        }
    }

    // Add any content before the first marker as "مقدمة"
    if (foundMarkers.length > 0 && foundMarkers[0].index > 50) {
        const introContent = text.substring(0, foundMarkers[0].index).trim();
        if (introContent.length > 0) {
            sections.unshift({
                id: "intro",
                title: "مقدمة",
                content: introContent,
                startIndex: 0,
                endIndex: foundMarkers[0].index,
                color: "slate",
            });
        }
    }

    return sections;
}

function splitIntoParagraphs(text: string): JudgmentSection[] {
    // Split by double newlines or significant breaks
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    if (paragraphs.length <= 1) {
        // Single block - split by sentences for better readability
        return [{
            id: "full-text",
            title: "نص الحكم",
            content: text,
            startIndex: 0,
            endIndex: text.length,
            color: "slate",
        }];
    }

    let currentIndex = 0;
    return paragraphs.map((p, i) => {
        const start = text.indexOf(p, currentIndex);
        const end = start + p.length;
        currentIndex = end;

        return {
            id: `para-${i}`,
            title: `فقرة ${i + 1}`,
            content: p.trim(),
            startIndex: start,
            endIndex: end,
            color: "slate",
        };
    });
}

/**
 * Extract ruling/منطوق if reliably detected
 */
export function extractRuling(text: string): string | null {
    const rulingPatterns = [
        /حكمت الدائرة[^\.]*\./,
        /ولهذه الأسباب حكمت[^\.]*\./,
        /لذلك قررت[^\.]*\./,
        /القاضي بـ[^\.]*\./,
    ];

    for (const pattern of rulingPatterns) {
        const match = text.match(pattern);
        if (match && match[0].length > 20 && match[0].length < 500) {
            return match[0];
        }
    }

    return null;
}

/**
 * Highlight tokens for display (returns HTML-safe markers)
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

    // Monetary amounts (ريال with numbers)
    const amountPattern = /(\d[\d,\.]*)\s*(ريال|ر\.س|ر\.ي)/g;
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
    const articlePattern = /المادة\s*(رقم\s*)?\(?\d+\)?/g;
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
