
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    ArrowRight,
    MapPin,
    Calendar,
    Building2,
    Hash,
    Copy,
    Printer,
    Link as LinkIcon,
    Scale,
    Landmark,
    Search,
    X,
    Check,
    BookOpen,
    UserRound,
    Gavel,
} from "lucide-react";
import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from "react";
import {
    extractCourtName,
    formatJudgmentText,
    findHighlightableTokens,
    extractJudges,
    parseBogMetadata,
    parseSaudiCaseInfo,
    stripSaudiHeader,
    fixArabicDate,
    stripPdfBookArtifacts,
    type HighlightedToken,
    type JudgeInfo,
    type BogMetadata,
} from "@/lib/judgment-parser";

interface Judgment {
    id: number;
    caseId: string;
    yearHijri: number;
    city: string;
    courtBody: string;
    circuitType: string;
    judgmentNumber: string;
    judgmentDate: string;
    text: string;
    principleText?: string | null;
    source?: string;
    appealType?: string;
}

const TOKEN_STYLES: Record<string, string> = {};

/**
 * Section divider configs.
 * Two Saudi judgment formats exist:
 *   Format A (~22K): الوقائع: → الأسباب: → نص الحكم:
 *   Format B (~13K): (الوقائع) → (الأسباب) → (منطوق الحكم)
 * We match both. Order matters: first match per label wins.
 */
const SECTION_DIVIDERS: { patterns: RegExp[]; label: string; color: string; bg: string; border: string; keepMatchInText?: boolean }[] = [
    {
        // Format B: (الوقائع)  |  Format A: الوقائع:  |  BOG: standalone الوقائع
        patterns: [/\(الوقائع\)/, /الوقائع\s*:/, /^\s*الوقائع\s*$/m],
        label: "الوقائع",
        color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-300",
    },
    {
        // Format B: (الأسباب)  |  Format A: الأسباب:  |  BOG: standalone الأسباب (after ### stripped)
        patterns: [/\(الأسباب\)/, /الأسباب\s*:/, /^\s*الأسباب\s*$/m, /الأسباب\s+(?=لما كان)/],
        label: "الأسباب",
        color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-300",
    },
    {
        // Format B: (منطوق الحكم)  |  Format A: نص الحكم:  |  BOG: لذلك حكمت | فلهذه الأسباب حكمت
        // keepMatchInText: the matched phrase (لذلك حكمت) stays in the text after the divider
        patterns: [/\(منطوق الحكم\)/, /نص الحكم\s*:/, /(?:لذلك|فلهذه الأسباب)\s+حكمت/],
        label: "منطوق الحكم",
        color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-300",
        keepMatchInText: true,
    },
    {
        // BOG appeal section: multiple patterns
        // 1. Short: "حكمت المحكمة بتأييد..." or "حكمت الهيئة بتأييد..."
        // 2. Long: "تمت المرافعة أمام محكمة الاستئناف..."
        // 3. هيئة التدقيق header before appeal ruling
        patterns: [
            /تمت المرافعة أمام محكمة الاستئناف/,
            /هيئة التدقيق\s+حكمت/,
            /هيئة التثقيف\s+حكمت/,
            /حكمت (?:المحكمة|الهيئة|الدائرة)[:\s]+بتأييد/,
            /حكمت (?:المحكمة|الهيئة|الدائرة) بتأييد/,
        ],
        label: "حكم الاستئناف",
        color: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-300",
        keepMatchInText: true,
    },
];

/**
 * Find the first match for a divider config across its multiple patterns.
 * Returns the first (earliest position) match found.
 */
