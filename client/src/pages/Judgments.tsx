
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
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
    Scale,
    Landmark,
    Globe,
    MapPin,
    Calendar,
    Building2,
    Hash,
    ArrowLeft,
    UserRound,
    Gavel,
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";

interface JudgmentListItem {
    id: number;
    caseId: string;
    yearHijri: number;
    city: string;
    courtBody: string;
    circuitType: string;
    judgmentNumber: string;
    judgmentDate: string;
    textSnippet: string;
    source?: string;
    appealType?: string;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

interface JudgmentsResponse {
    data: JudgmentListItem[];
    pagination: Pagination;
}

interface Facets {
    cities: { city: string; count: number }[];
    courts: { court: string; count: number }[];
    years: { year: number; count: number }[];
}

type SourceTab = "" | "sa_judicial" | "eg_naqd";

const TABS: { key: SourceTab; label: string; shortLabel: string; icon: React.ReactNode; color: string; activeColor: string; badgeColor: string }[] = [
    {
        key: "",
        label: "جميع الأحكام",
        shortLabel: "الكل",
        icon: <Globe className="h-4 w-4" />,
        color: "text-muted-foreground hover:text-foreground hover:bg-muted/60 border-transparent",
        activeColor: "bg-primary text-primary-foreground shadow-md border-primary",
        badgeColor: "",
    },
    {
        key: "sa_judicial",
        label: "المحاكم السعودية",
        shortLabel: "السعودية",
        icon: <Landmark className="h-4 w-4" />,
        color: "text-muted-foreground hover:text-emerald-700 hover:bg-emerald-50 border-transparent",
        activeColor: "bg-emerald-600 text-white shadow-md border-emerald-600",
        badgeColor: "border-emerald-300 text-emerald-700 bg-emerald-50",
    },
    {
        key: "eg_naqd",
        label: "الأحكام المصرية",
        shortLabel: "مصر",
        icon: <Scale className="h-4 w-4" />,
        color: "text-muted-foreground hover:text-amber-700 hover:bg-amber-50 border-transparent",
        activeColor: "bg-amber-600 text-white shadow-md border-amber-600",
        badgeColor: "border-amber-300 text-amber-700 bg-amber-50",
    },
];

const SAUDI_LEGAL_QUERIES = [
    "\"مبدأ قضائي\"",
    "مادة 77 عقد العمل",
    "تعويض ضرر",
    "فسخ عقد",
    "نفقة حضانة",
    "سند تنفيذي",
];

function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

/** Render snippet text with FTS highlight markers 【...】 */
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

function SourceBadge({ source }: { source?: string }) {
    if (source === "eg_naqd") {
        return (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[11px] gap-1">
                <Scale className="h-3 w-3" />
                مصر
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50 text-[11px] gap-1">
            <Landmark className="h-3 w-3" />
            السعودية
        </Badge>
    );
}

export default function Judgments() {
    const [location, setLocation] = useLocation();
    const [activeTab, setActiveTab] = useState<SourceTab>("sa_judicial");
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [cityFilter, setCityFilter] = useState("");
    const [courtFilter, setCourtFilter] = useState("");
    const [yearFilter, setYearFilter] = useState("");
    const [sort, setSort] = useState("date");
    const [filterOpen, setFilterOpen] = useState(false);
    const [judgeFilter, setJudgeFilter] = useState("");
    const [exactSearch, setExactSearch] = useState(false);

    // Read judge param from URL on mount
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const judge = params.get("judge");
        if (judge) {
            setJudgeFilter(judge);
            setActiveTab("sa_judicial"); // judges are Saudi only
        }
    }, []);

    const clearJudgeFilter = useCallback(() => {
        setJudgeFilter("");
        // Remove judge from URL
        window.history.replaceState({}, "", "/judgments");
    }, []);

    const debouncedSearch = useDebounce(search, 400);

    useEffect(() => { setPage(1); }, [debouncedSearch, cityFilter, courtFilter, yearFilter, activeTab, judgeFilter, exactSearch]);
    useEffect(() => { setCityFilter(""); setCourtFilter(""); setYearFilter(""); }, [activeTab]);

