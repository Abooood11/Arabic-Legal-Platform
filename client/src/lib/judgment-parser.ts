/**
 * Judgment Text Parser
 * Parses judgment text into display sections WITHOUT modifying content.
 * All returned text is exact substrings of the original.
 * Supports both Saudi MOJ and Egyptian court judgments.
 */

/**
 * Fix Arabic date display issues:
 * 1. Fix OCR ه→5/٥ confusion in Hijri dates (both Arabic-Indic and Western digits)
 * 2. Replace / with - for Arabic-Indic digits to prevent BiDi reversal in RTL
 * 3. Fix OCR هو→هـ (Hijri suffix)
 */
export function fixArabicDate(text: string): string {
    return text
        // Strip leading ": " prefix from dates
        .replace(/^:\s*/, '')
        // Fix OCR ه→٥ in Hijri dates with Arabic-Indic digits
        .replace(/ه\/ه(\/[١][٣٤][٠-٩]{2})/g, '٥/٥$1')             // ه/ه/1Yxx (both are ه)
        .replace(/ه(\/[٠-٩]{1,2}\/[١][٣٤][٠-٩]{2})/g, '٥$1')
        .replace(/([٠-٩]{1,2}\/)ه(\/[١][٣٤][٠-٩]{2})/g, '$1٥$2')
        .replace(/([١][٣٤][٠-٩]{2}\/[٠-٩]{1,2}\/)ه(?=[^٠-٩\d]|$)/g, '$1٥')
        .replace(/([١][٣٤][٠-٩]{2}\/)ه(\/[٠-٩]{1,2})/g, '$1٥$2')
        // Fix OCR ه→5 in Hijri dates with Western digits (e.g. ه/8/1440 → 5/8/1440)
        .replace(/ه\/ه(\/1[34]\d{2})/g, '5/5$1')              // ه/ه/1Yxx (both are ه)
        .replace(/ه(\/\d{1,2}\/1[34]\d{2})/g, '5$1')
        .replace(/(\d{1,2}\/)ه(\/1[34]\d{2})/g, '$15$2')
        .replace(/(1[34]\d{2}\/\d{1,2}\/)ه(?=[^\d٠-٩]|$)/g, '$15')
        .replace(/(1[34]\d{2}\/)ه(\/\d{1,2})/g, '$15$2')
        // Reverse YYYY/M/D → D/M/YYYY for Western Hijri dates (year first)
        .replace(/(1[34]\d{2})\/(\d{1,2})\/(\d{1,2})/g, '$3/$2/$1')
        // Reverse YYYY/M/D → D/M/YYYY for Arabic-Indic digits (year first)
        .replace(/([١][٣٤][٠-٩]{2})\/([٠-٩]{1,2})\/([٠-٩]{1,2})/g, '$3/$2/$1')
        // Fix / → - for Arabic-Indic digits (prevents BiDi visual reversal)
        .replace(/([٠-٩]{1,4})\/([٠-٩]{1,2})\/([٠-٩]{1,4})/g, '$1-$2-$3')
        // Fix / → - for Western digits in Hijri dates
        .replace(/(\d{1,2})\/(\d{1,2})\/(1[34]\d{2})/g, '$1-$2-$3')
        // Fix OCR هو → هـ after dates
        .replace(/([\d٠-٩]+[\/\-.][\d٠-٩]+[\/\-.][\d٠-٩]+)\s*هو(?=[^٠-٩\w]|$)/g, '$1هـ');
}

/**
 * Whitelist of standalone short lines that ARE valid judgment content.
 * Everything else that's a standalone short line between blank lines = PDF book artifact.
 *
 * PDF book structure: each page has headers (court name, category, الموضوعات, الملخص, etc.)
 * that OCR reads as text and inserts between paragraphs. These appear as short standalone
 * lines surrounded by blank lines. OCR also corrupts these into random words (e.g. الأنتيك,
 * مجمع علم الكلام, الموصوفات, etc.) making word-matching impossible.
 *
 * Root solution: structural detection — any short standalone line that's NOT on the whitelist
 * is a PDF artifact and gets removed.
 */
