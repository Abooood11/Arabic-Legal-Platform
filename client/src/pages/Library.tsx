import { useLibrary } from "@/hooks/use-data";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, BookOpen, ChevronLeft, ChevronRight, FileText, Tag } from "lucide-react";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";

type SearchMode = "name" | "content";

const FILTERS = [
  { value: "all", label: "الكل" },
  { value: "nizam", label: "نظام" },
  { value: "laiha", label: "لائحة" },
  { value: "qarar", label: "قرار" },
  { value: "ittifaq", label: "اتفاقية" },
  { value: "tanzim", label: "تنظيم" },
];

const FORM_LABELS: Record<string, string> = {
  nizam: "نظام",
  laiha: "لائحة",
  qarar: "قرار",
  ittifaq: "اتفاقية",
  tanzim: "تنظيم",
};

const CATEGORY_LABELS: Record<string, string> = {
  law: "نظام",
  regulation: "لائحة",
  decision: "قرار",
  gazette: "كشاف أم القرى",
  guide: "دليل",
};

const ITEMS_PER_PAGE = 30;

function classifySaudiForm(item: { category?: string; title_ar?: string }) {
  const title = item.title_ar || "";
  if (/(اتفاقية|معاهدة|مذكرة تفاهم|ميثاق|بروتوكول)/.test(title)) return "ittifaq";
  if (item.category === "regulation" || /(اللائحة|لائحة)/.test(title)) return "laiha";
  if (item.category === "law" || /(نظام|نظام أساسي|قانون)/.test(title)) return "nizam";
  if (item.category === "decision" || /(^قرار|قرار\s)/.test(title)) return "qarar";
  if (/(تنظيم|ترتيبات تنظيمية)/.test(title)) return "tanzim";
  return "qarar";
}

interface ContentSearchResult {
  law_id: string;
  law_name: string;
  article_number: number;
  article_heading: string | null;
  textSnippet: string;
}

