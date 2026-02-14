import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, FileText, Building2, Calendar, ExternalLink, ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface Regulation {
  id: string;
  title_ar: string;
  jurisdiction_ar: string;
  doc_type: string;
  category: string;
  related_law_id: string;
  related_law_title: string;
  issuing_authority: string;
  issue_date_hijri: string;
  links: { source_id: string; url: string; label_ar: string }[];
  description_ar: string;
  status: string;
}

export default function Regulations() {
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/data/regulations.json")
      .then((res) => res.json())
      .then((data) => {
        setRegulations(data);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error loading regulations:", err);
        setIsLoading(false);
      });
  }, []);

  const filteredRegulations = regulations.filter(
    (item) =>
      item.title_ar.includes(search) ||
      item.related_law_title.includes(search) ||
      item.issuing_authority.includes(search) ||
      item.description_ar.includes(search)
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-primary/10 text-primary border-primary/20";
      case "amended":
        return "bg-accent/10 text-accent-foreground border-accent/20";
      case "cancelled":
        return "bg-destructive/10 text-destructive border-destructive/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "active":
        return "سارية";
      case "amended":
        return "معدلة";
      case "cancelled":
        return "ملغاة";
      default:
        return status;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 min-h-screen">
      {/* Header Section */}
      <div className="relative mb-12">
        <div className="absolute inset-0 bg-gradient-to-l from-primary/5 via-primary/10 to-transparent rounded-3xl" />
        <div className="relative px-8 py-12">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/25">
                  <FileText className="w-7 h-7 text-primary-foreground" />
                </div>
                <div>
                  <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-l from-primary to-primary/70 bg-clip-text text-transparent">
                    اللوائح التنفيذية
                  </h1>
                  <p className="text-muted-foreground mt-1">
                    تصفح اللوائح التنفيذية للأنظمة السعودية
                  </p>
                </div>
              </div>
            </div>

            <div className="relative w-full md:w-96">
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="ابحث في اللوائح التنفيذية..."
                className="pr-12 h-12 text-base rounded-xl border-2 focus:border-primary/50 transition-colors"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-6 mt-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span>{regulations.length} لائحة تنفيذية</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{regulations.filter((r) => r.status === "active").length} لائحة سارية</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array(6)
            .fill(0)
            .map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredRegulations.map((item) => (
            <Card
              key={item.id}
              className="group h-full hover:shadow-xl hover:shadow-primary/5 hover:border-primary/30 transition-all duration-300 cursor-pointer rounded-2xl overflow-hidden"
            >
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center group-hover:from-primary group-hover:to-primary/80 transition-all duration-300">
                    <FileText className="w-6 h-6 text-primary group-hover:text-primary-foreground transition-colors" />
                  </div>
                  <Badge
                    variant="outline"
                    className={`${getStatusColor(item.status)} text-xs font-medium`}
                  >
                    {getStatusLabel(item.status)}
                  </Badge>
                </div>
                <CardTitle className="mt-4 text-lg leading-relaxed group-hover:text-primary transition-colors line-clamp-2">
                  {item.title_ar}
                </CardTitle>
                <CardDescription className="text-sm line-clamp-2 mt-2">
                  {item.description_ar}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3 mb-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Building2 className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.issuing_authority}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4 shrink-0" />
                    <span>{item.issue_date_hijri} هـ</span>
                  </div>
                </div>

                {/* Related Law Link */}
                <Link
                  href={`/law/${item.related_law_id}`}
                  className="group/link flex items-center gap-2 p-3 rounded-lg bg-muted/50 hover:bg-primary/10 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 text-primary opacity-0 -translate-x-2 group-hover/link:opacity-100 group-hover/link:translate-x-0 transition-all" />
                  <span className="text-sm font-medium text-primary">
                    {item.related_law_title}
                  </span>
                </Link>

                {/* External Link */}
                {item.links[0] && (
                  <a
                    href={item.links[0].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 flex items-center justify-center gap-2 w-full p-2.5 rounded-lg border border-dashed border-muted-foreground/30 text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-all"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>الاطلاع على النص الرسمي</span>
                  </a>
                )}
              </CardContent>
            </Card>
          ))}

          {filteredRegulations.length === 0 && (
            <div className="col-span-full py-16 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-muted/50 flex items-center justify-center">
                <Filter className="w-10 h-10 text-muted-foreground/30" />
              </div>
              <h3 className="text-lg font-medium text-muted-foreground mb-2">
                لا توجد نتائج
              </h3>
              <p className="text-sm text-muted-foreground/70">
                جرب البحث بكلمات مختلفة
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