function findDividerMatch(text: string, div: typeof SECTION_DIVIDERS[0]): { index: number; length: number } | null {
    let best: { index: number; length: number } | null = null;
    for (const pat of div.patterns) {
        // Use global regex to find all occurrences, pick the valid one
        // Preserve original flags (especially 'm' for multiline) and add 'g'
        const flags = pat.flags.includes('g') ? pat.flags : pat.flags + 'g';
        const regex = new RegExp(pat.source, flags);
        let m;
        while ((m = regex.exec(text)) !== null) {
            // Skip false positives: "فلهذه الأسباب:" is NOT a section header
            if (div.label === "الأسباب" && m.index > 5) {
                const before = text.substring(Math.max(0, m.index - 10), m.index);
                if (before.includes("فلهذه") || before.includes("لهذه")) continue;
            }
            // Skip false positives: "هذا الحكم:" or "منطوق الحكم:" in running text
            if (div.label === "منطوق الحكم" && pat.source.includes("الحكم\\s+")) {
                const before = text.substring(Math.max(0, m.index - 15), m.index);
                if (before.includes("هذا") || before.includes("منطوق") || before.includes("والحكم")) continue;
            }
            // Skip "منطوق الحكم" when the matched "حكمت" is actually an appeal ruling (بتأييد)
            if (div.label === "منطوق الحكم" && pat.source.includes("حكمت")) {
                const after = text.substring(m.index, m.index + m[0].length + 40);
                if (/حكمت\s+(?:المحكمة|الهيئة|الدائرة)\s+بتأييد/.test(after)) continue;
            }
            if (!best || m.index < best.index) {
                best = { index: m.index, length: m[0].length };
            }
            break; // take first valid occurrence per pattern
        }
    }
    return best;
}

/**
 * Renders a text chunk with token + search highlighting.
 */
function HighlightedChunk({ text, tokens, searchTerm }: { text: string; tokens: HighlightedToken[]; searchTerm: string }) {
    const parts = useMemo(() => {
        const ranges: { start: number; end: number; type: string }[] = [];

        for (const t of tokens) {
            if (t.startIndex >= 0 && t.endIndex <= text.length) {
                ranges.push({ start: t.startIndex, end: t.endIndex, type: t.type });
            }
        }

        if (searchTerm && searchTerm.length >= 2) {
            let idx = 0;
            const lower = text.toLowerCase();
            const searchLower = searchTerm.toLowerCase();
            while ((idx = lower.indexOf(searchLower, idx)) !== -1) {
                const overlaps = ranges.some(r => idx < r.end && idx + searchTerm.length > r.start);
                if (!overlaps) {
                    ranges.push({ start: idx, end: idx + searchTerm.length, type: "search" });
                }
                idx += 1;
            }
        }

        if (ranges.length === 0) return [{ text, type: null as string | null }];
        ranges.sort((a, b) => a.start - b.start);

        const result: { text: string; type: string | null }[] = [];
        let cursor = 0;
        for (const range of ranges) {
            if (range.start > cursor) {
                result.push({ text: text.substring(cursor, range.start), type: null });
            }
            if (range.start >= cursor) {
                result.push({ text: text.substring(range.start, range.end), type: range.type });
                cursor = range.end;
            }
        }
        if (cursor < text.length) {
            result.push({ text: text.substring(cursor), type: null });
        }
        return result;
    }, [text, tokens, searchTerm]);

    return (
        <>
            {parts.map((part, i) => {
                if (part.type === "search") {
                    return <mark key={i} className="bg-yellow-300/80 rounded px-0.5">{part.text}</mark>;
                }
                if (part.type && TOKEN_STYLES[part.type]) {
                    return <span key={i} className={`${TOKEN_STYLES[part.type]} rounded px-0.5 text-sm`}>{part.text}</span>;
                }
                return <span key={i}>{part.text}</span>;
            })}
        </>
    );
}

/**
 * Main text renderer: splits by section headers, renders dividers between text blocks.
 */
