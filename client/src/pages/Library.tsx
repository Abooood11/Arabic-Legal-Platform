import { useLibrary } from "@/hooks/use-data";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const CATEGORIES = [
  { value: "all", label: "الكل" },
  { value: "law", label: "أنظمة" },
  { value: "regulation", label: "لوائح" },
  { value: "decision", label: "قرارات" },
  { value: "gazette", label: "جريدة رسمية" },
  { value: "guide", label: "أدلة" },
];

const SOURCES = [
  { value: "all", label: "جميع المصادر" },
  { value: "boe", label: "هيئة الخبراء" },
  { value: "uqn", label: "جريدة أم القرى" },
  { value: "manual", label: "إدخال يدوي" },
];

const CATEGORY_LABELS: Record<string, string> = {
  law: "نظام",
  regulation: "لائحة",
  decision: "قرار",
  gazette: "جريدة رسمية",
  guide: "دليل",
};

const ITEMS_PER_PAGE = 30;

export default function Library() {
  const { data: library, isLoading } = useLibrary();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [page, setPage] = useState(1);

  const filteredLibrary = useMemo(() => {
    if (!library) return [];
    return library.filter(item => {
      const matchesSearch = !search ||
        item.title_ar.includes(search) ||
        item.jurisdiction_ar.includes(search);
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      const matchesSource = sourceFilter === "all" || item.primary_source_id === sourceFilter;
      return matchesSearch && matchesCategory && matchesSource;
    });
  }, [library, search, categoryFilter, sourceFilter]);

  const totalPages = Math.ceil((filteredLibrary?.length || 0) / ITEMS_PER_PAGE);
  const paginatedLibrary = filteredLibrary?.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE
  );

  const handleFilterChange = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="container mx-auto px-4 py-8 min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary mb-2">المكتبة القانونية</h1>
          <p className="text-muted-foreground">
            {filteredLibrary ? `${filteredLibrary.length} وثيقة` : "جارٍ التحميل..."}
            {library && filteredLibrary && filteredLibrary.length !== library.length &&
              ` من أصل ${library.length}`
            }
          </p>
        </div>

        <div className="relative w-full md:w-96">
          <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="بحث في المكتبة..."
            className="pr-9"
            value={search}
            onChange={(e) => handleFilterChange(setSearch, e.target.value)}
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => handleFilterChange(setCategoryFilter, cat.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                categoryFilter === cat.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {SOURCES.map((src) => (
            <button
              key={src.value}
              onClick={() => handleFilterChange(setSourceFilter, src.value)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                sourceFilter === src.value
                  ? "bg-blue-600 text-white"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"
              }`}
            >
              {src.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array(6).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {paginatedLibrary?.map((item) => (
              <Link key={item.id} href={`/law/${item.id}`}>
                <Card className="h-full hover:shadow-lg hover:border-primary/50 transition-all cursor-pointer group">
                  <CardHeader>
                    <div className="flex justify-between items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <BookOpen className="w-5 h-5" />
                      </div>
                      <Badge variant={item.category === 'law' ? 'default' : 'secondary'}>
                        {CATEGORY_LABELS[item.category] || item.category}
                      </Badge>
                    </div>
                    <CardTitle className="mt-4 text-xl leading-snug group-hover:text-primary transition-colors">
                      {item.title_ar}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-sm text-muted-foreground">
                        {item.jurisdiction_ar}
                      </p>
                      {item.primary_source_id === "uqn" && (
                        <Badge variant="outline" className="text-xs border-green-300 text-green-700">
                          أم القرى
                        </Badge>
                      )}
                    </div>

                    {item.laws_included && (
                      <div className="flex flex-wrap gap-2">
                        {item.laws_included.map((law, idx) => (
                          <span key={idx} className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
                            {law}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}

            {filteredLibrary?.length === 0 && (
              <div className="col-span-full py-12 text-center text-muted-foreground">
                <Filter className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>لا توجد نتائج مطابقة لبحثك</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
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
                  } else if (page <= 4) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 3) {
                    pageNum = totalPages - 6 + i;
                  } else {
                    pageNum = page - 3 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                        page === pageNum
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/80"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
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