    const queryParams = useMemo(() => {
        const params = new URLSearchParams({ page: page.toString(), limit: "20", sort });
        if (debouncedSearch) params.set("q", debouncedSearch);
        if (cityFilter) params.set("city", cityFilter);
        if (courtFilter) params.set("court", courtFilter);
        if (yearFilter) params.set("year", yearFilter);
        if (activeTab) params.set("source", activeTab);
        if (judgeFilter) params.set("judge", judgeFilter);
        if (exactSearch) params.set("exact", "true");
        return params.toString();
    }, [page, debouncedSearch, cityFilter, courtFilter, yearFilter, activeTab, sort, judgeFilter, exactSearch]);

    const { data, isLoading, isFetching } = useQuery<JudgmentsResponse>({
        queryKey: ["judgments", queryParams],
        queryFn: async () => {
            const res = await fetch(`/api/judgments?${queryParams}`);
            if (!res.ok) throw new Error("Failed to fetch judgments");
            return res.json();
        },
        staleTime: 30000,
    });

    const { data: facets } = useQuery<Facets>({
        queryKey: ["judgments-facets", activeTab],
        queryFn: async () => {
            const res = await fetch(`/api/judgments/facets${activeTab ? `?source=${activeTab}` : ""}`);
            if (!res.ok) throw new Error("Failed to fetch facets");
            return res.json();
        },
        staleTime: 60000,
    });

    // Tab counts
    const { data: allCount } = useQuery<{ count: number }>({
        queryKey: ["judgments-count-all"],
        queryFn: async () => { const r = await fetch("/api/judgments?limit=1"); const j = await r.json(); return { count: j.pagination.total }; },
        staleTime: 120000,
    });
    const { data: saCount } = useQuery<{ count: number }>({
        queryKey: ["judgments-count-sa"],
        queryFn: async () => { const r = await fetch("/api/judgments?limit=1&source=sa_judicial"); const j = await r.json(); return { count: j.pagination.total }; },
        staleTime: 120000,
    });
    const { data: egCount } = useQuery<{ count: number }>({
        queryKey: ["judgments-count-eg"],
        queryFn: async () => { const r = await fetch("/api/judgments?limit=1&source=eg_naqd"); const j = await r.json(); return { count: j.pagination.total }; },
        staleTime: 120000,
    });
    const tabCounts: Record<SourceTab, number | undefined> = { "": allCount?.count, sa_judicial: saCount?.count, eg_naqd: egCount?.count };

    const hasFilters = cityFilter || courtFilter || yearFilter || judgeFilter;
    const clearFilters = () => { setCityFilter(""); setCourtFilter(""); setYearFilter(""); clearJudgeFilter(); };
    const isSearching = !!debouncedSearch;