export default function Library() {
  const { data: library, isLoading } = useLibrary();
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("name");
  const [formFilter, setFormFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Content search state
  const [contentResults, setContentResults] = useState<ContentSearchResult[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentPage, setContentPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Name-based filtering (client-side)
  const filteredLibrary = useMemo(() => {
    if (!library) return [];
    return library.filter((item) => {
      const form = classifySaudiForm(item);
      const matchesSearch = !search || searchMode !== "name" || item.title_ar.includes(search);
      const matchesForm = formFilter === "all" || form === formFilter;
      return matchesSearch && matchesForm;
    });
  }, [library, search, searchMode, formFilter]);

  const totalPages = searchMode === "name"
    ? Math.ceil((filteredLibrary?.length || 0) / ITEMS_PER_PAGE)
    : Math.ceil(contentTotal / ITEMS_PER_PAGE);

  const paginatedLibrary = filteredLibrary?.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Content search (server-side via API)
  const searchContent = useCallback(async (query: string, pageNum: number) => {
    if (query.length < 2) {
      setContentResults([]);
      setContentTotal(0);
      return;
    }
    setContentLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=laws&page=${pageNum}&limit=${ITEMS_PER_PAGE}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setContentResults(data.results?.laws?.items || []);
      setContentTotal(data.results?.laws?.total || 0);
    } catch {
      setContentResults([]);
      setContentTotal(0);
    } finally {
      setContentLoading(false);
    }
  }, []);

  // Debounced content search
  useEffect(() => {
    if (searchMode !== "content") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchContent(search, contentPage);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, searchMode, contentPage, searchContent]);

  const handleFilterChange = (value: string) => {
    setFormFilter(value);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
    setContentPage(1);
  };

  const handleModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
    setPage(1);
    setContentPage(1);
  };

  const currentPage = searchMode === "name" ? page : contentPage;
  const setCurrentPage = searchMode === "name" ? setPage : setContentPage;

  const isSearchActive = searchMode === "content" && search.length >= 2;
  const showNameResults = searchMode === "name";
  const showContentResults = isSearchActive;
  const isLoadingResults = searchMode === "name" ? isLoading : contentLoading;

  // Group content results by law
  const groupedContentResults = useMemo(() => {
    const groups: Record<string, { law_id: string; law_name: string; articles: ContentSearchResult[] }> = {};
    for (const r of contentResults) {
      if (!groups[r.law_id]) {
        groups[r.law_id] = { law_id: r.law_id, law_name: r.law_name, articles: [] };
      }
      groups[r.law_id].articles.push(r);
    }
    return Object.values(groups);
  }, [contentResults]);

  const resultCount = searchMode === "name"
    ? (filteredLibrary?.length || 0)
    : contentTotal;

  return (
    <div className="container mx-auto px-4 py-8 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-primary mb-2">الأنظمة واللوائح</h1>
        <p className="text-muted-foreground">
          {isLoadingResults ? "جارٍ التحميل..." : `${resultCount} نتيجة`}
          {searchMode === "name" && library && filteredLibrary && filteredLibrary.length !== library.length && ` من أصل ${library.length}`}
        </p>
      </div>

      {/* Search bar with mode toggle */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex gap-2 items-center">
          {/* Search mode toggle */}
          <div className="flex bg-muted rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => handleModeChange("name")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                searchMode === "name"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              بالاسم
            </button>
            <button
              onClick={() => handleModeChange("content")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                searchMode === "content"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              في المحتوى
            </button>
          </div>

          {/* Search input */}
          <div className="relative flex-1">
            <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchMode === "name" ? "ابحث باسم النظام أو اللائحة..." : "ابحث في نصوص المواد والأحكام..."}
              className="pr-9"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
        </div>

        {/* Filters - only show for name search mode */}
        {searchMode === "name" && (
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => handleFilterChange(f.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  formFilter === f.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      {isLoadingResults ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array(6).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Name search results */}
          {showNameResults && (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {paginatedLibrary?.map((item) => {
                const form = classifySaudiForm(item);
                return (
                  <Link key={item.id} href={`/law/${item.id}`}>
                    <Card className="h-full hover:shadow-lg hover:border-primary/50 transition-all cursor-pointer group">
                      <CardHeader>
                        <div className="flex justify-between items-start gap-2 flex-wrap">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                            <BookOpen className="w-5 h-5" />
                          </div>
                          <div className="flex items-center gap-1 flex-wrap justify-end">
                            <Badge variant={item.category === "law" ? "default" : "secondary"}>
                              {CATEGORY_LABELS[item.category] || item.category}
                            </Badge>
                            <Badge variant="outline" className="text-[11px] border-primary/30 text-primary">
                              {FORM_LABELS[form] || FORM_LABELS.qarar}
                            </Badge>
                          </div>
                        </div>
                        <CardTitle className="mt-4 text-xl leading-snug group-hover:text-primary transition-colors">
                          {item.title_ar}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-sm text-muted-foreground">{item.jurisdiction_ar}</p>
                          {item.primary_source_id === "uqn" && (
                            <Badge variant="outline" className="text-xs border-green-300 text-green-700">
                              أم القرى
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Content search results */}
          {showContentResults && (
            <div className="flex flex-col gap-4">
              {groupedContentResults.map((group) => (
                <Card key={group.law_id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <Link href={`/law/${group.law_id}`}>
                      <CardTitle className="text-lg text-primary hover:underline cursor-pointer flex items-center gap-2">
                        <BookOpen className="w-4 h-4 shrink-0" />
                        {group.law_name}
                      </CardTitle>
                    </Link>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-col gap-2">
                      {group.articles.map((article, idx) => (
                        <Link key={idx} href={`/law/${group.law_id}?article=${article.article_number}`}>
                          <div className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-xs shrink-0">
                                مادة {article.article_number}
                              </Badge>
                              {article.article_heading && (
                                <span className="text-sm font-medium text-foreground">{article.article_heading}</span>
                              )}
                            </div>
                            <p
                              className="text-sm text-muted-foreground leading-relaxed"
                              dangerouslySetInnerHTML={{
                                __html: (article.textSnippet || "")
                                  .replace(/【/g, '<mark class="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">')
                                  .replace(/】/g, "</mark>"),
                              }}
                            />
                          </div>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Content search - prompt to type */}
          {searchMode === "content" && search.length < 2 && !contentLoading && (
            <div className="py-16 text-center text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>اكتب كلمتين على الأقل للبحث في محتوى الأنظمة</p>
            </div>
          )}

          {/* No results */}
          {!isLoadingResults && resultCount === 0 && (showNameResults || (showContentResults && search.length >= 2)) && (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              <Filter className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>لا توجد نتائج مطابقة لبحثك</p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <button
                onClick={() => setCurrentPage((p: number) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
                السابق
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 7) {
                    pageNum = i + 1;
                  } else if (currentPage <= 4) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 3) {
                    pageNum = totalPages - 6 + i;
                  } else {
                    pageNum = currentPage - 3 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                        currentPage === pageNum ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage((p: number) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                التالي
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
