import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileText,
  Calendar,
  Hash,
  X,
  Filter,
  SlidersHorizontal,
  Copy,
  Check,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface TameemItem {
  id: number;
  serial: string;
  tameem_number: string;
  tameem_date: string;
  subject: string;
  year_hijri: number;
  textPreview: string;
  text?: string;
}

interface TameemSubject {
  subject: string;
  count: number;
}

interface TameemsResponse {
  items: TameemItem[];
  total: number;
  page: number;
  limit: number;
  subjects: TameemSubject[];
}

function HighlightedText({ text }: { text: string }) {
  if (!text) return null;
  // Split by 【 and 】 markers from FTS snippet
  const parts = text.split(/(【[^】]*】)/);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("【") && part.endsWith("】")) {
          return <mark key={i} className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 rounded px-0.5">{part.slice(1, -1)}</mark>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export default function MojTameems() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const limit = 20;

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery<TameemsResponse>({
    queryKey: ["tameems", page, selectedSubject, selectedYear, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (selectedSubject) params.set("subject", selectedSubject);
      if (selectedYear) params.set("year", selectedYear);
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      const res = await fetch(`/api/tameems?${params}`);
      return res.json();
    },
  });

  // Fetch full tameem detail when expanded
  const { data: expandedTameem } = useQuery<TameemItem>({
    queryKey: ["tameem-detail", expandedId],
    queryFn: async () => {
      const res = await fetch(`/api/tameems/${expandedId}`);
      return res.json();
    },
    enabled: !!expandedId,
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  // Extract unique years from subjects data
  const years = useMemo(() => {
    if (!data?.items) return [];
    const yearSet = new Set(data.items.map(item => item.year_hijri).filter(Boolean));
    // Add common years
    for (let y = 1445; y >= 1380; y--) yearSet.add(y);
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [data]);

  // Items come from server already filtered
  const filteredItems = data?.items || [];

  const handleClearFilters = () => {
    setSelectedSubject("");
    setSelectedYear("");
    setSearch("");
    setPage(1);
  };

  const hasActiveFilters = !!selectedSubject || !!selectedYear || !!debouncedSearch;

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 mb-4">
          <FileText className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-bold text-primary mb-2">تعاميم وزارة العدل</h1>
        <p className="text-muted-foreground">
          {data ? `${data.total} تعميم` : "جارٍ التحميل..."}
          {data?.subjects && ` • ${data.subjects.length} موضوع`}
        </p>
      </div>

      {/* Search + Filter Toggle */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="بحث في التعاميم..."
            className="pr-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute left-3 top-3 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button
          variant={showFilters ? "default" : "outline"}
          onClick={() => setShowFilters(!showFilters)}
          className="gap-2 shrink-0"
        >
          <SlidersHorizontal className="h-4 w-4" />
          التصفية
          {hasActiveFilters && (
            <Badge variant="secondary" className="mr-1 text-xs">
              {[selectedSubject, selectedYear].filter(Boolean).length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="mb-6 p-4 bg-muted/30 rounded-xl border space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Filter className="h-4 w-4" />
              تصفية التعاميم
            </h3>
            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="text-xs text-primary hover:underline"
              >
                مسح الكل
              </button>
            )}
          </div>

          {/* Subject filter chips */}
          {data?.subjects && data.subjects.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">الموضوع</label>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {data.subjects.slice(0, 30).map((s) => (
                  <button
                    key={s.subject}
                    onClick={() => {
                      setSelectedSubject(selectedSubject === s.subject ? "" : s.subject);
                      setPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                      selectedSubject === s.subject
                        ? "bg-emerald-600 text-white"
                        : "bg-background border hover:border-emerald-500/50 hover:text-emerald-700"
                    }`}
                  >
                    {s.subject}
                    <span className="text-[10px] opacity-70 mr-1">({s.count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Year filter */}
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">السنة الهجرية</label>
            <div className="flex flex-wrap gap-1.5">
              {[1445, 1444, 1443, 1442, 1441, 1440, 1435, 1430, 1420, 1410, 1400, 1390].map((y) => (
                <button
                  key={y}
                  onClick={() => {
                    setSelectedYear(selectedYear === String(y) ? "" : String(y));
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                    selectedYear === String(y)
                      ? "bg-emerald-600 text-white"
                      : "bg-background border hover:border-emerald-500/50 hover:text-emerald-700"
                  }`}
                >
                  {y}هـ
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="space-y-4">
          {Array(6).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const isExpanded = expandedId === item.id;
              return (
                <div
                  key={item.id}
                  className={`bg-background border rounded-xl transition-all ${
                    isExpanded
                      ? "border-emerald-500/50 shadow-md border-r-4 border-r-emerald-500"
                      : "hover:border-emerald-500/30 hover:shadow-md border-r-4 border-r-emerald-500/40"
                  }`}
                >
                  {/* Clickable header - toggles expansion */}
                  <div
                    className="p-4 cursor-pointer select-none"
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-foreground leading-snug">{item.subject}</span>
                          <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-700 dark:text-emerald-400 shrink-0">
                            تعميم
                          </Badge>
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform mr-auto ${isExpanded ? "rotate-180" : ""}`} />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          {item.tameem_number && (
                            <span className="flex items-center gap-1">
                              <Hash className="h-3 w-3" />
                              {item.tameem_number}
                            </span>
                          )}
                          {item.tameem_date && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {item.tameem_date}
                            </span>
                          )}
                          {item.year_hijri && (
                            <span>{item.year_hijri}هـ</span>
                          )}
                        </div>
                        {!isExpanded && item.textPreview && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2 leading-relaxed text-justify">
                            <HighlightedText text={item.textPreview} />
                            {!item.textPreview.includes("】") && "..."}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded full text - NOT clickable, allows text selection */}
                  {isExpanded && (
                    <div
                      className="px-4 pb-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="pt-4 border-t">
                        <div className="text-sm leading-loose whitespace-pre-wrap text-foreground select-text text-justify" style={{ textAlignLast: "right" }}>
                          {expandedTameem?.text || item.textPreview + "..."}
                        </div>
                        <div className="mt-3 pt-3 border-t flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>المصدر: بوابة تعاميم وزارة العدل</span>
                            {item.serial && <span>• الرقم التسلسلي: {item.serial}</span>}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const fullText = expandedTameem?.text || item.textPreview || "";
                              const header = `تعميم رقم: ${item.tameem_number} | التاريخ: ${item.tameem_date} | الموضوع: ${item.subject}\n\n`;
                              navigator.clipboard.writeText(header + fullText);
                              setCopiedId(item.id);
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-muted hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground"
                          >
                            {copiedId === item.id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                <span className="text-emerald-600">تم النسخ</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                نسخ النص
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredItems.length === 0 && !isLoading && (
              <div className="text-center py-16 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-lg mb-1">لا توجد نتائج</p>
                <p className="text-sm">حاول تغيير معايير البحث أو التصفية</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
                السابق
              </button>

              <div className="flex items-center gap-1">
                {(() => {
                  const pages: (number | string)[] = [];
                  if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (page > 3) pages.push("...");
                    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
                      pages.push(i);
                    }
                    if (page < totalPages - 2) pages.push("...");
                    pages.push(totalPages);
                  }
                  return pages.map((pageNum, i) =>
                    typeof pageNum === "string" ? (
                      <span key={`dots-${i}`} className="px-2 text-muted-foreground">...</span>
                    ) : (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                          page === pageNum ? "bg-emerald-600 text-white" : "bg-muted hover:bg-muted/80"
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  );
                })()}
              </div>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                التالي
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
