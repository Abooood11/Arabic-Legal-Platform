import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Search,
    Filter,
    ChevronLeft,
    ChevronRight,
    SlidersHorizontal,
    X,
    Newspaper,
    Calendar,
    Tag,
    Hash,
    FileText,
    BookOpen,
    ExternalLink,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface GazetteItem {
    id: number;
    issueYear: number | null;
    issueNumber: string | null;
    title: string;
    legislationNumber: string | null;
    legislationYear: string | null;
    category: string | null;
    issuePdfUrl?: string | null;
    titleSnippet?: string;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

interface GazetteResponse {
    data: GazetteItem[];
    pagination: Pagination;
}

interface GazetteFacets {
    categories: { category: string; count: number }[];
    years: { year: number; count: number }[];
    legislationYears: { year: string; count: number }[];
}

const SAUDI_GAZETTE_QUERIES = [
    "نظام الشركات",
    "اللائحة التنفيذية",
    "قرار مجلس الوزراء",
    "مرسوم ملكي",
    "نظام العمل",
];

function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

/** Render snippet text with FTS highlight markers */
function HighlightedSnippet({ text }: { text: string }) {
    if (!text) return <span className="text-muted-foreground">—</span>;
    const parts = text.split(/(【[^】]+】)/g);
    return (
        <>
            {parts.map((part, i) => {
                if (part.startsWith("【") && part.endsWith("】")) {
                    return (
                        <mark key={i} className="bg-yellow-200/80 text-foreground rounded px-0.5 font-medium">
                            {part.slice(1, -1)}
                        </mark>
                    );
                }
                return <span key={i}>{part}</span>;
            })}
        </>
    );
}

/** Color for category badge - unified theme colors */
function categoryColor(cat: string | null): string {
    if (!cat) return "bg-muted text-muted-foreground border-border";
    if (cat.includes("مرسوم ملكي")) return "bg-primary/5 text-primary border-primary/20";
    if (cat.includes("قرار مجلس الوزراء")) return "bg-primary/10 text-primary border-primary/30";
    if (cat.includes("أمر ملكي")) return "bg-accent/10 text-accent-foreground border-accent/30";
    if (cat.includes("أمر سامي")) return "bg-secondary text-secondary-foreground border-border";
    if (cat.includes("قرار وزاري")) return "bg-primary/5 text-primary border-primary/15";
    if (cat.includes("لائحة")) return "bg-muted text-foreground border-border";
    return "bg-muted text-muted-foreground border-border";
}

export default function GazetteIndex() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("");
    const [yearFilter, setYearFilter] = useState("");
    const [legYearFilter, setLegYearFilter] = useState("");
    const [filterOpen, setFilterOpen] = useState(false);
    const [exactSearch, setExactSearch] = useState(false);

    const debouncedSearch = useDebounce(search, 400);

    // Reset page on filter change
    useEffect(() => { setPage(1); }, [debouncedSearch, categoryFilter, yearFilter, legYearFilter, exactSearch]);

    const queryParams = useMemo(() => {
        const params = new URLSearchParams({ page: page.toString(), limit: "20" });
        if (debouncedSearch) params.set("q", debouncedSearch);
        if (exactSearch) params.set("exact", "true");
        if (categoryFilter) params.set("category", categoryFilter);
        if (yearFilter) params.set("year", yearFilter);
        if (legYearFilter) params.set("legislationYear", legYearFilter);
        return params.toString();
    }, [page, debouncedSearch, exactSearch, categoryFilter, yearFilter, legYearFilter]);

    const { data, isLoading, isFetching } = useQuery<GazetteResponse>({
        queryKey: ["gazette", queryParams],
        queryFn: async () => {
            const res = await fetch(`/api/gazette?${queryParams}`);
            if (!res.ok) throw new Error("Failed to fetch gazette");
            return res.json();
        },
        staleTime: 30000,
    });

    const { data: facets } = useQuery<GazetteFacets>({
        queryKey: ["gazette-facets"],
        queryFn: async () => {
            const res = await fetch("/api/gazette/facets");
            if (!res.ok) throw new Error("Failed to fetch facets");
            return res.json();
        },
        staleTime: 120000,
    });

    const hasFilters = categoryFilter || yearFilter;
    const clearFilters = () => { setCategoryFilter(""); setYearFilter(""); };
    const isSearching = !!debouncedSearch;

    return (
        <div className="min-h-screen bg-muted/20">
            {/* Hero / Search Header */}
            <div className="bg-gradient-to-b from-primary/5 to-background border-b">
                <div className="container mx-auto px-4 pt-8 pb-6">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="bg-primary/10 p-2 rounded-lg">
                            <Newspaper className="h-6 w-6 text-primary" />
                        </div>
                        <h1 className="text-3xl font-bold text-primary">كشاف أم القرى</h1>
                    </div>
                    <p className="text-muted-foreground text-sm mb-5 mr-12">
                        فهرس شامل للتشريعات والوثائق النظامية المنشورة في جريدة أم القرى الرسمية
                    </p>

                    {/* Search Bar */}
                    <div className="relative max-w-2xl">
                        <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                            placeholder="ابحث في عناوين التشريعات..."
                            className="pr-12 h-12 text-base rounded-xl shadow-sm border-2 focus:border-primary"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                            <button
                                onClick={() => setSearch("")}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    {/* Exact Search Toggle + Preset Queries */}
                    <div className="flex items-center gap-3 mt-3 max-w-2xl flex-wrap">
                        <Button
                            variant={exactSearch ? "default" : "outline"}
                            size="sm"
                            className="gap-1.5 text-xs"
                            onClick={() => setExactSearch(!exactSearch)}
                        >
                            {exactSearch ? "✓ بحث حرفي" : "بحث حرفي"}
                        </Button>
                        <span className="text-xs text-muted-foreground">استعلامات تشريعية:</span>
                        {SAUDI_GAZETTE_QUERIES.map((q) => (
                            <button
                                key={q}
                                onClick={() => setSearch(q)}
                                className="text-xs px-2.5 py-1 rounded-full bg-primary/5 text-primary hover:bg-primary/10 transition-colors border border-primary/20"
                            >
                                {q}
                            </button>
                        ))}
                    </div>
                    {!exactSearch && search && (
                        <p className="text-xs text-muted-foreground mt-2 max-w-2xl">
                            💡 استخدم أرقام الأدوات التشريعية أو العبارات الدقيقة مع "بحث حرفي" للحصول على نتائج أدق.
                        </p>
                    )}

                    {/* Stats */}
                    {data?.pagination && !isLoading && (
                        <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                                <FileText className="h-4 w-4" />
                                <span className="font-medium text-foreground">{data.pagination.total.toLocaleString("en")}</span> تشريع
                            </span>
                            {facets?.categories && (
                                <span className="flex items-center gap-1.5">
                                    <Tag className="h-4 w-4" />
                                    {facets.categories.length} تصنيف
                                </span>
                            )}
                            {facets?.years && (
                                <span className="flex items-center gap-1.5">
                                    <Calendar className="h-4 w-4" />
                                    {facets.years.length} سنة
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Filter Bar */}
            <div className="border-b bg-background sticky top-16 z-20">
                <div className="container mx-auto px-4">
                    <div className="flex items-center gap-2 py-2">
                        <Button variant={hasFilters ? "default" : "outline"} size="sm" className="gap-1.5" onClick={() => setFilterOpen(!filterOpen)}>
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            تصفية
                            {hasFilters && (
                                <span className="bg-white/20 text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                                    {[categoryFilter, yearFilter].filter(Boolean).length}
                                </span>
                            )}
                        </Button>

                        {/* Active Filters Pills */}
                        {hasFilters && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-muted-foreground">فلاتر:</span>
                                {categoryFilter && (
                                    <Badge variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => setCategoryFilter("")}>
                                        {categoryFilter} <X className="h-3 w-3" />
                                    </Badge>
                                )}
                                {yearFilter && (
                                    <Badge variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => setYearFilter("")}>
                                        سنة {yearFilter} <X className="h-3 w-3" />
                                    </Badge>
                                )}
                            </div>
                        )}

                        <div className="flex-grow" />

                        {/* Result count (compact) */}
                        {data?.pagination && (
                            <span className="text-xs text-muted-foreground">
                                {data.pagination.total.toLocaleString("en")} نتيجة
                            </span>
                        )}
                    </div>
                </div>

                {/* Inline Filter Panel */}
                {filterOpen && (
                    <div className="border-t border-primary/10 bg-gradient-to-b from-primary/[0.03] to-background">
                        <div className="container mx-auto px-4 py-4">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="bg-primary/10 p-1.5 rounded-lg">
                                        <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                                    </div>
                                    <span className="font-semibold text-sm text-primary">تصفية الكشاف</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    {hasFilters && (
                                        <button onClick={clearFilters} className="text-xs text-primary/70 hover:text-primary transition-colors">
                                            مسح الكل
                                        </button>
                                    )}
                                    <button onClick={() => setFilterOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-medium mb-1.5 block text-muted-foreground flex items-center gap-1.5">
                                        <Tag className="h-3 w-3" />
                                        التصنيف النوعي
                                    </label>
                                    <Select value={categoryFilter || "__all__"} onValueChange={(v) => setCategoryFilter(v === "__all__" ? "" : v)}>
                                        <SelectTrigger className="h-9 text-sm rounded-lg"><SelectValue placeholder="جميع التصنيفات" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__all__">جميع التصنيفات</SelectItem>
                                            {facets?.categories?.map((c) => (
                                                <SelectItem key={c.category} value={c.category}>
                                                    {c.category} ({c.count.toLocaleString("en")})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium mb-1.5 block text-muted-foreground flex items-center gap-1.5">
                                        <Calendar className="h-3 w-3" />
                                        سنة الإصدار (العدد)
                                    </label>
                                    <Select value={yearFilter || "__all__"} onValueChange={(v) => setYearFilter(v === "__all__" ? "" : v)}>
                                        <SelectTrigger className="h-9 text-sm rounded-lg"><SelectValue placeholder="جميع السنوات" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__all__">جميع السنوات</SelectItem>
                                            {facets?.years?.map((y) => (
                                                <SelectItem key={y.year} value={y.year.toString()}>
                                                    {y.year} ({y.count.toLocaleString("en")})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Results */}
            <div className="container mx-auto px-4 py-5">
                {isLoading ? (
                    <div className="space-y-3">
                        {Array(8).fill(0).map((_, i) => (
                            <Skeleton key={i} className="h-28 w-full rounded-xl" />
                        ))}
                    </div>
                ) : (
                    <>
                        {/* Cards */}
                        <div className="space-y-3 relative">
                            {isFetching && !isLoading && (
                                <div className="absolute inset-0 bg-background/40 z-10 rounded-xl" />
                            )}

                            {data?.data.map((item) => (
                                <div
                                    key={item.id}
                                    className="bg-background border rounded-xl p-4 hover:shadow-sm transition-all border-r-4 border-r-primary/40"
                                >
                                    {/* Title */}
                                    <h3 className="font-bold text-foreground mb-2 leading-relaxed">
                                        {item.titleSnippet ? (
                                            <HighlightedSnippet text={item.titleSnippet} />
                                        ) : (
                                            item.title
                                        )}
                                    </h3>

                                    {/* Metadata chips */}
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                        {item.category && (
                                            <Badge variant="outline" className={`text-[11px] gap-1 ${categoryColor(item.category)}`}>
                                                <Tag className="h-3 w-3" />
                                                {item.category}
                                            </Badge>
                                        )}
                                        {item.issueYear && (
                                            <span className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                عدد {item.issueYear}
                                                {item.issueNumber && ` - رقم ${item.issueNumber}`}
                                            </span>
                                        )}
                                        {item.legislationNumber && (
                                            <span className="flex items-center gap-1">
                                                <Hash className="h-3 w-3" />
                                                رقم {item.legislationNumber}
                                            </span>
                                        )}
                                        {item.legislationYear && (
                                            <span className="flex items-center gap-1">
                                                <BookOpen className="h-3 w-3" />
                                                سنة {item.legislationYear}
                                            </span>
                                        )}
                                        {item.issuePdfUrl && (
                                            <a
                                                href={item.issuePdfUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-primary hover:underline"
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                                PDF العدد
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Empty state */}
                        {data?.data.length === 0 && (
                            <div className="py-16 text-center">
                                <Filter className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
                                <p className="text-lg text-muted-foreground mb-2">لا توجد نتائج</p>
                                <p className="text-sm text-muted-foreground">
                                    {isSearching ? "جرّب كلمات بحث مختلفة" : "جرّب تغيير الفلاتر"}
                                </p>
                            </div>
                        )}

                        {/* Pagination */}
                        {data?.pagination && data.pagination.totalPages > 1 && (
                            <div className="flex justify-between items-center mt-6 pt-4 border-t">
                                <p className="text-xs text-muted-foreground">
                                    {((page - 1) * 20) + 1} - {Math.min(page * 20, data.pagination.total)} من {data.pagination.total.toLocaleString("en")}
                                </p>
                                <div className="flex items-center gap-1.5">
                                    <Button
                                        variant="outline" size="sm"
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                    >
                                        <ChevronRight className="h-4 w-4 ml-1" />
                                        السابق
                                    </Button>
                                    <span className="text-sm font-medium px-3 min-w-[80px] text-center">
                                        {page} / {data.pagination.totalPages}
                                    </span>
                                    <Button
                                        variant="outline" size="sm"
                                        onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                                        disabled={page === data.pagination.totalPages}
                                    >
                                        التالي
                                        <ChevronLeft className="h-4 w-4 mr-1" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