    return (
        <div className="min-h-screen bg-muted/20">
            {/* Judge filter banner */}
            {judgeFilter && (
                <div className="bg-emerald-50 border-b border-emerald-200">
                    <div className="container mx-auto px-4 py-3 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                            <Gavel className="h-5 w-5 text-emerald-700" />
                        </div>
                        <div className="flex-1">
                            <div className="text-xs text-emerald-600 font-medium">أحكام القاضي</div>
                            <div className="text-base font-bold text-emerald-800">{judgeFilter}</div>
                        </div>
                        <Button variant="outline" size="sm" className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 gap-1" onClick={clearJudgeFilter}>
                            <X className="h-3.5 w-3.5" />
                            مسح
                        </Button>
                    </div>
                </div>
            )}

            {/* Hero / Search Header */}
            <div className="bg-gradient-to-b from-primary/5 to-background border-b">
                <div className="container mx-auto px-4 pt-8 pb-6">
                    <h1 className="text-3xl font-bold text-primary mb-1">الأحكام القضائية</h1>
                    <p className="text-muted-foreground text-sm mb-5">
                        قاعدة بيانات شاملة للأحكام الصادرة من المحاكم السعودية والمحاكم المصرية
                    </p>

                    {/* Big Search Bar */}
                    <div className="relative max-w-2xl">
                        <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                            placeholder="ابحث بكلمة أو عبارة في نصوص الأحكام..."
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
                    <div className="mt-3">
                        <Button
                            type="button"
                            variant={exactSearch ? "default" : "outline"}
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setExactSearch((v) => !v)}
                        >
                            <Search className="h-3.5 w-3.5" />
                            بحث حرفي
                        </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">بحث شائع للمحامي السعودي:</span>
                        {SAUDI_LEGAL_QUERIES.map((preset) => (
                            <button
                                key={preset}
                                onClick={() => setSearch(preset)}
                                className="rounded-full border bg-background px-3 py-1 hover:border-primary hover:text-primary transition-colors"
                            >
                                {preset}
                            </button>
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        يدعم البحث العبارات الدقيقة بين علامتي تنصيص مثل "مبدأ قضائي"، كما يحاول توسيع المصطلحات القانونية الشائعة تلقائيًا.
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b bg-background sticky top-0 z-20">
                <div className="container mx-auto px-4">
                    <div className="flex items-center gap-1.5 py-2 overflow-x-auto">
                        {TABS.map((tab) => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap border ${
                                    activeTab === tab.key ? tab.activeColor : tab.color
                                }`}
                            >
                                {tab.icon}
                                <span className="hidden sm:inline">{tab.label}</span>
                                <span className="sm:hidden">{tab.shortLabel}</span>
                                {tabCounts[tab.key] !== undefined && (
                                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded-md ${
                                        activeTab === tab.key ? "bg-white/20" : "bg-muted"
                                    }`}>
                                        {tabCounts[tab.key]!.toLocaleString("ar-SA")}
                                    </span>
                                )}
                            </button>
                        ))}

                        {/* Spacer */}
                        <div className="flex-grow" />

                        {/* Filters + Sort */}
                        <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
                            <SheetTrigger asChild>
                                <Button variant={hasFilters ? "default" : "outline"} size="sm" className="gap-1.5">
                                    <SlidersHorizontal className="h-3.5 w-3.5" />
                                    تصفية
                                    {hasFilters && (
                                        <span className="bg-white/20 text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                                            {[cityFilter, courtFilter, yearFilter].filter(Boolean).length}
                                        </span>
                                    )}
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="right" className="w-80">
                                <SheetHeader>
                                    <SheetTitle>تصفية الأحكام</SheetTitle>
                                </SheetHeader>
                                <div className="mt-6 space-y-6">
                                    <div>
                                        <label className="text-sm font-medium mb-2 block">المدينة</label>
                                        <Select value={cityFilter} onValueChange={setCityFilter}>
                                            <SelectTrigger><SelectValue placeholder="جميع المدن" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="">جميع المدن</SelectItem>
                                                {facets?.cities?.map((c) => (
                                                    <SelectItem key={c.city} value={c.city}>{c.city} ({c.count})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium mb-2 block">المحكمة</label>
                                        <Select value={courtFilter} onValueChange={setCourtFilter}>
                                            <SelectTrigger><SelectValue placeholder="جميع المحاكم" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="">جميع المحاكم</SelectItem>
                                                {facets?.courts?.slice(0, 20).map((c) => (
                                                    <SelectItem key={c.court} value={c.court}>{c.court} ({c.count})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium mb-2 block">
                                            {activeTab === "eg_naqd" ? "السنة القضائية" : "السنة"}
                                        </label>
                                        <Select value={yearFilter} onValueChange={setYearFilter}>
                                            <SelectTrigger><SelectValue placeholder="جميع السنوات" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="">جميع السنوات</SelectItem>
                                                {facets?.years?.map((y) => (
                                                    <SelectItem key={y.year} value={y.year.toString()}>
                                                        {y.year}{activeTab === "eg_naqd" ? "" : "هـ"} ({y.count})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {hasFilters && (
                                        <Button variant="outline" onClick={clearFilters} className="w-full">مسح الفلاتر</Button>
                                    )}
                                </div>
                            </SheetContent>
                        </Sheet>

                        <Select value={sort} onValueChange={setSort}>
                            <SelectTrigger className="w-28 h-9 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="date">الأحدث</SelectItem>
                                <SelectItem value="year">السنة</SelectItem>
                                <SelectItem value="city">المدينة</SelectItem>
                                <SelectItem value="court">المحكمة</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Active Filters Pills */}
            {hasFilters && (
                <div className="border-b bg-background">
                    <div className="container mx-auto px-4 py-1.5 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">فلاتر:</span>
                        {cityFilter && (
                            <Badge variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => setCityFilter("")}>
                                {cityFilter} <X className="h-3 w-3" />
                            </Badge>
                        )}
                        {courtFilter && (
                            <Badge variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => setCourtFilter("")}>
                                {courtFilter} <X className="h-3 w-3" />
                            </Badge>
                        )}
                        {yearFilter && (
                            <Badge variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => setYearFilter("")}>
                                {yearFilter}{activeTab === "eg_naqd" ? "" : "هـ"} <X className="h-3 w-3" />
                            </Badge>
                        )}
                        {judgeFilter && (
                            <Badge variant="secondary" className="gap-1 text-xs cursor-pointer bg-emerald-100 text-emerald-800" onClick={clearJudgeFilter}>
                                <Gavel className="h-3 w-3" />
                                {judgeFilter} <X className="h-3 w-3" />
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            {/* Results */}
            <div className="container mx-auto px-4 py-5">
                {/* Result info */}
                {data?.pagination && (
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-muted-foreground">
                            {isSearching && <>نتائج البحث: </>}
                            <span className="font-medium text-foreground">{data.pagination.total.toLocaleString("ar-SA")}</span> حكم
                        </p>
                    </div>
                )}

                {isLoading ? (
                    <div className="space-y-4">
                        {Array(6).fill(0).map((_, i) => (
                            <Skeleton key={i} className="h-40 w-full rounded-xl" />
                        ))}
                    </div>
                ) : (
                    <>
                        {/* Cards */}
                        <div className="space-y-3 relative">
                            {isFetching && !isLoading && (
                                <div className="absolute inset-0 bg-background/40 z-10 rounded-xl" />
                            )}

                            {data?.data.map((item) => {
                                const isEg = item.source === "eg_naqd";
                                return (
                                    <Link key={item.id} href={`/judgments/${item.id}`} className="block">
                                        <div className={`group bg-background border rounded-xl p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer ${
                                            isEg ? "border-r-4 border-r-amber-400" : "border-r-4 border-r-emerald-400"
                                        }`}>
                                            {/* Top row: source badge + metadata */}
                                            <div className="flex items-start justify-between gap-3 mb-2">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {activeTab === "" && <SourceBadge source={item.source} />}
                                                    <span className="font-bold text-foreground">
                                                        {item.courtBody || "حكم قضائي"}
                                                    </span>
                                                    {item.circuitType && item.circuitType !== "غير محدد" && (
                                                        <Badge variant="outline" className="text-[10px] font-normal">
                                                            {item.circuitType}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <ArrowLeft className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
                                            </div>

                                            {/* Metadata chips */}
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3 flex-wrap">
                                                {item.city && (
                                                    <span className="flex items-center gap-1">
                                                        <MapPin className="h-3 w-3" />
                                                        {item.city}
                                                    </span>
                                                )}
                                                {item.yearHijri && (
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" />
                                                        {item.yearHijri}{isEg ? "" : "هـ"}
                                                    </span>
                                                )}
                                                {item.judgmentNumber && (
                                                    <span className="flex items-center gap-1">
                                                        <Hash className="h-3 w-3" />
                                                        {isEg ? `طعن ${item.judgmentNumber}` : item.judgmentNumber}
                                                    </span>
                                                )}
                                                {item.judgmentDate && (
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" />
                                                        {item.judgmentDate}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Snippet */}
                                            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                                                <HighlightedSnippet text={item.textSnippet} />
                                            </p>
                                        </div>
                                    </Link>
                                );
                            })}
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
                                    {((page - 1) * 20) + 1} - {Math.min(page * 20, data.pagination.total)} من {data.pagination.total.toLocaleString("ar-SA")}
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