const VALID_STANDALONE_RE = /^(?:الوقائع|الأسباب|\( الأسباب \)|\(الأسباب\)|المنطوق|خاتمة|بسم الله الرحمن الرحيم|الحمد لله|وصلى الله|والله الموفق|وبالله التوفيق|الموفق|لذلك حكم|فلهذه الأسباب|حكمت ال|قررت ال|قضاء[،.]|بالأسباب|لما هو م|هو موضح|مبين بالأسباب|موضح بالأسباب|ورفض ما عدا|وصحبه أجمعين|هيئة الت|أدلة الاتهام)/;

/** Pattern to detect الأسباب section content (starts reasoning section) */
const ASBAB_CONTENT_START_RE = /^(?:لما كان|من حيث|وحيث إن|ولما كان|وبعد الاطلاع)/;

/** Pattern to detect الوقائع section content (starts facts section) */
const WAQAEI_CONTENT_START_RE = /^(?:تتلخص|تخلص|تتحصل|حيث إن الوقائع|تتمثل وقائع|وقائع ال)/;

/**
 * Strip PDF book structural artifacts from BOG judgment text.
 * Removes standalone short lines (surrounded by blank lines) that are NOT
 * valid judgment content — these are page headers, category labels, footers,
 * and their OCR-corrupted variants that leaked into the text.
 *
 * Special handling: if an artifact line appears right before الأسباب content
 * (لما كان, وحيث إن, etc.), it's a corrupted الأسباب header → replace with الأسباب.
 */
