
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
    type HighlightedToken,
    type JudgeInfo,
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
    source?: string;
    appealType?: string;
}

const TOKEN_STYLES: Record<string, string> = {
    amount:  "bg-green-100/70 text-green-800 border-b border-green-300",
    article: "bg-blue-100/70 text-blue-800 border-b border-blue-300",
    date:    "bg-orange-100/70 text-orange-800 border-b border-orange-300",
};

/**
 * Section divider configs.
 * Two Saudi judgment formats exist:
 *   Format A (~22K): الوقائع: → الأسباب: → نص الحكم:
 *   Format B (~13K): (الوقائع) → (الأسباب) → (منطوق الحكم)
 * We match both. Order matters: first match per label wins.
 */
const SECTION_DIVIDERS: { patterns: RegExp[]; label: string; color: string; bg: string; border: string }[] = [
    {
        // Format B: (الوقائع)  |  Format A: الوقائع:
        patterns: [/\(الوقائع\)/, /الوقائع\s*:/],
        label: "الوقائع",
        color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200",
    },
    {
        // Format B: (الأسباب)  |  Format A: الأسباب:  |  Standalone: الأسباب لما كانت
        patterns: [/\(الأسباب\)/, /الأسباب\s*:/, /الأسباب\s+(?=لما كان)/],
        label: "الأسباب",
        color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200",
    },
    {
        // Format B: (منطوق الحكم)  |  Format A: نص الحكم:  |  Standalone: الحكم حكمت
        patterns: [/\(منطوق الحكم\)/, /نص الحكم\s*:/, /الحكم\s+(?=حكمت الدائرة)/],
        label: "منطوق الحكم",
        color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200",
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
        const regex = new RegExp(pat.source, 'g');
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
        // Find section header positions using multi-pattern matching
        const headers: { index: number; length: number; config: typeof SECTION_DIVIDERS[0] }[] = [];
        for (const div of SECTION_DIVIDERS) {
            const match = findDividerMatch(text, div);
            if (match) {
                // Avoid false positives: for colon-based patterns (الحكم:),
                // skip matches that are part of phrases like "فلهذه الأسباب:"
                // by ensuring they appear after a reasonable position
                headers.push({ index: match.index, length: match.length, config: div });
            }
        }
        // Sort by position AND remove any that overlap or appear in wrong order
        headers.sort((a, b) => a.index - b.index);

        if (headers.length === 0) {
            // No headers found - return entire text as one segment
            return [{ type: "text" as const, content: text, config: null as typeof SECTION_DIVIDERS[0] | null }];
        }

        const result: { type: "text" | "divider"; content: string; config: typeof SECTION_DIVIDERS[0] | null }[] = [];
        let cursor = 0;

        for (const h of headers) {
            // Text before this header
            if (h.index > cursor) {
                const before = text.substring(cursor, h.index).trim();
                if (before) {
                    result.push({ type: "text", content: before, config: null });
                }
            }
            // The divider itself
            result.push({ type: "divider", content: text.substring(h.index, h.index + h.length), config: h.config });
            cursor = h.index + h.length;
        }

        // Text after last header
        if (cursor < text.length) {
            const after = text.substring(cursor).trim();
            if (after) {
                result.push({ type: "text", content: after, config: null });
            }
        }

        return result;
    }, [text]);

    return (
        <div>
            {segments.map((seg, i) => {
                if (seg.type === "divider" && seg.config) {
                    return (
                        <div key={i} className="mt-10 mb-5 flex items-center gap-4">
                            <div className={`h-px flex-1 border-t ${seg.config.border}`} />
                            <div className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold ${seg.config.color} ${seg.config.bg} border ${seg.config.border} shadow-sm`}>
                                <span className={`w-2 h-2 rounded-full ${seg.config.bg.replace('50', '400').replace('bg-', 'bg-')}`} style={{ backgroundColor: seg.config.color === 'text-amber-700' ? '#d97706' : seg.config.color === 'text-purple-700' ? '#7e22ce' : '#be123c' }} />
                                {seg.config.label}
                            </div>
                            <div className={`h-px flex-1 border-t ${seg.config.border}`} />
                        </div>
                    );
                }

                // Text segment - format into paragraphs
                const formatted = formatJudgmentText(seg.content);
                const tokens = findHighlightableTokens(formatted);
                return (
                    <div key={i} className="judgment-text">
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
                    {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
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
        const lower = judgment.text.toLowerCase();
        const searchLower = searchTerm.toLowerCase();
        let count = 0;
        let idx = 0;
        while ((idx = lower.indexOf(searchLower, idx)) !== -1) { count++; idx++; }
        return count;
    }, [searchTerm, judgment?.text]);

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
        return judgment.text.split(/\s+/).filter(Boolean).length;
    }, [judgment?.text]);

    const judges = useMemo(() => {
        if (!judgment?.text) return null;
        return extractJudges(judgment.text, judgment.source);
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
        chips.push({ icon: Hash, label: isEgyptian ? "رقم الطعن" : "رقم الحكم", value: judgment.judgmentNumber });
    }
    if (judgment.judgmentDate) {
        chips.push({ icon: Calendar, label: isEgyptian ? "تاريخ الجلسة" : "تاريخ الحكم", value: judgment.judgmentDate });
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
                        <CopyButton text={judgment.text} label="نسخ النص الكامل" />
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
                    isEgyptian ? "border-r-amber-400" : "border-r-emerald-400"
                }`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <h1 className="text-lg font-bold text-foreground leading-snug">
                            {displayCourtName}
                        </h1>
                        {isEgyptian ? (
                            <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50 text-[10px] gap-1 shrink-0">
                                <Scale className="h-3 w-3" /> مصر
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50 text-[10px] gap-1 shrink-0">
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

                {/* Judgment Text */}
                <div className="rounded-2xl bg-background border shadow-sm p-6 sm:p-8">
                    <JudgmentTextBody
                        text={judgment.text}
                        searchTerm={searchTerm}
                    />
                </div>

                {/* Judges Panel - Saudi only */}
                {judges && judges.length > 0 && (
                    <div className="mt-4 rounded-2xl bg-background border shadow-sm p-5">
                        <div className="flex items-center gap-2 mb-4 text-sm font-bold text-slate-600">
                            <Gavel className="h-4 w-4" />
                            <span>هيئة الحكم</span>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {/* Show panel head first */}
                            {judges.filter(j => j.role === "رئيس الدائرة").map((judge, i) => (
                                <Link key={`head-${i}`} href={`/judgments?judge=${encodeURIComponent(judge.name)}`}>
                                    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 hover:shadow-sm transition-all cursor-pointer group">
                                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                                            <UserRound className="h-4 w-4 text-emerald-700" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] text-emerald-600 font-medium">{judge.role}</div>
                                            <div className="text-sm font-bold text-emerald-800">{judge.name}</div>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                            {/* Then show members */}
                            {judges.filter(j => j.role === "عضو").map((judge, i) => (
                                <Link key={`member-${i}`} href={`/judgments?judge=${encodeURIComponent(judge.name)}`}>
                                    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:shadow-sm transition-all cursor-pointer group">
                                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center group-hover:bg-slate-200 transition-colors">
                                            <UserRound className="h-4 w-4 text-slate-600" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] text-slate-500 font-medium">{judge.role}</div>
                                            <div className="text-sm font-bold text-slate-700">{judge.name}</div>
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
