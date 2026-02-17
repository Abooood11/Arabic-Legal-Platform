import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  BookOpen,
  Scale,
  Newspaper,
  FileText,
  ArrowLeft,
  Zap,
  Shield,
  Globe,
  Sparkles,
  ChevronLeft,
  Database,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";

interface SearchStats {
  totalDocuments: number;
  laws: { articles: number; laws: number };
  judgments: { total: number };
  gazette: { total: number };
  tameems?: { total: number };
}

function formatNum(n: number): string {
  if (n >= 1000000) return `${Math.floor(n / 1000000)}.${Math.floor((n % 1000000) / 100000)}M+`;
  if (n >= 1000) return `${Math.floor(n / 1000)}K+`;
  return n.toLocaleString("en");
}

function StatCard({ icon: Icon, value, label, color }: { icon: any; value: string; label: string; color: string }) {
  return (
    <div className="flex flex-col items-center text-center p-6 rounded-2xl bg-background border shadow-sm hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${color}`}>
        <Icon className="w-6 h-6" />
      </div>
      <span className="text-2xl sm:text-3xl font-bold text-foreground mb-1">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="flex gap-4 p-5 rounded-2xl bg-background border hover:border-primary/30 hover:shadow-sm transition-all">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h3 className="font-bold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const { data: stats } = useQuery<SearchStats>({
    queryKey: ["search-stats"],
    queryFn: async () => {
      const res = await fetch("/api/search/stats");
      return res.json();
    },
    staleTime: 3600000,
  });

  return (
    <div className="min-h-screen">
      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.08] via-primary/[0.03] to-background" />
        <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-14 sm:pt-20 sm:pb-20">
          <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-8 items-center">
            <div className="text-center lg:text-right">
              <Badge variant="secondary" className="mb-4 text-sm px-4 py-1.5 gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                منصة قانونية سعودية متكاملة
              </Badge>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-5">
                كل ما يحتاجه
                <span className="text-primary"> العميل القانوني السعودي </span>
                في مكان واحد
              </h1>

              <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed mb-8 max-w-2xl mx-auto lg:mx-0">
                ابحث فورًا في الأنظمة واللوائح والأحكام والتعاميم من مصادر رسمية، مع واجهة واضحة وسريعة للباحثين والمستشارين القانونيين.
              </p>

              <div className="flex flex-col sm:flex-row items-center lg:items-start gap-3 sm:gap-4">
                <Link href="/search">
                  <Button size="lg" className="gap-2 h-13 px-8 text-base shadow-lg shadow-primary/25">
                    <Search className="w-5 h-5" />
                    ابدأ البحث الآن
                  </Button>
                </Link>
                <Link href="/library">
                  <Button variant="outline" size="lg" className="gap-2 h-13 px-8 text-base">
                    تصفح الأنظمة واللوائح
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border bg-background p-5 sm:p-6 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">حجم قاعدة البيانات القانونية</p>
                    <p className="text-2xl sm:text-3xl font-bold text-foreground">
                      {stats ? formatNum(stats.totalDocuments) : "..."} وثيقة قابلة للبحث
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">تغطي التشريعات والأحكام والإصدارات الرسمية السعودية.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border bg-background p-5 shadow-sm grid sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  بحث موحّد في مصدر واحد
                </div>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  محدث من مصادر رسمية
                </div>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  تنقل سريع بين المواد
                </div>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  واجهة واضحة بدون تشتت
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {stats && (
        <section className="py-14 bg-muted/30 border-b">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto rounded-2xl border bg-background p-5 sm:p-6 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">أرقام المنصة اليوم</p>
                  <p className="text-2xl sm:text-3xl font-bold text-foreground">{formatNum(stats.totalDocuments)} وثيقة قانونية متاحة للبحث</p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-emerald-700 dark:text-emerald-400 text-sm">
                  <TrendingUp className="w-4 h-4" />
                  تحديث مستمر من مصادر رسمية
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-4xl mx-auto">
              <StatCard icon={BookOpen} value={formatNum(stats.laws.articles)} label="مادة نظامية" color="bg-primary/10 text-primary" />
              <StatCard icon={Scale} value={formatNum(stats.judgments.total)} label="حكم قضائي" color="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400" />
              <StatCard icon={Newspaper} value={formatNum(stats.gazette.total)} label="إصدار جريدة رسمية" color="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400" />
              <StatCard icon={FileText} value={formatNum(stats.tameems?.total || 0)} label="تعميم وزاري" color="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400" />
            </div>
          </div>
        </section>
      )}

      <section className="py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">أدوات مصممة للقانونيين</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              تجربة بحث متقدمة مع خصائص عملية تخدم المحامي والباحث والمستشار القانوني
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl mx-auto">
            <FeatureCard icon={Search} title="بحث ذكي ومتقدم" description="ابحث بالكلمات والجذور، ونقّح النتائج حسب الجهة والسنة والنوع للوصول إلى النص الأدق بسرعة." />
            <FeatureCard icon={Sparkles} title="شرح فوري بالذكاء الاصطناعي" description="اضغط على أي مادة نظامية واحصل على شرح مبسّط يساعدك في فهم المقصود القانوني بسرعة." />
            <FeatureCard icon={Globe} title="مقارنة تشريعية دولية" description="قارن مواد الأنظمة السعودية مع تشريعات دولية في شاشة واحدة لتكوين رؤية أشمل." />
            <FeatureCard icon={Zap} title="ربط تلقائي بين المواد" description="الإحالات النظامية تتحول إلى روابط تفاعلية لتنتقل بين النصوص بدون بحث يدوي متكرر." />
            <FeatureCard icon={Scale} title="أحكام قضائية شاملة" description="الوصول إلى قاعدة أحكام واسعة مع تنظيم يساعدك على البحث بالقضية والجهة والسنة." />
            <FeatureCard icon={Shield} title="مصادر رسمية موثوقة" description="البيانات مستخرجة من المصادر الرسمية المعتمدة لضمان موثوقية المحتوى القانوني." />
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted/30 border-y">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">وصول سريع لأقسام المنصة</h2>
            <p className="text-muted-foreground text-lg">رتّبنا الأقسام وفق الأولوية الأكثر طلبًا لدى العملاء</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
            <Link href="/library">
              <div className="group p-6 rounded-2xl bg-background border hover:border-primary/50 hover:shadow-lg transition-all cursor-pointer text-center">
                <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-primary mx-auto mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <BookOpen className="w-7 h-7" />
                </div>
                <h3 className="font-bold text-foreground mb-1 group-hover:text-primary transition-colors">الأنظمة واللوائح</h3>
                <p className="text-xs text-muted-foreground">{stats ? `${stats.laws.laws.toLocaleString("en")} نظام ولائحة` : "تحميل..."}</p>
                <ArrowLeft className="w-4 h-4 text-muted-foreground mx-auto mt-3 group-hover:text-primary transition-colors" />
              </div>
            </Link>

            <Link href="/judgments">
              <div className="group p-6 rounded-2xl bg-background border hover:border-amber-500/50 hover:shadow-lg transition-all cursor-pointer text-center">
                <div className="w-14 h-14 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center text-amber-700 dark:text-amber-400 mx-auto mb-4 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                  <Scale className="w-7 h-7" />
                </div>
                <h3 className="font-bold text-foreground mb-1 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors">الأحكام القضائية</h3>
                <p className="text-xs text-muted-foreground">{stats ? `${formatNum(stats.judgments.total)} حكم` : "تحميل..."}</p>
                <ArrowLeft className="w-4 h-4 text-muted-foreground mx-auto mt-3 group-hover:text-amber-600 transition-colors" />
              </div>
            </Link>

            <Link href="/gazette">
              <div className="group p-6 rounded-2xl bg-background border hover:border-blue-500/50 hover:shadow-lg transition-all cursor-pointer text-center">
                <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center text-blue-700 dark:text-blue-400 mx-auto mb-4 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Newspaper className="w-7 h-7" />
                </div>
                <h3 className="font-bold text-foreground mb-1 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">كشاف أم القرى</h3>
                <p className="text-xs text-muted-foreground">{stats ? `${formatNum(stats.gazette.total)} إصدار` : "تحميل..."}</p>
                <ArrowLeft className="w-4 h-4 text-muted-foreground mx-auto mt-3 group-hover:text-blue-600 transition-colors" />
              </div>
            </Link>

            <Link href="/tameems">
              <div className="group p-6 rounded-2xl bg-background border hover:border-emerald-500/50 hover:shadow-lg transition-all cursor-pointer text-center">
                <div className="w-14 h-14 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400 mx-auto mb-4 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  <FileText className="w-7 h-7" />
                </div>
                <h3 className="font-bold text-foreground mb-1 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">التعاميم</h3>
                <p className="text-xs text-muted-foreground">{stats?.tameems ? `${stats.tameems.total} تعميم` : "تعاميم وزارة العدل"}</p>
                <ArrowLeft className="w-4 h-4 text-muted-foreground mx-auto mt-3 group-hover:text-emerald-600 transition-colors" />
              </div>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center bg-gradient-to-br from-primary/5 via-primary/[0.02] to-accent/5 rounded-3xl p-10 sm:p-14 border">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">ابدأ بحثك القانوني الآن</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              في ثوانٍ، ستصل إلى النظام أو المادة أو الحكم الذي تبحث عنه عبر محرك بحث قانوني موحّد ومصمم للسعودية
            </p>
            <Link href="/search">
              <Button size="lg" className="gap-2 h-13 px-10 text-base shadow-lg shadow-primary/25">
                <Search className="w-5 h-5" />
                ابدأ البحث العميق
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
