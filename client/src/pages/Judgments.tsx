
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
    ChevronDown,
    SlidersHorizontal,
    X,
    Eye
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

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

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

export default function Judgments() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [cityFilter, setCityFilter] = useState("");
    const [courtFilter, setCourtFilter] = useState("");
    const [yearFilter, setYearFilter] = useState("");
    const [sort, setSort] = useState("date");
    const [filterOpen, setFilterOpen] = useState(false);

    const debouncedSearch = useDebounce(search, 400);

    // Reset page when filters change
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, cityFilter, courtFilter, yearFilter]);

    const queryParams = useMemo(() => {
        const params = new URLSearchParams({
            page: page.toString(),
            limit: "25",
            sort,
        });
        if (debouncedSearch) params.set("q", debouncedSearch);
        if (cityFilter) params.set("city", cityFilter);
        if (courtFilter) params.set("court", courtFilter);
        if (yearFilter) params.set("year", yearFilter);
        return params.toString();
    }, [page, debouncedSearch, cityFilter, courtFilter, yearFilter, sort]);

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
        queryKey: ["judgments-facets"],
        queryFn: async () => {
            const res = await fetch("/api/judgments/facets");
            if (!res.ok) throw new Error("Failed to fetch facets");
            return res.json();
        },
        staleTime: 60000,
    });

    const hasFilters = cityFilter || courtFilter || yearFilter;

    const clearFilters = () => {
        setCityFilter("");
        setCourtFilter("");
        setYearFilter("");
    };

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <div className="border-b bg-muted/30">
                <div className="container mx-auto px-4 py-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h1 className="text-3xl font-bold text-primary">الأحكام القضائية</h1>
                            <p className="text-muted-foreground mt-1">
                                {data?.pagination?.total ? (
                                    <>{data.pagination.total.toLocaleString('ar-SA')} حكم</>
                                ) : (
                                    "جاري التحميل..."
                                )}
                            </p>
                        </div>

                        <div className="flex gap-3 w-full md:w-auto">
                            <div className="relative flex-grow md:w-80">
                                <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="بحث في نص الأحكام..."
                                    className="pr-9"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>

                            <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
                                <SheetTrigger asChild>
                                    <Button variant={hasFilters ? "default" : "outline"} className="gap-2">
                                        <SlidersHorizontal className="h-4 w-4" />
                                        <span className="hidden sm:inline">تصفية</span>
                                        {hasFilters && (
                                            <Badge variant="secondary" className="mr-1 h-5 w-5 p-0 justify-center">
                                                {[cityFilter, courtFilter, yearFilter].filter(Boolean).length}
                                            </Badge>
                                        )}
                                    </Button>
                                </SheetTrigger>
                                <SheetContent side="right" className="w-80">
                                    <SheetHeader>
                                        <SheetTitle>تصفية الأحكام</SheetTitle>
                                    </SheetHeader>
                                    <div className="mt-6 space-y-6">
                                        {/* City Filter */}
                                        <div>
                                            <label className="text-sm font-medium mb-2 block">المدينة</label>
                                            <Select value={cityFilter} onValueChange={setCityFilter}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="جميع المدن" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="">جميع المدن</SelectItem>
                                                    {facets?.cities?.map((c) => (
                                                        <SelectItem key={c.city} value={c.city}>
                                                            {c.city} ({c.count})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {/* Court Filter */}
                                        <div>
                                            <label className="text-sm font-medium mb-2 block">المحكمة</label>
                                            <Select value={courtFilter} onValueChange={setCourtFilter}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="جميع المحاكم" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="">جميع المحاكم</SelectItem>
                                                    {facets?.courts?.slice(0, 20).map((c) => (
                                                        <SelectItem key={c.court} value={c.court}>
                                                            {c.court} ({c.count})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {/* Year Filter */}
                                        <div>
                                            <label className="text-sm font-medium mb-2 block">السنة الهجرية</label>
                                            <Select value={yearFilter} onValueChange={setYearFilter}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="جميع السنوات" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="">جميع السنوات</SelectItem>
                                                    {facets?.years?.map((y) => (
                                                        <SelectItem key={y.year} value={y.year.toString()}>
                                                            {y.year}هـ ({y.count})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {hasFilters && (
                                            <Button variant="outline" onClick={clearFilters} className="w-full">
                                                مسح جميع الفلاتر
                                            </Button>
                                        )}
                                    </div>
                                </SheetContent>
                            </Sheet>

                            <Select value={sort} onValueChange={setSort}>
                                <SelectTrigger className="w-36">
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
            </div>

            {/* Active Filters */}
            {hasFilters && (
                <div className="border-b bg-muted/10">
                    <div className="container mx-auto px-4 py-2 flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-muted-foreground">الفلاتر النشطة:</span>
                        {cityFilter && (
                            <Badge variant="secondary" className="gap-1">
                                المدينة: {cityFilter}
                                <X className="h-3 w-3 cursor-pointer" onClick={() => setCityFilter("")} />
                            </Badge>
                        )}
                        {courtFilter && (
                            <Badge variant="secondary" className="gap-1">
                                المحكمة: {courtFilter}
                                <X className="h-3 w-3 cursor-pointer" onClick={() => setCourtFilter("")} />
                            </Badge>
                        )}
                        {yearFilter && (
                            <Badge variant="secondary" className="gap-1">
                                السنة: {yearFilter}هـ
                                <X className="h-3 w-3 cursor-pointer" onClick={() => setYearFilter("")} />
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            {/* Table */}
            <div className="container mx-auto px-4 py-6">
                {isLoading ? (
                    <div className="space-y-2">
                        {Array(10).fill(0).map((_, i) => (
                            <Skeleton key={i} className="h-16 w-full rounded" />
                        ))}
                    </div>
                ) : (
                    <>
                        <div className="border rounded-lg overflow-hidden bg-background relative">
                            {isFetching && (
                                <div className="absolute inset-0 bg-background/50 z-10" />
                            )}
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead className="w-[250px]">المحكمة</TableHead>
                                        <TableHead className="w-[100px]">المدينة</TableHead>
                                        <TableHead className="w-[80px]">السنة</TableHead>
                                        <TableHead className="w-[120px]">رقم الحكم</TableHead>
                                        <TableHead className="w-[100px]">التاريخ</TableHead>
                                        <TableHead>معاينة</TableHead>
                                        <TableHead className="w-[60px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data?.data.map((item) => (
                                        <TableRow key={item.id} className="hover:bg-muted/30 transition-colors">
                                            <TableCell>
                                                <div className="font-medium line-clamp-1">{item.courtBody || "—"}</div>
                                                {item.circuitType && (
                                                    <div className="text-xs text-muted-foreground line-clamp-1">{item.circuitType}</div>
                                                )}
                                            </TableCell>
                                            <TableCell>{item.city || "—"}</TableCell>
                                            <TableCell>
                                                <Badge variant="secondary" className="font-mono text-xs">
                                                    {item.yearHijri || "—"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-mono text-sm">{item.judgmentNumber || "—"}</TableCell>
                                            <TableCell className="text-sm text-muted-foreground">{item.judgmentDate || "—"}</TableCell>
                                            <TableCell>
                                                <p className="text-sm text-muted-foreground line-clamp-2 max-w-md">
                                                    {item.textSnippet ? `${item.textSnippet}...` : "—"}
                                                </p>
                                            </TableCell>
                                            <TableCell>
                                                <Link href={`/judgments/${item.id}`}>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                </Link>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>

                            {data?.data.length === 0 && (
                                <div className="py-12 text-center text-muted-foreground">
                                    <Filter className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                    <p>لا توجد نتائج مطابقة لبحثك</p>
                                </div>
                            )}
                        </div>

                        {/* Pagination */}
                        {data?.pagination && data.pagination.totalPages > 1 && (
                            <div className="flex justify-between items-center mt-4">
                                <div className="text-sm text-muted-foreground">
                                    عرض {((page - 1) * 25) + 1} - {Math.min(page * 25, data.pagination.total)} من {data.pagination.total.toLocaleString('ar-SA')}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                    >
                                        <ChevronRight className="h-4 w-4 ml-1" />
                                        السابق
                                    </Button>
                                    <span className="text-sm font-medium px-3">
                                        {page} / {data.pagination.totalPages}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
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
