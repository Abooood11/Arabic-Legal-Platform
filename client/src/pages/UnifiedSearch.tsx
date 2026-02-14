import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HighlightedSnippet } from "@/components/search/HighlightedSnippet";
import { useDebounce } from "@/hooks/use-debounce";
import { useSearchHistory } from "@/hooks/use-search-history";
import {
  Search, X, BookOpen, Scale, Newspaper, Clock, ArrowLeft,
  Sparkles, MapPin, Calendar, Hash, Filter, Loader2, Zap,
  ChevronDown, ChevronUp, HelpCircle, Database, TrendingUp,
  Quote, Minus, SlidersHorizontal, BarChart3, FileText, ArrowRight,
  Building2, Gavel, Tag
} from "lucide-react";

// Types
interface SearchResult {
  query: string;
  totalResults: number;
  timeTaken: number;
  intent: {
    priority: string[];
    expandedTerms: string[];
    articleNumber: number | null;
    isLawName: boolean;
    cityHint: string | null;
  } | null;
  advanced: {
    phrases: string[];
    excluded: string[];
    fields: Record<string, string>;
    hasBooleanOps: boolean;
  } | null;
  facets: {
    years: { year: number; count: number }[];
    cities: { city: string; count: number }[];
    categories: { category: string; count: number }[];
  };
  crossLinks: {
    lawsToJudgments: string[];
    lawsToGazette: string[];
    relatedLaws: string[];
  };
  results: {
    laws: { items: LawResult[]; total: number };
    judgments: { items: JudgmentResult[]; total: number };
    gazette: { items: GazetteResult[]; total: number };
  };
}

interface LawResult {
  law_id: string;
  law_name: string;
  article_number: number;
  article_heading: string;
  textSnippet: string;
  rank: number;
}

interface JudgmentResult {
  id: number;
  case_id: string;
  year_hijri: number;
  city: string;
  court_body: string;
  judgment_date: string;
  source: string;
  textSnippet: string;
  rank: number;
}

interface GazetteResult {
  id: number;
  issue_year: number;
  issue_number: string;
  legislation_number: string;
  legislation_year: string;
  category: string;
  titleSnippet: string;
  rank: number;
}

interface SearchStats {
  totalDocuments: number;
  laws: { articles: number; laws: number };
  judgments: { total: number };
  gazette: { total: number };
}

interface TrendingSearch {
  query: string;
  count: number;
}

// Fire-and-forget click tracking (non-blocking)
function trackSearchClick(query: string, resultType: string, resultId: string, position: number) {
  try {
    fetch("/api/search/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, resultType, resultId, position }),
    }).catch(() => {});
  } catch {}
}

type TabKey = "all" | "laws" | "judgments" | "gazette";

const TABS: { key: TabKey; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { key: "all", label: "جميع النتائج", shortLabel: "الكل", icon: <Search className="h-4 w-4" /> },
  { key: "laws", label: "الأنظمة واللوائح", shortLabel: "الأنظمة", icon: <BookOpen className="h-4 w-4" /> },
  { key: "judgments", label: "الأحكام القضائية", shortLabel: "الأحكام", icon: <Scale className="h-4 w-4" /> },
  { key: "gazette", label: "كشاف أم القرى", shortLabel: "الكشاف", icon: <Newspaper className="h-4 w-4" /> },
];

// Search tips for the help tooltip
const SEARCH_TIPS = [
  { syntax: '"عبارة دقيقة"', description: 'البحث بعبارة مطابقة تماماً' },
  { syntax: '-كلمة', description: 'استبعاد كلمة من النتائج' },
  { syntax: 'محكمة:الرياض', description: 'تصفية حسب المحكمة' },
  { syntax: 'مادة:55', description: 'البحث عن رقم مادة محدد' },
  { syntax: 'سنة:1445', description: 'تصفية حسب السنة' },
  { syntax: '«عبارة بالعربي»', description: 'بحث دقيق بعلامات اقتباس عربية' },
];