export function stripPdfBookArtifacts(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        const prev = i > 0 ? lines[i - 1].trim() : '';
        const next = i < lines.length - 1 ? lines[i + 1].trim() : '';

        // Only consider non-empty short lines surrounded by blank/empty lines
        if (t.length >= 2 && t.length < 60 && prev === '' && next === '') {
            // Strip markdown formatting for matching
            const clean = t.replace(/^#{1,3}\s*/, '').replace(/\*\*/g, '').trim();
            // Keep if it matches a valid judgment content pattern
            if (VALID_STANDALONE_RE.test(clean)) {
                result.push(lines[i]);
            } else {
                // Check: is this a corrupted الأسباب header?
                // Look ahead for الأسباب content start (لما كان, وحيث إن, etc.)
                let nextContent = '';
                for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                    if (lines[j].trim().length > 10) {
                        nextContent = lines[j].trim();
                        break;
                    }
                }
                if (ASBAB_CONTENT_START_RE.test(nextContent)) {
                    // Replace corrupted header with correct الأسباب
                    result.push('الأسباب');
                } else if (WAQAEI_CONTENT_START_RE.test(nextContent)) {
                    // Replace corrupted header with correct الوقائع
                    result.push('الوقائع');
                } else {
                    // Remove this artifact line (replace with empty)
                    result.push('');
                }
            }
        } else {
            result.push(lines[i]);
        }
    }
    return result.join('\n');
}

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
    if (source === "crsd") {
        return parseCrsdJudgment(text);
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
    if (source === "crsd") {
        return extractCrsdRuling(text);
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
 * CRSD (لجان منازعات الأوراق المالية) metadata - structured per committee.
 * Organized as a Saudi securities law expert would expect:
 * بيانات لجنة الفصل + بيانات لجنة الاستئناف (if appeals).
 */
export interface CrsdMetadata {
    /** نتيجة القرار: تأييد / تعديل / إلغاء / نقض / قرار نهائي */
    resultType?: string;
    /** Short result label for badge: تأييد / تعديل / إلغاء / نقض / نهائي */
    resultLabel?: string;
    /** رقم القضية لدى لجنة الفصل */
    caseNumber?: string;
    /** بيانات قرار لجنة الفصل */
    fasal: { decisionNumber?: string; decisionDate?: string };
    /** بيانات قرار لجنة الاستئناف (null for final decisions) */
    appeal: { decisionNumber?: string; decisionDate?: string };
    /** نوع الدعوى (مدنية/جزائية/إدارية) */
    caseType?: string;
    /** التصنيف الموضوعي */
    subjectClass?: string;
    /** سبب النهائية - for قرارات نهائية only */
    finalityReason?: string;
    /** Whether this is a final (non-appealed) decision */
    isFinal: boolean;
    /** The body text starting from الوقائع */
    bodyText: string;
}

/**
 * Parse CRSD decision header into structured metadata.
 * Handles both colon-formatted and table-like (OCR-flattened) headers.
 */
export function parseCrsdMetadata(text: string): CrsdMetadata | null {
    if (!text) return null;

    // Find الوقائع to delimit header
    const waqaeiMatch = text.match(/\n\s*الوقائع\s*\n/);
    if (!waqaeiMatch || waqaeiMatch.index === undefined) {
        const fallback = text.match(/^الوقائع\s*$/m);
        if (!fallback || fallback.index === undefined || fallback.index > 1500) return null;
        return parseCrsdHeader(text.substring(0, fallback.index), text.substring(fallback.index));
    }
    return parseCrsdHeader(text.substring(0, waqaeiMatch.index), text.substring(waqaeiMatch.index));
}

function parseCrsdHeader(headerText: string, bodyText: string): CrsdMetadata {
    let resultType: string | undefined;
    let resultLabel: string | undefined;
    let caseNumber: string | undefined;
    let caseType: string | undefined;
    let subjectClass: string | undefined;
    let finalityReason: string | undefined;
    const fasal: { decisionNumber?: string; decisionDate?: string } = {};
    const appeal: { decisionNumber?: string; decisionDate?: string } = {};

    const lines = headerText.split('\n').map(l => l.trim()).filter(Boolean);

    // 1. Detect result type
    for (const line of lines) {
        if (/تأييد لجنة الاستئناف/.test(line)) { resultType = line; resultLabel = "تأييد"; break; }
        if (/تعديل لجنة الاستئناف/.test(line)) { resultType = line; resultLabel = "تعديل"; break; }
        if (/إلغاء لجنة الاستئناف/.test(line)) { resultType = line; resultLabel = "إلغاء"; break; }
        if (/نقض لجنة الاستئناف/.test(line)) { resultType = line; resultLabel = "نقض"; break; }
        if (/قرار لجنة الفصل النهائي/.test(line)) { resultType = line; resultLabel = "نهائي"; break; }
        if (/^قرار لجنة الفصل/.test(line)) { resultType = line; resultLabel = "قرار"; break; }
    }
    const isFinal = !resultLabel || resultLabel === "نهائي" || resultLabel === "قرار";

    // 2. Extract fields using line-by-line parsing (handles both colon and next-line formats)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^[A-Za-z]/.test(line)) continue;

        // رقم القضية لدى لجنة الفصل
        const caseNumMatch = line.match(/رقم القضية لدى لجنة الفصل[:\s]*(.*)/);
        if (caseNumMatch) {
            let val = caseNumMatch[1].trim();
            if (!val || /رقم قرار|تاريخ|نوع/.test(val)) { val = peekNextValue(lines, i); if (val) i++; }
            if (val) caseNumber = val;
            continue;
        }

        // رقم قرار لجنة الفصل
        const fasalNumMatch = line.match(/رقم قرار لجنة الفصل[:\s]*(.*)/);
        if (fasalNumMatch) {
            let val = fasalNumMatch[1].trim();
            if (!val || /رقم قرار|تاريخ|نوع/.test(val)) { val = peekNextValue(lines, i); if (val) i++; }
            if (val) fasal.decisionNumber = val;
            continue;
        }

        // رقم قرار لجنة الاستئناف
        const appealNumMatch = line.match(/رقم قرار لجنة الاستئناف[:\s]*(.*)/);
        if (appealNumMatch) {
            let val = appealNumMatch[1].trim();
            if (!val || /رقم قرار|تاريخ|نوع/.test(val)) { val = peekNextValue(lines, i); if (val) i++; }
            if (val) appeal.decisionNumber = val;
            continue;
        }

        // تاريخ صدور القرار
        if (/تاريخ صدور القرار/.test(line)) {
            let val = line.replace(/تاريخ صدور القرار[:\s]*/, '').trim();
            // Collect date continuation lines
            while ((!val || /^\d/.test(val)) && i + 1 < lines.length) {
                const next = lines[i + 1];
                if (/^\d|^[١-٩]/.test(next) || /هـ|م$/.test(next)) {
                    i++;
                    val += (val ? ' ' : '') + next;
                } else break;
            }
            // Attribute to correct committee based on surrounding context
            const ctx = lines.slice(Math.max(0, i - 6), i + 1).join(' ');
            if (/لجنة الاستئناف/.test(ctx) && !appeal.decisionDate) {
                if (val) appeal.decisionDate = val;
            } else if (!fasal.decisionDate) {
                if (val) fasal.decisionDate = val;
            } else if (!appeal.decisionDate) {
                if (val) appeal.decisionDate = val;
            }
            continue;
        }

        // نوع الدعوى
        const caseTypeMatch = line.match(/نوع الدعوى[:\s]*(.*)/);
        if (caseTypeMatch) {
            let val = caseTypeMatch[1].trim();
            if (!val && i + 1 < lines.length) { val = lines[i + 1]; i++; }
            if (val) caseType = val.replace(/ة$/, 'ي').replace(/ية$/, 'ي'); // normalize
            // Actually keep original: مدنية / جزائية / إدارية
            caseType = caseTypeMatch[1].trim() || (i < lines.length ? lines[i] : '');
            continue;
        }

        // التصنيف الموضوعي / التصنيف
        const classMatch = line.match(/(?:التصنيف الموضوعي|التصنيف)[:\s]*(.*)/);
        if (classMatch) {
            let val = classMatch[1].trim();
            if (!val && i + 1 < lines.length) { val = lines[i + 1]; i++; }
            // Might span multiple lines (e.g. "مخالفة أنظمة السوق المالية\nولوائحه")
            if (val && i + 1 < lines.length && /^و/.test(lines[i + 1]) && lines[i + 1].length < 30) {
                i++;
                val += ' ' + lines[i];
            }
            if (val && val.length > 1) subjectClass = val;
            continue;
        }

        // سبب النهائية
        const finalityMatch = line.match(/سبب النهائية[:\s]*(.*)/);
        if (finalityMatch) {
            let val = finalityMatch[1].trim();
            if (!val && i + 1 < lines.length) { val = lines[i + 1]; i++; }
            if (val) finalityReason = val;
            continue;
        }
    }

    return { resultType, resultLabel, caseNumber, fasal, appeal, caseType, subjectClass, finalityReason, isFinal, bodyText };
}

/** Peek at next line for a value (skipping label-like lines) */
function peekNextValue(lines: string[], i: number): string {
    if (i + 1 >= lines.length) return '';
    const next = lines[i + 1];
    if (/رقم القضية|رقم قرار|تاريخ صدور|نوع الدعوى|التصنيف|سبب النهائية/.test(next)) return '';
    return next.trim();
}

/**
 * Parse CRSD judgment body text into sections (الوقائع, الأسباب, المنطوق).
 */
function parseCrsdJudgment(text: string): JudgmentSection[] {
    const sections: JudgmentSection[] = [];

    // Find section boundaries
    const waqaeiMatch = text.match(/^الوقائع\s*$/m);
    const asbabMatch = text.match(/^الأسباب\s*$/m);

    // Multiple منطوق patterns for CRSD
    const mantooqPatterns = [
        /^منطوق قرار لجنة (?:الفصل|الاستئناف)/m,
        /^منطوق القرار/m,
        /^المنطوق\s*$/m,
    ];
    let mantooqMatch: RegExpMatchArray | null = null;
    for (const pat of mantooqPatterns) {
        mantooqMatch = text.match(pat);
        if (mantooqMatch) break;
    }

    // Also try end-of-text ruling patterns if no explicit منطوق header
    let endRulingIdx = -1;
    if (!mantooqMatch) {
        const endPatterns = [
            /\n\s*فقد قررت اللجنة/,
            /\n\s*لذا قررت اللجنة/,
            /\n\s*قررت اللجنة (?:ما يلي|الآتي|بالآتي)/,
            /\n\s*فلهذه الأسباب[\s\S]{0,30}قررت/,
        ];
        for (const pat of endPatterns) {
            const m = text.match(pat);
            if (m && m.index !== undefined) {
                endRulingIdx = m.index + 1; // skip the leading \n
                break;
            }
        }
    }

    const waqaeiIdx = waqaeiMatch?.index ?? -1;
    const asbabIdx = asbabMatch?.index ?? -1;
    const mantooqIdx = mantooqMatch?.index ?? endRulingIdx;

    // Build sections in order
    const markers: { idx: number; title: string; id: string; color: string }[] = [];
    if (waqaeiIdx >= 0) markers.push({ idx: waqaeiIdx, title: "الوقائع", id: "facts", color: "amber" });
    if (asbabIdx > waqaeiIdx) markers.push({ idx: asbabIdx, title: "الأسباب", id: "reasons", color: "purple" });
    if (mantooqIdx > 0 && mantooqIdx > asbabIdx) markers.push({ idx: mantooqIdx, title: "المنطوق", id: "ruling", color: "rose" });

    if (markers.length === 0) {
        return [{ id: "full-text", title: "نص القرار", content: text, startIndex: 0, endIndex: text.length, color: "slate" }];
    }

    for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        const nextMarker = markers[i + 1];
        const startIndex = marker.idx;
        const endIndex = nextMarker ? nextMarker.idx : text.length;
        const content = text.substring(startIndex, endIndex).trim();
        if (content.length > 0) {
            sections.push({ id: marker.id, title: marker.title, content, startIndex, endIndex, color: marker.color });
        }
    }

    return sections;
}

