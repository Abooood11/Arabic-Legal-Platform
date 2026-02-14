import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, Activity, Users, ShieldAlert, BarChart3, AlertTriangle, Globe, Clock3 } from "lucide-react";
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

export default function AdminDashboard() {
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
          <Link href="/admin/reports"><Button variant="outline">بلاغات الأخطاء</Button></Link>
        </div>
      </div>

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
    </div>
  );
}
