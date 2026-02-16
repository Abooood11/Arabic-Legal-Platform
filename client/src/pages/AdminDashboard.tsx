import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, Activity, Users, ShieldAlert, BarChart3, AlertTriangle, Globe, Clock3, FileSearch, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

type Pair = { label: string; count: number };

type DashboardResponse = {
  overview: {
    usersTotal: number;
    adminsTotal: number;
    activeSubscriptions: number;
    pendingErrorReports: number;
    legalMonitoringFindings: number;
    visitsTotal: number;
    uniqueVisitors7d: number;
    avgSessionDurationSec: number;
  };
  subscriptionsByTier: Array<{ tier: string; count: number }>;
  loginActivity7d: Array<{ day: string; success: number; failed: number }>;
  topEntryPages: Pair[];
  topSources: Pair[];
  countries: Pair[];
  ageRanges: Pair[];
};

type ExtractionLaw = {
  id: string;
  fileName: string;
  title: string;
  totalArticles: number | null;
  actualArticles: number;
  hasEmptyArticles: number;
  hasPreamble: boolean;
  hasRoyalDecree: boolean;
  hasCabinetDecision: boolean;
  missingText: number;
  duplicateNumbers: number[];
  issues: string[];
};

type ExtractionDebugResponse = {
  summary: {
    totalLaws: number;
    healthyLaws: number;
    lawsWithIssues: number;
    totalIssues: number;
  };
  laws: ExtractionLaw[];
};