function JudgmentTextBody({ text, searchTerm }: { text: string; searchTerm: string }) {
    const segments = useMemo(() => {
        // Pre-clean: strip markdown headers, OCR artifacts, and reflow OCR line breaks
        let cleanText = text
            .replace(/^#{1,3}\s*/gm, '')       // remove markdown # ## ###
            .replace(/^\*{2,3}(.+?)\*{2,3}/gm, '$1')  // strip bold/italic markdown **text** → text
            .replace(/^\s*0[A-F][A-F0-9]\s*$/gm, '')  // OCR hex artifacts (0AE, 0AA, etc.) on own line
            .replace(/0[A-F][A-F0-9]/g, '')    // remaining inline hex artifacts
            .replace(/www\.\w+\.com/g, '')      // stray URLs
            .replace(/^-{3,}$/gm, '')           // horizontal rules (---)
            .replace(/\n{3,}/g, '\n\n')         // collapse 3+ blank lines
            .replace(/هيئة التثقيف/g, 'هيئة التدقيق')  // OCR: التثقيف → التدقيق
            .replace(/هيئه التثقيف/g, 'هيئة التدقيق')
            .replace(/\s*\d{1,3}\s*-\s*\d{1,3}\s*$/g, '')  // trailing page numbers (e.g. "1 - 11")
            .replace(/^\s*\d{1,3}\s*-\s*\d{1,3}\s*$/gm, '');  // page numbers on own line

        // Fix date display issues (ه→٥ OCR, / → - BiDi, هو→هـ OCR)
        cleanText = fixArabicDate(cleanText);

        // Remove PDF book structural artifacts (page headers, footers, category labels).
        // Root solution: any short standalone line between blank lines that's NOT
        // valid judgment content (section headers, rulings, closings) = artifact.
        // This catches all OCR corruptions (الأنتيك, الموصوفات, مجمع علم الكلام, etc.)
        // without needing to enumerate each specific corrupted word.
        cleanText = stripPdfBookArtifacts(cleanText);

        // Remove leaked next-judgment content.
        // BOG books often have 2+ judgments per page. OCR merges them into one text.
        // Detect: after closing prayer (وصلى الله...أجمعين), if new judgment metadata
        // appears (رقم الحكم في المجموعة, or 2+ consecutive رقم ال... lines), truncate.
        // Pattern 1: After closing prayer + new judgment header block
        cleanText = cleanText.replace(
            /(وصلى الله وسلم على نبينا محمد وعلى آله وصحبه أجمعين[.،]?\s*)(?:رقم الحكم في المجموعة[\s\S]*)$/,
            '$1'
        );
        // Pattern 2: After appeal confirmation + new judgment headers
        cleanText = cleanText.replace(
            /(حكمت (?:المحكمة|الهيئة|الدائرة) بتأييد[^.]*[.،]?\s*(?:وصلى[^]*?أجمعين[.،]?\s*)?)(?:رقم ال\S+\s+.+\n\s*رقم ال\S+[\s\S]*)$/,
            '$1'
        );
        // Pattern 3: General - any "رقم الحكم في المجموعة" after first 500 chars is a leak
        {
            const leakIdx = cleanText.indexOf('رقم الحكم في المجموعة', 500);
            if (leakIdx > 500) {
                cleanText = cleanText.substring(0, leakIdx).trim();
            }
        }

        // Mark standalone section headers with sentinel tokens before reflow.
        // Use \n\n around sentinels to guarantee they become their own paragraph
        // after split(/\n\n+/), since the raw OCR text often uses single \n.
        cleanText = cleanText
            .replace(/^\s*الوقائع\s*$/gm, '\n\n\x01SEC\x01\n\n')
            .replace(/^\s*الأسباب\s*$/gm, '\n\n\x02SEC\x02\n\n');

        // Reflow: OCR produces hard line breaks at PDF page width boundaries.
        // Split on paragraph breaks (\n\n), join single \n within each paragraph.
        // Then collapse mid-sentence \n\n (no terminal punctuation before break).
        const sectionKeywords = /^(?:لذلك|فلهذه|ومن حيث|وحيث|ولما كان|\x01|\x02)/;
        cleanText = cleanText.split(/\n\n+/).map(para => {
            const t = para.trim();
            if (!t || t === '\x01SEC\x01' || t === '\x02SEC\x02') return t;
            return t.replace(/\n/g, ' ');
        }).filter(p => p !== '').reduce((acc, para) => {
            if (!acc) return para;
            // Always keep section markers separate
            if (para === '\x01SEC\x01' || para === '\x02SEC\x02') return acc + '\n\n' + para;
            if (acc.endsWith('\x01SEC\x01') || acc.endsWith('\x02SEC\x02')) return acc + '\n\n' + para;
            // Check if previous paragraph ends with punctuation
            const endsWithPunct = /[.،؛:\u06D4]$/.test(acc.trim());
            const startsWithKeyword = sectionKeywords.test(para.trim());
            if (endsWithPunct || startsWithKeyword) return acc + '\n\n' + para;
            return acc + ' ' + para; // join mid-sentence break
        }, '');

        // Restore section headers
        cleanText = cleanText
            .replace(/\x01SEC\x01/g, 'الوقائع')
            .replace(/\x02SEC\x02/g, 'الأسباب');

        // Find section header positions using multi-pattern matching
        const headers: { index: number; length: number; config: typeof SECTION_DIVIDERS[0] }[] = [];
        for (const div of SECTION_DIVIDERS) {
            const match = findDividerMatch(cleanText, div);
            if (match) {
                headers.push({ index: match.index, length: match.length, config: div });
            }
        }
        // Sort by position AND remove any that overlap or appear in wrong order
        headers.sort((a, b) => a.index - b.index);

        // Remove overlapping headers: if two dividers match overlapping text ranges,
        // keep only one. When "حكم الاستئناف" overlaps with "منطوق الحكم", prefer "حكم الاستئناف"
        // because it is more specific (indicates an appeal ruling, not just a generic ruling).
        for (let i = 0; i < headers.length - 1; i++) {
            const curr = headers[i];
            const next = headers[i + 1];
            const currEnd = curr.index + curr.length;
            // Check if headers overlap (one starts before the other ends)
            if (next.index < currEnd || Math.abs(next.index - curr.index) < 20) {
                // If next is "حكم الاستئناف", it's more specific — remove current
                if (next.config.label === "حكم الاستئناف") {
                    headers.splice(i, 1);
                } else {
                    headers.splice(i + 1, 1);
                }
                i--; // re-check from same position
            }
        }

        if (headers.length === 0) {
            // No headers found - return entire text as one segment
            return [{ type: "text" as const, content: cleanText, config: null as typeof SECTION_DIVIDERS[0] | null }];
        }

        const result: { type: "text" | "divider"; content: string; config: typeof SECTION_DIVIDERS[0] | null }[] = [];
        let cursor = 0;

        for (const h of headers) {
            // Text before this header
            if (h.index > cursor) {
                const before = cleanText.substring(cursor, h.index).trim();
                if (before) {
                    result.push({ type: "text", content: before, config: null });
                }
            }
            // The divider itself
            result.push({ type: "divider", content: cleanText.substring(h.index, h.index + h.length), config: h.config });
            // If keepMatchInText, don't skip matched text (e.g. "لذلك حكمت" stays in body)
            cursor = h.config.keepMatchInText ? h.index : h.index + h.length;
        }

        // Text after last header
        if (cursor < cleanText.length) {
            const after = cleanText.substring(cursor).trim();
            if (after) {
                result.push({ type: "text", content: after, config: null });
            }
        }

        // Remove duplicate section label at start of text segments following a divider
        // (e.g. stripPdfBookArtifacts inserts "الأسباب" which the divider also renders)
        for (let i = 1; i < result.length; i++) {
            if (result[i].type === "text" && result[i - 1].type === "divider" && result[i - 1].config) {
                const label = result[i - 1].config!.label;
                const stripped = result[i].content.replace(new RegExp(`^\\s*${label}\\s*`), '').trim();
                if (stripped) {
                    result[i].content = stripped;
                } else {
                    result.splice(i, 1);
                    i--;
                }
            }
        }

        return result;
    }, [text]);

    return (
        <div>
            {segments.map((seg, i) => {
                if (seg.type === "divider" && seg.config) {
                    return (
                        <div key={i} className="mt-6 mb-3 flex items-center gap-4">
                            <div className={`h-px flex-1 border-t ${seg.config.border}`} />
                            <div className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold ${seg.config.color} ${seg.config.bg} border ${seg.config.border} shadow-sm`}>
                                <span className="w-2 h-2 rounded-full bg-current" />
                                {seg.config.label}
                            </div>
                            <div className={`h-px flex-1 border-t ${seg.config.border}`} />
                        </div>
                    );
                }

                // Text segment - format into paragraphs
                const formatted = formatJudgmentText(seg.content);
                const tokens = findHighlightableTokens(formatted);

                // Detect closing (خاتمة) phrases - center them
                const isClosing = /^والله (?:الموفق|أعلم|ولي التوفيق)/.test(seg.content.trim())
                    || /^وصلى الله/.test(seg.content.trim())
                    || /^حرر(?:ت)? (?:هذا|هذه|في)/.test(seg.content.trim());

                return (
                    <div key={i} className={`judgment-text leading-[1.75] whitespace-pre-line ${isClosing ? 'text-center text-muted-foreground mt-6' : 'text-justify'}`} dir="rtl">
                        <HighlightedChunk
                            text={formatted}
                            tokens={tokens}
                            searchTerm={searchTerm}
                        />
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Renders structured BOG metadata: case info, principles, legal basis.
 */
function BogMetadataPanel({ meta }: { meta: BogMetadata }) {
    return (
        <div className="space-y-4 mb-5">
            {/* Collection Name */}
            {meta.collectionName && (
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-2.5 flex items-center gap-2 text-sm text-slate-600">
                    <BookOpen className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="font-medium">{meta.collectionName}</span>
                </div>
            )}

            {/* Case Reference Info */}
            {meta.caseInfo.length > 0 && (
                <div className="rounded-2xl bg-background border shadow-sm p-5">
                    <div className="flex items-center gap-2 mb-3 text-sm font-bold text-slate-600">
                        <Landmark className="h-4 w-4" />
                        <span>بيانات القضية</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {meta.caseInfo.map((info, i) => (
                            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                                <span className="text-xs text-muted-foreground whitespace-nowrap mt-0.5">{info.label}:</span>
                                <span className="text-sm font-medium text-slate-800">{fixArabicDate(info.value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Legal Principles */}
            {meta.principles.length > 0 && (
                <div className="rounded-2xl bg-background border shadow-sm p-5">
                    <div className="flex items-center gap-2 mb-3 text-sm font-bold text-primary">
                        <Scale className="h-4 w-4" />
                        <span>المبادئ المستخلصة</span>
                    </div>
                    <div className="space-y-2">
                        {meta.principles.map((principle, i) => (
                            <div key={i} className="flex gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/10">
                                {meta.principles.length > 1 && (
                                    <span className="text-primary font-bold text-sm mt-0.5 shrink-0">{'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ'[i] || String(i + 1)}.</span>
                                )}
                                <span className="text-sm leading-relaxed text-foreground text-justify">{fixArabicDate(principle)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Legal Basis */}
            {meta.legalBasis.length > 0 && (
                <div className="rounded-2xl bg-background border shadow-sm p-5">
                    <div className="flex items-center gap-2 mb-3 text-sm font-bold text-primary">
                        <BookOpen className="h-4 w-4" />
                        <span>مستند الحكم</span>
                    </div>
                    <ul className="space-y-1.5">
                        {meta.legalBasis.map((basis, i) => (
                            <li key={i} className="flex gap-2 text-sm text-foreground leading-relaxed">
                                <span className="text-primary mt-1 shrink-0">•</span>
                                <span className="text-justify">{fixArabicDate(basis)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    const copy = useCallback(() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [text]);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={copy}>
                    {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label || "نسخ"}</TooltipContent>
        </Tooltip>
    );
}

export default function JudgmentDetail() {
    const params = useParams<{ id: string }>();
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);

    const { data: judgment, isLoading, error } = useQuery<Judgment>({
        queryKey: ["judgment", params.id],
        queryFn: async () => {
            const res = await fetch(`/api/judgments/${params.id}`);
            if (!res.ok) throw new Error("Failed to fetch judgment");
            return res.json();
        },
        enabled: !!params.id,
    });

    const isEgyptian = judgment?.source === "eg_naqd";
    const isBog = judgment?.source === "bog_judicial";

    const displayCourtName = useMemo(() => {
        if (!judgment) return "";
        if (isEgyptian) {
            const extracted = extractCourtName(judgment.text, judgment.source);
            return extracted || judgment.courtBody || "حكم قضائي";
        }
        return judgment.courtBody || "حكم قضائي";
    }, [judgment, isEgyptian]);

    const searchCount = useMemo(() => {
        if (!searchTerm || searchTerm.length < 2 || !judgment?.text) return 0;
        const fullText = (judgment.principleText || "") + "\n" + judgment.text;
        const lower = fullText.toLowerCase();
        const searchLower = searchTerm.toLowerCase();
        let count = 0;
        let idx = 0;
        while ((idx = lower.indexOf(searchLower, idx)) !== -1) { count++; idx++; }
        return count;
    }, [searchTerm, judgment?.text, judgment?.principleText]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "f") {
                e.preventDefault();
                setSearchOpen(true);
                setTimeout(() => searchRef.current?.focus(), 100);
            }
            if (e.key === "Escape" && searchOpen) {
                setSearchOpen(false);
                setSearchTerm("");
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [searchOpen]);

    const handlePrint = () => window.print();

    const wordCount = useMemo(() => {
        if (!judgment?.text) return 0;
        let total = judgment.text.split(/\s+/).filter(Boolean).length;
        if (judgment.principleText) {
            total += judgment.principleText.split(/\s+/).filter(Boolean).length;
        }
        return total;
    }, [judgment?.text, judgment?.principleText]);

    const judges = useMemo(() => {
        if (!judgment?.text) return null;
        return extractJudges(judgment.text, judgment.source);
    }, [judgment?.text, judgment?.source]);

    const bogMeta = useMemo(() => {
        if (!judgment?.text) return null;
        return parseBogMetadata(judgment.text, judgment.source, judgment.caseId, judgment.courtBody);
    }, [judgment?.text, judgment?.source, judgment?.caseId, judgment?.courtBody]);

    const saudiCaseInfo = useMemo(() => {
        if (!judgment?.text) return null;
        return parseSaudiCaseInfo(judgment.text, judgment.source);
    }, [judgment?.text, judgment?.source]);

    if (isLoading) {
        return (
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <Skeleton className="h-8 w-48 mb-4" />
                <Skeleton className="h-32 w-full mb-4 rounded-xl" />
                <Skeleton className="h-96 w-full rounded-xl" />
            </div>
        );
    }

    if (error || !judgment) {
        return (
            <div className="container mx-auto px-4 py-16 text-center">
                <BookOpen className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
                <p className="text-lg text-muted-foreground mb-4">لم يتم العثور على الحكم</p>
                <Link href="/judgments">
                    <Button variant="outline">
                        <ArrowRight className="ml-2 h-4 w-4" />
                        العودة للقائمة
                    </Button>
                </Link>
            </div>
        );
    }

    // Metadata chips
    const chips: { icon: typeof MapPin; label: string; value: string }[] = [];
    if (judgment.city) chips.push({ icon: MapPin, label: "المدينة", value: judgment.city });
    if (!isEgyptian && judgment.yearHijri) chips.push({ icon: Calendar, label: "السنة", value: `${judgment.yearHijri}هـ` });
    if (judgment.circuitType && judgment.circuitType !== "غير محدد") {
        chips.push({ icon: Building2, label: isEgyptian ? "نوع الطعن" : "الدائرة", value: judgment.circuitType });
    }
    if (judgment.judgmentNumber) {
        chips.push({ icon: Landmark, label: isEgyptian ? "رقم الطعن" : "رقم الحكم", value: judgment.judgmentNumber });
    }
    if (judgment.judgmentDate) {
        chips.push({ icon: Calendar, label: isEgyptian ? "تاريخ الجلسة" : "تاريخ الحكم", value: fixArabicDate(judgment.judgmentDate) });
    }

    return (
        <div className="min-h-screen bg-muted/30 print:bg-white">
            {/* Sticky Top Bar */}
            <div className="border-b bg-background/95 backdrop-blur print:hidden sticky top-0 z-20">
                <div className="container mx-auto px-4 py-2 flex items-center justify-between max-w-4xl">
                    <Link href="/judgments">
                        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                            <ArrowRight className="h-4 w-4" />
                            الأحكام
                        </Button>
                    </Link>

                    <div className="flex items-center gap-1">
                        {searchOpen ? (
                            <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-2 py-1">
                                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                    ref={searchRef}
                                    placeholder="بحث في النص..."
                                    className="h-7 w-48 border-0 bg-transparent text-sm focus-visible:ring-0 px-1"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                {searchTerm && (
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">{searchCount} نتيجة</span>
                                )}
                                <button onClick={() => { setSearchOpen(false); setSearchTerm(""); }}>
                                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                            </div>
                        ) : (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 100); }}>
                                        <Search className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>بحث (Ctrl+F)</TooltipContent>
                            </Tooltip>
                        )}
                        <CopyButton text={judgment.principleText ? `المبدأ القضائي:\n${judgment.principleText}\n\nنص الحكم:\n${judgment.text}` : judgment.text} label="نسخ النص الكامل" />
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigator.clipboard.writeText(window.location.href)}>
                                    <LinkIcon className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>نسخ الرابط</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePrint}>
                                    <Printer className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>طباعة</TooltipContent>
                        </Tooltip>
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 py-6 max-w-4xl">
                {/* Header */}
                <div className={`mb-5 p-5 rounded-2xl bg-background border shadow-sm border-r-4 ${
                    isEgyptian ? "border-r-amber-500" : isBog ? "border-r-emerald-600" : "border-r-primary"
                }`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <h1 className="text-lg font-bold text-foreground leading-snug">
                            {displayCourtName}
                        </h1>
                        {isEgyptian ? (
                            <Badge variant="outline" className="border-amber-600/30 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 text-[10px] gap-1 shrink-0">
                                <Scale className="h-3 w-3" /> مصر
                            </Badge>
                        ) : isBog ? (
                            <Badge variant="outline" className="border-emerald-600/30 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-[10px] gap-1 shrink-0">
                                <Gavel className="h-3 w-3" /> إدارية
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 text-[10px] gap-1 shrink-0">
                                <Landmark className="h-3 w-3" /> السعودية
                            </Badge>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {chips.map((chip, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs bg-muted/50 rounded-full px-3 py-1">
                                <chip.icon className="h-3 w-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{chip.label}:</span>
                                <span className="font-medium">{chip.value}</span>
                            </div>
                        ))}
                        <div className="flex items-center gap-1.5 text-xs bg-muted/50 rounded-full px-3 py-1">
                            <BookOpen className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">{wordCount.toLocaleString("ar-SA")} كلمة</span>
                        </div>
                    </div>
                </div>

                {/* Saudi MOJ Case Info Panel */}
                {saudiCaseInfo && saudiCaseInfo.length > 0 && (
                    <div className="rounded-2xl bg-background border shadow-sm p-5 mb-5">
                        <div className="flex items-center gap-2 mb-3 text-sm font-bold text-slate-600">
                            <Landmark className="h-4 w-4" />
                            <span>بيانات القضية</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {saudiCaseInfo.map((info, i) => (
                                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                                    <span className="text-xs text-muted-foreground whitespace-nowrap mt-0.5">{info.label}:</span>
                                    <span className="text-sm font-medium text-slate-800">{fixArabicDate(info.value)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* BOG Metadata Panel */}
                {bogMeta && (bogMeta.caseInfo.length > 0 || bogMeta.principles.length > 0 || bogMeta.legalBasis.length > 0) && (
                    <BogMetadataPanel meta={bogMeta} />
                )}

                {/* Egyptian Principle Text - separate section */}
                {isEgyptian && judgment.principleText && (
                    <div className="rounded-2xl bg-background border shadow-sm mb-5 overflow-hidden">
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-800 px-6 py-3 flex items-center gap-2">
                            <Scale className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                            <h2 className="text-sm font-bold text-emerald-800 dark:text-emerald-300">المبدأ القضائي</h2>
                        </div>
                        <div className="p-6 sm:p-8">
                            <div className="judgment-text leading-[1.75] whitespace-pre-line text-justify" dir="rtl">
                                <HighlightedChunk
                                    text={formatJudgmentText(judgment.principleText)}
                                    tokens={findHighlightableTokens(formatJudgmentText(judgment.principleText))}
                                    searchTerm={searchTerm}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Judgment Text */}
                <div className="rounded-2xl bg-background border shadow-sm p-6 sm:p-8">
                    {isEgyptian && judgment.principleText && (
                        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
                            <Gavel className="h-4 w-4 text-amber-700" />
                            <h2 className="text-sm font-bold text-amber-800 dark:text-amber-300">نص الحكم</h2>
                        </div>
                    )}
                    <JudgmentTextBody
                        text={bogMeta?.bodyText || (saudiCaseInfo ? stripSaudiHeader(judgment.text) : judgment.text)}
                        searchTerm={searchTerm}
                    />
                </div>

                {/* Judges Panel - Saudi only */}
                {judges && judges.length > 0 && (
                    <div className="mt-4 rounded-2xl bg-background border shadow-sm p-5">
                        <div className="flex items-center gap-2 mb-4 text-sm font-bold text-muted-foreground">
                            <Gavel className="h-4 w-4" />
                            <span>هيئة الحكم</span>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {/* Show panel head first */}
                            {judges.filter(j => j.role === "رئيس الدائرة").map((judge, i) => (
                                <Link key={`head-${i}`} href={`/judgments?judge=${encodeURIComponent(judge.name)}`}>
                                    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 hover:shadow-sm transition-all cursor-pointer group">
                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                            <UserRound className="h-4 w-4 text-primary" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] text-primary/70 font-medium">{judge.role}</div>
                                            <div className="text-sm font-bold text-primary">{judge.name}</div>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                            {/* Then show members */}
                            {judges.filter(j => j.role === "عضو").map((judge, i) => (
                                <Link key={`member-${i}`} href={`/judgments?judge=${encodeURIComponent(judge.name)}`}>
                                    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-muted border border-border hover:bg-muted/80 hover:shadow-sm transition-all cursor-pointer group">
                                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center group-hover:bg-muted/70 transition-colors">
                                            <UserRound className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] text-muted-foreground font-medium">{judge.role}</div>
                                            <div className="text-sm font-bold text-foreground">{judge.name}</div>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
