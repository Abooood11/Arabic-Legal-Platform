
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    ArrowRight,
    MapPin,
    Calendar,
    Building2,
    Hash,
    ChevronDown,
    Copy,
    Printer,
    Link as LinkIcon,
    FileText
} from "lucide-react";
import { useState, useMemo } from "react";
import { parseJudgmentText, extractRuling, findHighlightableTokens, type JudgmentSection } from "@/lib/judgment-parser";

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
}

const SECTION_COLORS: Record<string, string> = {
    blue: "border-r-blue-500 bg-blue-50/50",
    emerald: "border-r-emerald-500 bg-emerald-50/50",
    amber: "border-r-amber-500 bg-amber-50/50",
    purple: "border-r-purple-500 bg-purple-50/50",
    rose: "border-r-rose-500 bg-rose-50/50",
    indigo: "border-r-indigo-500 bg-indigo-50/50",
    slate: "border-r-slate-400 bg-slate-50/50",
};

export default function JudgmentDetail() {
    const params = useParams<{ id: string }>();
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
    const [allExpanded, setAllExpanded] = useState(true);

    const { data: judgment, isLoading, error } = useQuery<Judgment>({
        queryKey: ["judgment", params.id],
        queryFn: async () => {
            const res = await fetch(`/api/judgments/${params.id}`);
            if (!res.ok) throw new Error("Failed to fetch judgment");
            return res.json();
        },
        enabled: !!params.id,
    });

    const sections = useMemo(() => {
        if (!judgment?.text) return [];
        return parseJudgmentText(judgment.text);
    }, [judgment?.text]);

    const ruling = useMemo(() => {
        if (!judgment?.text) return null;
        return extractRuling(judgment.text);
    }, [judgment?.text]);

    const toggleSection = (id: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const toggleAll = () => {
        if (allExpanded) {
            setExpandedSections(new Set());
        } else {
            setExpandedSections(new Set(sections.map(s => s.id)));
        }
        setAllExpanded(!allExpanded);
    };

    const isSectionExpanded = (id: string) => {
        return allExpanded ? !expandedSections.has(id) : expandedSections.has(id);
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handlePrint = () => {
        window.print();
    };

    if (isLoading) {
        return (
            <div className="container mx-auto px-4 py-8">
                <Skeleton className="h-8 w-48 mb-4" />
                <Skeleton className="h-32 w-full mb-4" />
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }

    if (error || !judgment) {
        return (
            <div className="container mx-auto px-4 py-8 text-center">
                <p className="text-muted-foreground">لم يتم العثور على الحكم</p>
                <Link href="/judgments">
                    <Button variant="outline" className="mt-4">
                        <ArrowRight className="ml-2 h-4 w-4" />
                        العودة للقائمة
                    </Button>
                </Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background print:bg-white">
            {/* Header */}
            <div className="border-b bg-muted/30 print:hidden">
                <div className="container mx-auto px-4 py-4">
                    <Link href="/judgments">
                        <Button variant="ghost" size="sm" className="gap-2">
                            <ArrowRight className="h-4 w-4" />
                            العودة للقائمة
                        </Button>
                    </Link>
                </div>
            </div>

            <div className="container mx-auto px-4 py-6">
                <div className="flex gap-8">
                    {/* TOC Sidebar */}
                    <aside className="hidden lg:block w-64 shrink-0 print:hidden">
                        <div className="sticky top-4 p-4 border rounded-lg bg-background">
                            <h3 className="font-bold text-sm mb-3 text-muted-foreground">فهرس المحتويات</h3>
                            <nav className="space-y-1">
                                {sections.map((section) => (
                                    <a
                                        key={section.id}
                                        href={`#${section.id}`}
                                        className="block text-sm py-1 px-2 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                    >
                                        {section.title}
                                    </a>
                                ))}
                            </nav>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={toggleAll}
                                className="w-full mt-4 text-xs"
                            >
                                {allExpanded ? "طي الكل" : "توسيع الكل"}
                            </Button>
                        </div>
                    </aside>

                    {/* Main Content */}
                    <main className="flex-1 max-w-4xl">
                        {/* Metadata Panel */}
                        <div className="mb-6 p-6 border rounded-lg bg-background shadow-sm print:shadow-none print:border-0">
                            <div className="flex justify-between items-start mb-4">
                                <h1 className="text-2xl font-bold text-primary">
                                    {judgment.courtBody || "حكم قضائي"}
                                </h1>
                                <div className="flex gap-2 print:hidden">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => copyToClipboard(`${judgment.courtBody} - ${judgment.judgmentNumber}`)}
                                    >
                                        <Copy className="h-4 w-4 ml-1" />
                                        نسخ الاقتباس
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => copyToClipboard(window.location.href)}
                                    >
                                        <LinkIcon className="h-4 w-4 ml-1" />
                                        نسخ الرابط
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={handlePrint}>
                                        <Printer className="h-4 w-4 ml-1" />
                                        طباعة
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                {judgment.city && (
                                    <div className="flex items-center gap-2">
                                        <MapPin className="h-4 w-4 text-muted-foreground" />
                                        <div>
                                            <div className="text-muted-foreground text-xs">المدينة</div>
                                            <div className="font-medium">{judgment.city}</div>
                                        </div>
                                    </div>
                                )}
                                {judgment.yearHijri && (
                                    <div className="flex items-center gap-2">
                                        <Calendar className="h-4 w-4 text-muted-foreground" />
                                        <div>
                                            <div className="text-muted-foreground text-xs">السنة</div>
                                            <div className="font-medium">{judgment.yearHijri}هـ</div>
                                        </div>
                                    </div>
                                )}
                                {judgment.circuitType && (
                                    <div className="flex items-center gap-2">
                                        <Building2 className="h-4 w-4 text-muted-foreground" />
                                        <div>
                                            <div className="text-muted-foreground text-xs">الدائرة</div>
                                            <div className="font-medium">{judgment.circuitType}</div>
                                        </div>
                                    </div>
                                )}
                                {judgment.judgmentNumber && (
                                    <div className="flex items-center gap-2">
                                        <Hash className="h-4 w-4 text-muted-foreground" />
                                        <div>
                                            <div className="text-muted-foreground text-xs">رقم الحكم</div>
                                            <div className="font-medium font-mono">{judgment.judgmentNumber}</div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {judgment.judgmentDate && (
                                <div className="mt-4 pt-4 border-t">
                                    <Badge variant="outline">تاريخ الحكم: {judgment.judgmentDate}</Badge>
                                </div>
                            )}
                        </div>

                        {/* Ruling Box (if detected) */}
                        {ruling && (
                            <div className="mb-6 p-4 border-r-4 border-r-rose-500 bg-rose-50/50 rounded-lg">
                                <div className="flex items-center gap-2 mb-2 text-rose-700 font-bold">
                                    <FileText className="h-5 w-5" />
                                    <span>منطوق الحكم</span>
                                </div>
                                <p className="text-sm leading-relaxed">{ruling}</p>
                            </div>
                        )}

                        {/* Sections */}
                        <div className="space-y-4">
                            {sections.map((section) => (
                                <Collapsible
                                    key={section.id}
                                    open={isSectionExpanded(section.id)}
                                    onOpenChange={() => toggleSection(section.id)}
                                >
                                    <div
                                        id={section.id}
                                        className={`border-r-4 rounded-lg overflow-hidden ${SECTION_COLORS[section.color] || SECTION_COLORS.slate}`}
                                    >
                                        <CollapsibleTrigger asChild>
                                            <button className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors text-right">
                                                <span className="font-bold text-lg">{section.title}</span>
                                                <ChevronDown
                                                    className={`h-5 w-5 text-muted-foreground transition-transform ${isSectionExpanded(section.id) ? "rotate-180" : ""
                                                        }`}
                                                />
                                            </button>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                            <div className="p-6 pt-0">
                                                <div
                                                    className="prose-law leading-[2] text-base whitespace-pre-wrap"
                                                    style={{ fontFamily: "var(--font-sans)" }}
                                                >
                                                    {section.content}
                                                </div>
                                            </div>
                                        </CollapsibleContent>
                                    </div>
                                </Collapsible>
                            ))}
                        </div>

                        {/* Fallback if no sections */}
                        {sections.length === 0 && judgment.text && (
                            <div className="border rounded-lg p-6">
                                <div
                                    className="prose-law leading-[2] text-base whitespace-pre-wrap"
                                    style={{ fontFamily: "var(--font-sans)" }}
                                >
                                    {judgment.text}
                                </div>
                            </div>
                        )}
                    </main>
                </div>
            </div>
        </div>
    );
}