export default function UnifiedSearch() {
  const [location, setLocation] = useLocation();

  // Parse URL params
  const urlParams = new URLSearchParams(window.location.search);
  const initialQ = urlParams.get("q") || "";
  const initialType = (urlParams.get("type") as TabKey) || "all";
  const initialPage = parseInt(urlParams.get("page") || "1");

  const [inputValue, setInputValue] = useState(initialQ);
  const [activeTab, setActiveTab] = useState<TabKey>(initialType);
  const [page, setPage] = useState(initialPage);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showAdvancedHelp, setShowAdvancedHelp] = useState(false);
  const [showFacets, setShowFacets] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { recentSearches, addSearch, removeSearch, clearHistory } = useSearchHistory();

  const debouncedQuery = useDebounce(inputValue, 400);

  // Update URL when search params change
  useEffect(() => {
    if (debouncedQuery) {
      const params = new URLSearchParams();
      params.set("q", debouncedQuery);
      if (activeTab !== "all") params.set("type", activeTab);
      if (page > 1) params.set("page", page.toString());
      window.history.replaceState(null, "", `/search?${params.toString()}`);
    }
  }, [debouncedQuery, activeTab, page]);

  // Save search to history
  useEffect(() => {
    if (debouncedQuery && debouncedQuery.length >= 2) {
      addSearch(debouncedQuery);
    }
  }, [debouncedQuery, addSearch]);

  // Main search query
  const { data, isLoading, isFetching } = useQuery<SearchResult>({
    queryKey: ["unified-search", debouncedQuery, activeTab, page],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        q: debouncedQuery,
        type: activeTab,
        page: page.toString(),
        limit: activeTab === "all" ? "5" : "15",
      });
      const res = await fetch(`/api/search?${params}`, { signal });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000,
    placeholderData: (prev) => prev,
  });

  // Search stats
  const { data: stats } = useQuery<SearchStats>({
    queryKey: ["search-stats"],
    queryFn: async () => {
      const res = await fetch("/api/search/stats");
      return res.json();
    },
    staleTime: 3600000,
  });

  // Trending searches (most popular in last 7 days)
  const { data: trending } = useQuery<TrendingSearch[]>({
    queryKey: ["search-trending"],
    queryFn: async () => {
      const res = await fetch("/api/search/trending");
      return res.json();
    },
    staleTime: 300000, // 5 minutes
  });

  // Suggestions query
  const { data: suggestions } = useQuery<{ text: string; type: string }[]>({
    queryKey: ["search-suggest", inputValue],
    queryFn: async () => {
      const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(inputValue)}`);
      return res.json();
    },
    enabled: inputValue.length >= 1 && showSuggestions && !debouncedQuery,
    staleTime: 60000,
  });

  const handleSearch = useCallback((query: string) => {
    setInputValue(query);
    setPage(1);
    setShowSuggestions(false);
    inputRef.current?.blur();
  }, []);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setPage(1);
  };

  // Append filter to query
  const appendFilter = useCallback((filter: string) => {
    const newValue = inputValue.trim() + " " + filter;
    setInputValue(newValue);
    setPage(1);
    inputRef.current?.focus();
  }, [inputValue]);

  const tabCounts = data ? {
    all: data.totalResults,
    laws: data.results.laws.total,
    judgments: data.results.judgments.total,
    gazette: data.results.gazette.total,
  } : { all: 0, laws: 0, judgments: 0, gazette: 0 };

  const hasResults = data && data.totalResults > 0;
  const isSearchActive = debouncedQuery.length >= 2;

  // Auto-focus search input
  useEffect(() => {
    if (!initialQ) inputRef.current?.focus();
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        setShowAdvancedHelp(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Hero / Search Header */}
      <div className="bg-gradient-to-b from-primary/5 to-background border-b">
        <div className="container mx-auto px-4 pt-8 pb-6">
          <div className="max-w-3xl mx-auto text-center mb-6">
            <h1 className="text-3xl font-bold text-primary mb-2">البحث الموحد</h1>
            <p className="text-muted-foreground text-sm">
              ابحث في الأنظمة والأحكام القضائية وكشاف أم القرى من مكان واحد
            </p>
            {/* Database stats */}
            {stats && (
              <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground/70">
                <span className="flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  {stats.totalDocuments.toLocaleString("ar-SA")} وثيقة
                </span>
                <span>{stats.laws.laws.toLocaleString("ar-SA")} نظام</span>
                <span>{stats.judgments.total.toLocaleString("ar-SA")} حكم</span>
                <span>{stats.gazette.total.toLocaleString("ar-SA")} إصدار</span>
              </div>
            )}
          </div>

          {/* Search Bar */}
          <div className="relative max-w-3xl mx-auto">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder='ابحث عن نظام، مادة قانونية، حكم قضائي... (استخدم "عبارة" للبحث الدقيق)'
              className="pr-12 pl-20 h-14 text-lg rounded-2xl shadow-md border-2 focus:border-primary/50 transition-all"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setShowSuggestions(false);
                }
              }}
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {inputValue && (
                <button
                  onClick={() => { setInputValue(""); inputRef.current?.focus(); }}
                  className="text-muted-foreground hover:text-foreground p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => setShowAdvancedHelp(!showAdvancedHelp)}
                className={`p-1 transition-colors ${showAdvancedHelp ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
                title="نصائح البحث المتقدم"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
              {!inputValue && (
                <span className="text-[10px] text-muted-foreground/40 hidden md:block">
                  Ctrl+K
                </span>
              )}
            </div>

            {/* Advanced Search Help Panel */}
            {showAdvancedHelp && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-background border rounded-xl shadow-xl z-50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-sm text-primary flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    البحث المتقدم
                  </h3>
                  <button onClick={() => setShowAdvancedHelp(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SEARCH_TIPS.map((tip, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        appendFilter(tip.syntax);
                        setShowAdvancedHelp(false);
                      }}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 text-right transition-colors"
                    >
                      <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono shrink-0 text-primary">{tip.syntax}</code>
                      <span className="text-xs text-muted-foreground">{tip.description}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                  <p>💡 يمكنك دمج عدة عوامل: <code className="bg-muted px-1 rounded">"نظام العمل" مادة:55 -ملغاة</code></p>
                </div>
              </div>
            )}

            {/* Suggestions Dropdown */}
            {showSuggestions && !isSearchActive && !showAdvancedHelp && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-background border rounded-xl shadow-xl z-50 overflow-hidden">
                {/* Recent Searches */}
                {recentSearches.length > 0 && (
                  <div className="p-3 border-b">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground">عمليات بحث سابقة</span>
                      <button onClick={clearHistory} className="text-xs text-primary hover:underline">مسح</button>
                    </div>
                    {recentSearches.slice(0, 5).map((search, i) => (
                      <button
                        key={i}
                        onClick={() => handleSearch(search)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-muted/50 text-sm text-right"
                      >
                        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{search}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeSearch(search); }}
                          className="text-muted-foreground/50 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </button>
                    ))}
                  </div>
                )}

                {/* API Suggestions */}
                {suggestions && suggestions.length > 0 && (
                  <div className="p-3">
                    <span className="text-xs font-medium text-muted-foreground mb-2 block">اقتراحات</span>
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSearch(s.text)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-muted/50 text-sm text-right"
                      >
                        {s.type === "law" && <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />}
                        {s.type === "court" && <Scale className="h-3.5 w-3.5 text-primary shrink-0" />}
                        {s.type === "gazette_category" && <Newspaper className="h-3.5 w-3.5 text-primary shrink-0" />}
                        <span className="flex-1 truncate">{s.text}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Empty state */}
                {recentSearches.length === 0 && (!suggestions || suggestions.length === 0) && (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    ابدأ بكتابة كلمة للبحث
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Search Stats & Advanced Indicators */}
          {isSearchActive && data && (
            <div className="max-w-3xl mx-auto mt-4">
              <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  {data.totalResults.toLocaleString("ar-SA")} نتيجة
                </span>
                <span>في {data.timeTaken} مللي ثانية</span>
                {data.intent?.expandedTerms && data.intent.expandedTerms.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
                    بحث موسّع: {data.intent.expandedTerms.slice(0, 3).join("، ")}
                  </span>
                )}
              </div>

              {/* Advanced query indicators */}
              {data.advanced?.hasBooleanOps && (
                <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                  {data.advanced.phrases.map((phrase, i) => (
                    <Badge key={`p-${i}`} variant="secondary" className="text-[10px] gap-1">
                      <Quote className="h-2.5 w-2.5" />
                      {phrase}
                    </Badge>
                  ))}
                  {data.advanced.excluded.map((term, i) => (
                    <Badge key={`e-${i}`} variant="destructive" className="text-[10px] gap-1">
                      <Minus className="h-2.5 w-2.5" />
                      {term}
                    </Badge>
                  ))}
                  {Object.entries(data.advanced.fields).map(([key, val], i) => (
                    <Badge key={`f-${i}`} variant="outline" className="text-[10px] gap-1 border-primary/30">
                      <Filter className="h-2.5 w-2.5" />
                      {key}: {val}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Click outside to close dropdowns */}
      {(showSuggestions || showAdvancedHelp) && (
        <div className="fixed inset-0 z-40" onClick={() => { setShowSuggestions(false); setShowAdvancedHelp(false); }} />
      )}

      {/* Content Area */}
      <div className="container mx-auto px-4 py-6">
        {isSearchActive ? (
          <>
            {/* Tabs + Facet Toggle */}
            <div className="border-b bg-background sticky top-20 z-20 mb-6 -mx-4 px-4">
              <div className="flex items-center gap-1.5 py-2 overflow-x-auto max-w-4xl mx-auto">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => handleTabChange(tab.key)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap border ${
                      activeTab === tab.key
                        ? "bg-primary text-primary-foreground shadow-md border-primary"
                        : "text-muted-foreground hover:text-primary hover:bg-primary/5 border-transparent"
                    }`}
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                    {isSearchActive && tabCounts[tab.key] > 0 && (
                      <Badge variant={activeTab === tab.key ? "secondary" : "outline"} className="text-[10px] h-5 px-1.5 mr-1">
                        {tabCounts[tab.key].toLocaleString("ar-SA")}
                      </Badge>
                    )}
                  </button>
                ))}

                {/* Facets toggle button */}
                {data && (data.facets.years.length > 0 || data.facets.cities.length > 0 || data.facets.categories.length > 0) && (
                  <button
                    onClick={() => setShowFacets(!showFacets)}
                    className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap mr-auto ${
                      showFacets ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary"
                    }`}
                  >
                    <BarChart3 className="h-4 w-4" />
                    <span className="hidden sm:inline">تحليل النتائج</span>
                    {showFacets ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                )}
              </div>
            </div>

            {/* Results Layout */}
            <div className="max-w-4xl mx-auto flex gap-6">
              {/* Main Results */}
              <div className="flex-1 min-w-0 relative">
                {isFetching && !isLoading && (
                  <div className="absolute inset-0 bg-background/40 z-10 rounded-xl" />
                )}

                {isLoading ? (
                  <div className="space-y-4">
                    {Array(5).fill(0).map((_, i) => (
                      <Skeleton key={i} className="h-28 w-full rounded-xl" />
                    ))}
                  </div>
                ) : activeTab === "all" ? (
                  <AllResultsView data={data!} onTabChange={handleTabChange} />
                ) : activeTab === "laws" ? (
                  <LawResultsView items={data?.results.laws.items || []} total={data?.results.laws.total || 0} page={page} onPageChange={setPage} query={debouncedQuery} />
                ) : activeTab === "judgments" ? (
                  <JudgmentResultsView items={data?.results.judgments.items || []} total={data?.results.judgments.total || 0} page={page} onPageChange={setPage} query={debouncedQuery} />
                ) : (
                  <GazetteResultsView items={data?.results.gazette.items || []} total={data?.results.gazette.total || 0} page={page} onPageChange={setPage} query={debouncedQuery} />
                )}

                {/* No Results */}
                {!isLoading && data && data.totalResults === 0 && (
                  <div className="py-16 text-center">
                    <Filter className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
                    <p className="text-lg text-muted-foreground mb-2">لا توجد نتائج لـ "{debouncedQuery}"</p>
                    <p className="text-sm text-muted-foreground mb-4">جرّب كلمات بحث مختلفة أو أقل تحديداً</p>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">💡 نصائح:</span>
                      <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted" onClick={() => setShowAdvancedHelp(true)}>
                        استخدم البحث المتقدم
                      </Badge>
                      <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted" onClick={() => { setInputValue(debouncedQuery.split(/\s+/).slice(0, 2).join(" ")); }}>
                        قلّل كلمات البحث
                      </Badge>
                    </div>
                  </div>
                )}
              </div>

              {/* Facets Sidebar */}
              {showFacets && data && (
                <FacetsSidebar
                  facets={data.facets}
                  crossLinks={data.crossLinks}
                  onFilterClick={appendFilter}
                  activeTab={activeTab}
                />
              )}
            </div>
          </>
        ) : (
          /* Pre-search state */
          <div className="max-w-3xl mx-auto py-12 text-center">
            <Search className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
            <p className="text-lg text-muted-foreground mb-2">ابحث في منصة تشريع</p>
            <p className="text-sm text-muted-foreground mb-8">
              ابحث في الأنظمة واللوائح والأحكام القضائية وكشاف أم القرى
            </p>

            {/* Trending searches - from real user data */}
            {trending && trending.length > 0 && (
              <div className="mb-6">
                <p className="text-xs text-muted-foreground mb-3 flex items-center justify-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  الأكثر بحثاً هذا الأسبوع
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {trending.slice(0, 8).map((t, i) => (
                    <button
                      key={i}
                      onClick={() => handleSearch(t.query)}
                      className="px-3 py-1.5 rounded-full text-sm bg-primary/5 hover:bg-primary/15 hover:text-primary transition-colors border border-primary/10 flex items-center gap-1.5"
                    >
                      <span>{t.query}</span>
                      <span className="text-[10px] text-muted-foreground/60">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick search examples (fallback if no trending data yet) */}
            {(!trending || trending.length === 0) && (
              <div className="flex flex-wrap justify-center gap-2 mb-8">
                {["نظام العمل", "نظام المعاملات المدنية", "إيجار", "تحكيم تجاري", "ضريبة القيمة المضافة"].map((example) => (
                  <button
                    key={example}
                    onClick={() => handleSearch(example)}
                    className="px-3 py-1.5 rounded-full text-sm bg-muted hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}

            {/* Advanced search examples */}
            <div className="max-w-lg mx-auto text-right">
              <button
                onClick={() => setShowAdvancedHelp(!showAdvancedHelp)}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary mx-auto transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                أدوات البحث المتقدم
                {showAdvancedHelp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>

              {showAdvancedHelp && (
                <div className="mt-4 bg-muted/30 rounded-xl p-4 text-center">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SEARCH_TIPS.map((tip, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setInputValue(tip.syntax);
                          inputRef.current?.focus();
                        }}
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-background/80 text-right transition-colors"
                      >
                        <code className="text-xs bg-background px-2 py-0.5 rounded font-mono shrink-0 text-primary">{tip.syntax}</code>
                        <span className="text-xs text-muted-foreground">{tip.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Facets Sidebar - Dynamic Result Filtering
// ============================================

function FacetsSidebar({
  facets,
  crossLinks,
  onFilterClick,
  activeTab,
}: {
  facets: SearchResult["facets"];
  crossLinks: SearchResult["crossLinks"];
  onFilterClick: (filter: string) => void;
  activeTab: TabKey;
}) {
  return (
    <aside className="w-64 shrink-0 hidden lg:block">
      <div className="sticky top-32 space-y-4">
        {/* City facets */}
        {facets.cities.length > 0 && (activeTab === "all" || activeTab === "judgments") && (
          <div className="bg-background border rounded-xl p-3">
            <h4 className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              المدن
            </h4>
            <div className="space-y-1">
              {facets.cities.slice(0, 6).map((c, i) => (
                <button
                  key={i}
                  onClick={() => onFilterClick(`مدينة:${c.city}`)}
                  className="flex items-center justify-between w-full px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors"
                >
                  <span className="text-foreground">{c.city}</span>
                  <span className="text-muted-foreground">{c.count.toLocaleString("ar-SA")}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Year facets */}
        {facets.years.length > 0 && (activeTab === "all" || activeTab === "judgments") && (
          <div className="bg-background border rounded-xl p-3">
            <h4 className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              السنوات الهجرية
            </h4>
            <div className="space-y-1">
              {facets.years.slice(0, 6).map((y, i) => (
                <button
                  key={i}
                  onClick={() => onFilterClick(`سنة:${y.year}`)}
                  className="flex items-center justify-between w-full px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors"
                >
                  <span className="text-foreground">{y.year}هـ</span>
                  <span className="text-muted-foreground">{y.count.toLocaleString("ar-SA")}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category facets */}
        {facets.categories.length > 0 && (activeTab === "all" || activeTab === "gazette") && (
          <div className="bg-background border rounded-xl p-3">
            <h4 className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5" />
              فئات الكشاف
            </h4>
            <div className="space-y-1">
              {facets.categories.slice(0, 6).map((c, i) => (
                <button
                  key={i}
                  onClick={() => onFilterClick(`فئة:${c.category}`)}
                  className="flex items-center justify-between w-full px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors"
                >
                  <span className="text-foreground truncate max-w-[140px]">{c.category}</span>
                  <span className="text-muted-foreground shrink-0">{c.count.toLocaleString("ar-SA")}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Cross-links */}
        {crossLinks.relatedLaws.length > 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
            <h4 className="text-xs font-bold text-primary mb-2 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              أنظمة ذات صلة
            </h4>
            <div className="space-y-1">
              {crossLinks.relatedLaws.slice(0, 4).map((lawId, i) => (
                <Link
                  key={i}
                  href={`/law/${lawId}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-primary/10 transition-colors text-foreground"
                >
                  <FileText className="h-3 w-3 text-primary" />
                  <span className="truncate">{lawId}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ============================================
// Sub-components
// ============================================

function AllResultsView({ data, onTabChange }: { data: SearchResult; onTabChange: (tab: TabKey) => void }) {
  const sections: { key: TabKey; label: string; icon: React.ReactNode; items: any[]; total: number }[] = [];

  // Order sections by intent priority
  const priority = data.intent?.priority || ["laws", "judgments", "gazette"];

  for (const p of priority) {
    if (p === "laws" && data.results.laws.total > 0) {
      sections.push({ key: "laws", label: "الأنظمة واللوائح", icon: <BookOpen className="h-5 w-5" />, items: data.results.laws.items, total: data.results.laws.total });
    }
    if (p === "judgments" && data.results.judgments.total > 0) {
      sections.push({ key: "judgments", label: "الأحكام القضائية", icon: <Scale className="h-5 w-5" />, items: data.results.judgments.items, total: data.results.judgments.total });
    }
    if (p === "gazette" && data.results.gazette.total > 0) {
      sections.push({ key: "gazette", label: "كشاف أم القرى", icon: <Newspaper className="h-5 w-5" />, items: data.results.gazette.items, total: data.results.gazette.total });
    }
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <div key={section.key}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-primary font-bold">
              {section.icon}
              <span>{section.label}</span>
              <Badge variant="outline" className="text-xs">{section.total.toLocaleString("ar-SA")}</Badge>
            </div>
            {section.total > 5 && (
              <button
                onClick={() => onTabChange(section.key)}
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                عرض الكل
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="space-y-3">
            {section.key === "laws" && (section.items as LawResult[]).slice(0, 3).map((item, i) => (
              <LawResultCard key={i} item={item} query={data.query} index={i} />
            ))}
            {section.key === "judgments" && (section.items as JudgmentResult[]).slice(0, 3).map((item, i) => (
              <JudgmentResultCard key={i} item={item} query={data.query} index={i} />
            ))}
            {section.key === "gazette" && (section.items as GazetteResult[]).slice(0, 3).map((item, i) => (
              <GazetteResultCard key={i} item={item} query={data.query} index={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LawResultsView({ items, total, page, onPageChange, query }: { items: LawResult[]; total: number; page: number; onPageChange: (p: number) => void; query?: string }) {
  const totalPages = Math.ceil(total / 15);
  return (
    <div>
      <div className="space-y-3 mb-6">
        {items.map((item, i) => <LawResultCard key={i} item={item} query={query} index={i} />)}
      </div>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={onPageChange} />}
    </div>
  );
}

function JudgmentResultsView({ items, total, page, onPageChange, query }: { items: JudgmentResult[]; total: number; page: number; onPageChange: (p: number) => void; query?: string }) {
  const totalPages = Math.ceil(total / 15);
  return (
    <div>
      <div className="space-y-3 mb-6">
        {items.map((item, i) => <JudgmentResultCard key={i} item={item} query={query} index={i} />)}
      </div>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={onPageChange} />}
    </div>
  );
}

function GazetteResultsView({ items, total, page, onPageChange, query }: { items: GazetteResult[]; total: number; page: number; onPageChange: (p: number) => void; query?: string }) {
  const totalPages = Math.ceil(total / 15);
  return (
    <div>
      <div className="space-y-3 mb-6">
        {items.map((item, i) => <GazetteResultCard key={i} item={item} query={query} index={i} />)}
      </div>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={onPageChange} />}
    </div>
  );
}

// Result Cards

function LawResultCard({ item, query, index }: { item: LawResult; query?: string; index?: number }) {
  return (
    <Link href={`/law/${item.law_id}`} onClick={() => query && trackSearchClick(query, "laws", item.law_id, index || 0)}>
      <div className="group bg-background border rounded-xl p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer border-r-4 border-r-primary">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <BookOpen className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-bold text-foreground group-hover:text-primary transition-colors">{item.law_name}</span>
              {item.article_number > 0 && (
                <Badge variant="outline" className="text-xs border-primary/30 text-primary">المادة {item.article_number}</Badge>
              )}
            </div>
            {item.article_heading && (
              <p className="text-xs text-muted-foreground mb-1">{item.article_heading}</p>
            )}
            <div className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
              <HighlightedSnippet text={item.textSnippet} />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function JudgmentResultCard({ item, query, index }: { item: JudgmentResult; query?: string; index?: number }) {
  const isEg = item.source === "eg_naqd";
  return (
    <Link href={`/judgments/${item.id}`} onClick={() => query && trackSearchClick(query, "judgments", String(item.id), index || 0)}>
      <div className={`group bg-background border rounded-xl p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer border-r-4 ${
        isEg ? "border-r-amber-500" : "border-r-primary"
      }`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
            isEg ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 group-hover:bg-amber-600 group-hover:text-white" : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
          }`}>
            <Scale className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-bold text-foreground">{item.court_body || "حكم قضائي"}</span>
              <Badge variant="outline" className={`text-[10px] ${isEg ? "border-amber-600/30 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30" : "border-primary/30 text-primary"}`}>
                {isEg ? "مصر" : "السعودية"}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1 flex-wrap">
              {item.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{item.city}</span>}
              {item.year_hijri && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{item.year_hijri}هـ</span>}
              {item.case_id && <span className="flex items-center gap-1"><Hash className="h-3 w-3" />{item.case_id}</span>}
            </div>
            <div className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
              <HighlightedSnippet text={item.textSnippet} />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function GazetteResultCard({ item, query, index }: { item: GazetteResult; query?: string; index?: number }) {
  return (
    <div className="group bg-background border rounded-xl p-4 hover:shadow-md hover:border-primary/30 transition-all border-r-4 border-r-primary/50" onClick={() => query && trackSearchClick(query, "gazette", String(item.id), index || 0)}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center text-primary shrink-0">
          <Newspaper className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-foreground mb-1 leading-relaxed">
            <HighlightedSnippet text={item.titleSnippet} />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {item.category && <Badge variant="outline" className="text-[10px]">{item.category}</Badge>}
            {item.issue_year && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />عدد {item.issue_year}</span>}
            {item.legislation_number && <span className="flex items-center gap-1"><Hash className="h-3 w-3" />رقم {item.legislation_number}</span>}
            {item.legislation_year && <span>لعام {item.legislation_year}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Pagination

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  // Generate page numbers
  const pages = useMemo(() => {
    const items: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) items.push(i);
    } else {
      items.push(1);
      if (page > 3) items.push("...");
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) items.push(i);
      if (page < totalPages - 2) items.push("...");
      items.push(totalPages);
    }
    return items;
  }, [page, totalPages]);

  return (
    <div className="flex items-center justify-center gap-1.5 mt-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="gap-1"
      >
        <ArrowRight className="h-3.5 w-3.5" />
        السابق
      </Button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`dot-${i}`} className="px-2 text-muted-foreground text-sm">...</span>
        ) : (
          <Button
            key={p}
            variant={p === page ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(p as number)}
            className="w-9 h-9 p-0"
          >
            {(p as number).toLocaleString("ar-SA")}
          </Button>
        )
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="gap-1"
      >
        التالي
        <ArrowLeft className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