/**
 * Extract ruling (منطوق) from CRSD decision text.
 */
function extractCrsdRuling(text: string): string | null {
    // Explicit منطوق header
    const headerPatterns = [
        /منطوق قرار لجنة (?:الفصل|الاستئناف)\s*\n([\s\S]+)/,
        /منطوق القرار\s*\n([\s\S]+)/,
        /^المنطوق\s*\n([\s\S]+)/m,
    ];
    for (const pat of headerPatterns) {
        const m = text.match(pat);
        if (m && m[1].trim().length > 10 && m[1].trim().length < 3000) {
            return m[1].trim();
        }
    }

    // End-of-text ruling patterns
    const endPatterns = [
        /(?:فقد قررت اللجنة|لذا قررت اللجنة|قررت اللجنة (?:ما يلي|الآتي|بالآتي))([\s\S]+)$/,
        /فلهذه الأسباب[\s\S]{0,50}(قررت[\s\S]+)$/,
    ];
    for (const pat of endPatterns) {
        const m = text.match(pat);
        if (m && m[0].length > 20 && m[0].length < 3000) {
            return m[0].trim();
        }
    }

    return null;
}

/**
 * Strip CRSD header from text (everything before الوقائع).
 */
export function stripCrsdHeader(text: string): string {
    if (!text) return text;
    const waqaeiMatch = text.match(/\n\s*الوقائع\s*\n/);
    if (waqaeiMatch && waqaeiMatch.index !== undefined) {
        return text.substring(waqaeiMatch.index).trim();
    }
    const fallback = text.match(/^الوقائع\s*$/m);
    if (fallback && fallback.index !== undefined && fallback.index < 1500) {
        return text.substring(fallback.index).trim();
    }
    return text;
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

    // Collapse excessive whitespace: reduce any 2+ newlines to a single newline
    // so paragraphs are separated by one line break, not a blank line gap.
    f = f.replace(/\n{2,}/g, "\n");

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
/**
 * BOG judgment metadata extracted from the preamble (before الوقائع).
 * Covers both ديوان المظالم and المحكمة الإدارية العليا formats.
 */
export interface BogMetadata {
    /** Case reference lines (رقم القضية، رقم الحكم، رقم الاعتراض، تاريخ الجلسة) */
    caseInfo: { label: string; value: string }[];
    /** Legal principles (المبادئ المستخلصة / الموضوعات) */
    principles: string[];
    /** Legal references (مستند الحكم / مستند المحاكم) */
    legalBasis: string[];
    /** The cleaned judgment body text starting from الوقائع */
    bodyText: string;
    /** Collection name parsed from case_id (e.g. مجموعة أحكام المحكمة الإدارية العليا ١٤٤٣هـ - المجلد الثاني) */
    collectionName?: string;
}

// OCR correction map for display
const OCR_DISPLAY_FIXES: [RegExp, string][] = [
    [/المبدادي المستخلصة/g, "المبادئ المستخلصة"],
    [/المبادي المستخلصة/g, "المبادئ المستخلصة"],
    [/المبادىء المستخلصة/g, "المبادئ المستخلصة"],
    [/الموصوفات/g, "الموضوعات"],
    [/الموصوعات/g, "الموضوعات"],
    [/المووضعت/g, "الموضوعات"],
    [/الموضعت/g, "الموضوعات"],
    [/مستئند المحاكم/g, "مستند الحكم"],
    [/مستئند الحكم/g, "مستند الحكم"],
    [/مستند المحاكم/g, "مستند الحكم"],
    [/مسنتد الحكم/g, "مستند الحكم"],
    [/فنسختتم الحكيان/g, "مستند الحكم"],
    [/www\.\w+\.com/g, ""],
    [/0AE/g, ""],
    [/هيئة التثقيف/g, "هيئة التدقيق"],
    [/هيئه التثقيف/g, "هيئة التدقيق"],
];

function fixOcrDisplay(text: string): string {
    let result = text;
    for (const [pattern, replacement] of OCR_DISPLAY_FIXES) {
        result = result.replace(pattern, replacement);
    }
    return result;
}

/**
 * Parse BOG case_id to extract collection name.
 * Format: BOG-supreme-1443-V2-4835-M127/1439 or BOG-1442-V1-937/1441
 */
function parseBogCollectionName(caseId?: string, courtBody?: string): string | undefined {
    if (!caseId || !caseId.startsWith('BOG-')) return undefined;

    const VOLUME_AR: Record<string, string> = {
        '1': 'الأول', '2': 'الثاني', '3': 'الثالث', '4': 'الرابع',
        '5': 'الخامس', '6': 'السادس', '7': 'السابع', '8': 'الثامن',
        '9': 'التاسع', '10': 'العاشر',
    };

    // BOG-supreme-1443-V2-... or BOG-1442-V1-...
    const supremeMatch = caseId.match(/^BOG-supreme-(\d{4})-V(\d+)/);
    const normalMatch = caseId.match(/^BOG-(\d{4})-V(\d+)/);

    if (supremeMatch) {
        const year = supremeMatch[1];
        const vol = supremeMatch[2];
        const volName = VOLUME_AR[vol] || vol;
        return `مجموعة أحكام المحكمة الإدارية العليا ${year}هـ - المجلد ${volName}`;
    }
    if (normalMatch) {
        const year = normalMatch[1];
        const vol = normalMatch[2];
        const volName = VOLUME_AR[vol] || vol;
        const court = courtBody || 'المحاكم الإدارية';
        return `مجموعة أحكام ${court} ${year}هـ - المجلد ${volName}`;
    }
    return undefined;
}

/**
 * Parse Saudi MOJ judgment text to extract case metadata from the header.
 * The text starts with: "بيانات الحكم القضية رقم XXX ... المحكمة ... المدينة: ... رقم الحكم: ... التاريخ: ..."
 */
/**
 * Strip Saudi MOJ judgment header ("بيانات الحكم ...") from the text
 * when case info has already been extracted and displayed in a card.
 * Removes everything from start up to "نص الحكم" or "(الوقائع)" marker.
 */
export function stripSaudiHeader(text: string): string {
    if (!text) return text;
    // Look for "نص الحكم" marker — everything after it is the actual judgment
    const nassIdx = text.indexOf("نص الحكم");
    if (nassIdx !== -1 && nassIdx < 600) {
        // Skip past "نص الحكم" and optional colon/whitespace
        let start = nassIdx + "نص الحكم".length;
        const after = text.substring(start, start + 5);
        if (after.match(/^[:\s]/)) start += after.match(/^[:\s]+/)![0].length;
        return text.substring(start).trim();
    }
    // Look for "(الوقائع)" marker as fallback
    const waqaeiIdx = text.indexOf("(الوقائع)");
    if (waqaeiIdx !== -1 && waqaeiIdx < 600) {
        return text.substring(waqaeiIdx).trim();
    }
    // Look for "الوقائع:" marker as fallback
    const waqaeiColonMatch = text.substring(0, 600).match(/الوقائع\s*:/);
    if (waqaeiColonMatch && waqaeiColonMatch.index !== undefined) {
        return text.substring(waqaeiColonMatch.index).trim();
    }
    return text;
}

export function parseSaudiCaseInfo(text: string, source?: string): { label: string; value: string }[] | null {
    if (!text || source !== "sa_judicial") return null;
    const info: { label: string; value: string }[] = [];
    // Extract from the header portion (first ~500 chars)
    const header = text.substring(0, 600);

    const caseNumMatch = header.match(/القضية\s+رقم\s+([^\s]+(?:\s+لعام\s+[^\s]+)?)/);
    if (caseNumMatch) info.push({ label: "رقم القضية", value: caseNumMatch[1].replace(/لعام/, "لعام ") });

    const judgmentNumMatch = header.match(/رقم الحكم:\s*([^\s]+)/);
    if (judgmentNumMatch) info.push({ label: "رقم الحكم", value: judgmentNumMatch[1] });

    const dateMatch = header.match(/التاريخ:\s*([^\n]+?)(?:\s+نص|\s*$)/);
    if (dateMatch) info.push({ label: "تاريخ الحكم", value: dateMatch[1].trim() });

    const cityMatch = header.match(/المدينة:\s*([^\s]+)/);
    if (cityMatch) info.push({ label: "المدينة", value: cityMatch[1] });

    return info.length > 0 ? info : null;
}

/**
 * Parse BOG judgment text to extract structured metadata from the preamble.
 * Returns null for non-BOG judgments.
 */
export function parseBogMetadata(text: string, source?: string, caseId?: string, courtBody?: string): BogMetadata | null {
    if (!text || (source !== "bog_judicial")) return null;

    // Find where الوقائع section starts (the actual judgment body)
    // Also match OCR-corrupted variants that stripPdfBookArtifacts will fix
    const waqaeiPatterns = [
        /^#{0,3}\s*الوقائع\s*$/m,
        /^الوقائع\s*$/m,
        /\nالوقائع\n/,
        /\nالوقائع\s*$/m,
    ];

    let bodyStart = -1;
    for (const pat of waqaeiPatterns) {
        const m = text.match(pat);
        if (m && m.index !== undefined) {
            bodyStart = m.index;
            break;
        }
    }

    // If no الوقائع found, try الأسباب as fallback
    if (bodyStart < 0) {
        const asbabMatch = text.match(/^#{0,3}\s*الأسباب\s*$/m);
        if (asbabMatch && asbabMatch.index !== undefined) {
            bodyStart = asbabMatch.index;
        }
    }

    // If still no section found, try locating الوقائع content start (تتحصل/تتلخص/etc.)
    // preceded by a short standalone line (corrupted الوقائع header)
    if (bodyStart < 100) {
        const contentStartMatch = text.match(/\n\s*\n.{2,50}\n\s*\n(تتحصل|تتلخص|تخلص|حيث إن الوقائع|تتمثل وقائع|وقائع ال)/);
        if (contentStartMatch && contentStartMatch.index !== undefined) {
            // Point to the corrupted header line before the content
            bodyStart = contentStartMatch.index + 1;
        }
    }

    // If still no section found, no metadata to extract
    if (bodyStart < 100) return null;

    const preamble = fixOcrDisplay(text.substring(0, bodyStart));
    const bodyText = text.substring(bodyStart);

    // 1. Extract case info lines (first lines before # header)
    const caseInfo: { label: string; value: string }[] = [];
    const preambleLines = preamble.split('\n');

    for (const line of preambleLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) break;

        // Parse "label value" patterns
        const casePatterns = [
            { re: /^رقم الحكم في المجموعة\s+(.+)/, label: "رقم الحكم في المجموعة" },
            { re: /^رقم القضية في المحكمة الإدارية\s+(.+)/, label: "رقم القضية في المحكمة الإدارية" },
            { re: /^رقم القضية في محكمة الاستئناف الإدارية\s+(.+)/, label: "رقم القضية في محكمة الاستئناف" },
            { re: /^رقم الاستئناف\s+(.+)/, label: "رقم الاستئناف" },
            { re: /^رقم الاعتراض\s+(.+)/, label: "رقم الاعتراض" },
            { re: /^تاريخ الجلسة\s*:?\s+(.+)/, label: "تاريخ الجلسة" },
            { re: /^رقم القضية الابتدائية\s*:?\s+(.+)/, label: "رقم القضية الابتدائية" },
            { re: /^رقم الحكم الابتدائي\s*:?\s+(.+)/, label: "رقم الحكم الابتدائي" },
            { re: /^رقم قضية الاستئناف\s*:?\s+(.+)/, label: "رقم قضية الاستئناف" },
            { re: /^رقم حكم الاستئناف\s*:?\s+(.+)/, label: "رقم حكم الاستئناف" },
            { re: /^رقم القضية:?\s+(.+)/, label: "رقم القضية" },
            { re: /^القضية رقم:?\s+(.+)/, label: "رقم القضية" },
            { re: /^الحكم الابتدائي رقم:?\s+(.+)/, label: "الحكم الابتدائي" },
        ];

        for (const { re, label } of casePatterns) {
            const m = trimmed.match(re);
            if (m) {
                caseInfo.push({ label, value: m[1].trim() });
                break;
            }
        }
    }

    // 2. Extract principles (المبادئ المستخلصة / الموضوعات)
    const principles: string[] = [];
    const principlesHeaderRe = /(?:المبادئ المستخلصة|الموضوعات)\s*\n([\s\S]*?)(?=\n(?:#|مستند|الوقائع|الأسباب|$))/i;
    const principlesMatch = preamble.match(principlesHeaderRe);
    if (principlesMatch) {
        const principlesBlock = principlesMatch[1].trim();
        // Split by letter prefix (أ. ب. ج.) or numbered items
        const items = principlesBlock.split(/\n(?=[أ-ي][.\-]\s|[١٢٣٤٥٦٧٨٩0-9]+[.\-]\s)/);
        for (const item of items) {
            const cleaned = item.trim().replace(/^[أ-ي][.\-]\s*/, '').replace(/^#{1,3}\s*/, '').trim();
            if (cleaned.length > 10) {
                principles.push(cleaned);
            }
        }
        // If no split worked, try the whole block as one principle
        if (principles.length === 0 && principlesBlock.length > 10) {
            // Try splitting by ## headers
            const subItems = principlesBlock.split(/\n##\s*/);
            for (const item of subItems) {
                const cleaned = item.trim().replace(/^#{1,3}\s*/, '').trim();
                if (cleaned.length > 10) {
                    principles.push(cleaned);
                }
            }
        }
    }

    // 3. Extract legal basis (مستند الحكم)
    const legalBasis: string[] = [];
    const basisHeaderRe = /مستند الحكم\s*\n([\s\S]*?)(?=\n(?:#|الوقائع|الأسباب|$))/i;
    const basisMatch = preamble.match(basisHeaderRe);
    if (basisMatch) {
        const basisBlock = basisMatch[1].trim();
        const items = basisBlock.split(/\n(?=[-–•]\s|المادة)/);
        for (const item of items) {
            const cleaned = item.trim().replace(/^[-–•]\s*/, '').replace(/^#{1,3}\s*/, '').trim();
            if (cleaned.length > 5) {
                legalBasis.push(cleaned);
            }
        }
    }

    const collectionName = parseBogCollectionName(caseId, courtBody);
    return { caseInfo, principles, legalBasis, bodyText, collectionName };
}

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