function ExtractionDebugPanel() {
  const { data, isLoading, error } = useQuery<ExtractionDebugResponse>({
    queryKey: ["/api/admin/extraction-debug"],
    retry: false,
    staleTime: 0,
  });
  const [filter, setFilter] = useState<"all" | "issues" | "healthy">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }
  if (error || !data) return <p className="text-destructive text-sm">فشل تحميل بيانات الاستخراج: {error?.message || "لا توجد بيانات"}</p>;

  const filtered = data.laws.filter((l) => {
    if (filter === "issues") return l.issues.length > 0;
    if (filter === "healthy") return l.issues.length === 0;
    return true;
  });

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">إجمالي الأنظمة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{data.summary.totalLaws}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" />سليمة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-green-600">{data.summary.healthyLaws}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><XCircle className="w-4 h-4 text-red-600" />بها مشاكل</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-red-600">{data.summary.lawsWithIssues}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">إجمالي المشاكل</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-orange-600">{data.summary.totalIssues}</p></CardContent></Card>
      </div>

      <div className="flex gap-2">
        <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>الكل ({data.summary.totalLaws})</Button>
        <Button variant={filter === "issues" ? "default" : "outline"} size="sm" onClick={() => setFilter("issues")}>بها مشاكل ({data.summary.lawsWithIssues})</Button>
        <Button variant={filter === "healthy" ? "default" : "outline"} size="sm" onClick={() => setFilter("healthy")}>سليمة ({data.summary.healthyLaws})</Button>
      </div>

      <div className="space-y-2">
        {filtered.map((law) => (
          <Card key={law.id} className={law.issues.length > 0 ? "border-red-200 dark:border-red-900" : "border-green-200 dark:border-green-900"}>
            <div className="flex items-center justify-between px-4 py-3 cursor-pointer" onClick={() => toggle(law.id)}>
              <div className="flex items-center gap-3">
                {law.issues.length > 0 ? <XCircle className="w-5 h-5 text-red-500 shrink-0" /> : <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />}
                <div>
                  <p className="font-medium text-sm">{law.title}</p>
                  <p className="text-xs text-muted-foreground">{law.actualArticles} مادة | {law.fileName}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {law.issues.length > 0 && <Badge variant="destructive">{law.issues.length} مشكلة</Badge>}
                {expanded.has(law.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </div>
            {expanded.has(law.id) && (
              <CardContent className="pt-0 border-t">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3 pt-3">
                  <div><span className="text-muted-foreground">المواد المعلنة:</span> <span className="font-medium">{law.totalArticles ?? "غير محدد"}</span></div>
                  <div><span className="text-muted-foreground">المواد الفعلية:</span> <span className="font-medium">{law.actualArticles}</span></div>
                  <div><span className="text-muted-foreground">ديباجة:</span> {law.hasPreamble ? <Badge variant="secondary" className="text-xs">موجودة</Badge> : <Badge variant="outline" className="text-xs">مفقودة</Badge>}</div>
                  <div><span className="text-muted-foreground">مرسوم ملكي:</span> {law.hasRoyalDecree ? <Badge variant="secondary" className="text-xs">موجود</Badge> : <Badge variant="outline" className="text-xs">مفقود</Badge>}</div>
                </div>
                {law.issues.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-red-600">المشاكل:</p>
                    {law.issues.map((issue, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-red-600">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                )}
                {law.duplicateNumbers.length > 0 && (
                  <p className="text-sm text-orange-600 mt-2">مواد مكررة: {law.duplicateNumbers.join("، ")}</p>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "extraction">("overview");
  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: ["/api/admin/dashboard"],
    retry: false,
  });

  const tierChart = useMemo(() => (data?.subscriptionsByTier || []).map((r) => ({ ...r, name: r.tier })), [data]);
  const avgDurationMin = Math.round(((data?.overview.avgSessionDurationSec || 0) / 60) * 10) / 10;

  if (isLoading) {
    return <div className="container mx-auto py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="container mx-auto px-4 py-8" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">لوحة تحكم المسؤول</h1>
          <p className="text-muted-foreground">متابعة تشغيلية ومؤشرات أداء للنمو</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/audit"><Button variant="default">المراجعة الشاملة</Button></Link>
          <Link href="/admin/reports"><Button variant="outline">بلاغات الأخطاء</Button></Link>
        </div>
      </div>

      <div className="flex gap-2 mb-6 border-b pb-2">
        <Button variant={activeTab === "overview" ? "default" : "ghost"} onClick={() => setActiveTab("overview")} className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />نظرة عامة
        </Button>
        <Button variant={activeTab === "extraction" ? "default" : "ghost"} onClick={() => setActiveTab("extraction")} className="flex items-center gap-2">
          <FileSearch className="w-4 h-4" />استكشاف أخطاء الاستخراج
        </Button>
      </div>

      {activeTab === "extraction" ? (
        <ExtractionDebugPanel />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-6">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />إجمالي المستخدمين</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{data?.overview.usersTotal ?? 0}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldAlert className="w-4 h-4" />المسؤولون</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{data?.overview.adminsTotal ?? 0}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" />اشتراكات نشطة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{data?.overview.activeSubscriptions ?? 0}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" />بلاغات معلقة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{data?.overview.pendingErrorReports ?? 0}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Globe className="w-4 h-4" />إجمالي الزيارات</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{data?.overview.visitsTotal ?? 0}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />زوار فريدون (7 أيام)</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{data?.overview.uniqueVisitors7d ?? 0}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock3 className="w-4 h-4" />متوسط البقاء</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{avgDurationMin} د</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4" />رصد قانوني</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{data?.overview.legalMonitoringFindings ?? 0}</p><Badge variant="secondary">آخر تقرير</Badge></CardContent></Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2 mb-6">
            <Card>
              <CardHeader><CardTitle>توزيع الاشتراكات حسب الباقة</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tierChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>نشاط تسجيل الدخول (7 أيام)</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data?.loginActivity7d || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="success" stroke="#16a34a" strokeWidth={2} name="نجاح" />
                    <Line type="monotone" dataKey="failed" stroke="#dc2626" strokeWidth={2} name="فشل" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>من أين دخل الزوار؟ (Top Sources)</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(data?.topSources || []).map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-sm border-b pb-2">
                    <span>{item.label || "unknown"}</span>
                    <span className="font-semibold">{item.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>أكثر صفحات دخولًا</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(data?.topEntryPages || []).map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-sm border-b pb-2">
                    <span className="truncate max-w-[70%]">{item.label}</span>
                    <span className="font-semibold">{item.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>توزيع الدول</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(data?.countries || []).map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-sm border-b pb-2">
                    <span>{item.label || "unknown"}</span>
                    <span className="font-semibold">{item.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>شرائح الأعمار (حسب البيانات المتاحة)</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(data?.ageRanges || []).length ? (data?.ageRanges || []).map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-sm border-b pb-2">
                    <span>{item.label}</span>
                    <span className="font-semibold">{item.count}</span>
                  </div>
                )) : <p className="text-sm text-muted-foreground">لا توجد بيانات عمرية كافية بعد.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
