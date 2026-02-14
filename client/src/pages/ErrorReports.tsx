import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface ErrorReport {
  id: number;
  lawId: string;
  articleNumber: number;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface LegalMonitoringSummary {
  generated_at: string;
  counts: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
}

function toHindiNumerals(num: number | string): string {
  const hindiDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return num.toString().replace(/[0-9]/g, (d) => hindiDigits[parseInt(d)]);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function ErrorReports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ reports: ErrorReport[] }>({
    queryKey: ["/api/error-reports"],
  });

  const {
    data: legalMonitoringData,
    isLoading: isLegalReportLoading,
  } = useQuery<{ report: LegalMonitoringSummary }>({
    queryKey: ["/api/legal-monitoring/report"],
    retry: false,
  });

  const runLegalMonitoringMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/legal-monitoring/run", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to run legal monitoring");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/legal-monitoring/report"] });
      toast({
        title: "تم تشغيل الرصد",
        description: "تم إنشاء تقرير الرصد القانوني/النظامي بنجاح.",
      });
    },
    onError: () => {
      toast({
        title: "تعذر التشغيل",
        description: "حدث خطأ أثناء تشغيل الرصد. حاول مرة أخرى.",
        variant: "destructive",
      });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/error-reports/${id}/resolve`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to resolve");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/error-reports"] });
      toast({ title: "تم", description: "تم تحديث حالة البلاغ" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/error-reports/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/error-reports"] });
      toast({ title: "تم", description: "تم حذف البلاغ" });
    },
  });

  const reports = data?.reports || [];
  const pendingReports = reports.filter(r => r.status === "pending");
  const resolvedReports = reports.filter(r => r.status === "resolved");

  if (isLoading) {
    return (
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">بلاغات الأخطاء</h1>
        <Link href="/law/civil_transactions_sa">
          <Button variant="outline" size="sm">العودة للنظام</Button>
        </Link>
      </div>

      <Card className="mb-6 border-primary/30">
        <CardHeader>
          <CardTitle className="text-lg">الرصد القانوني والنظامي المستمر</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLegalReportLoading ? (
            <p className="text-sm text-slate-500">جاري تحميل تقرير الرصد...</p>
          ) : legalMonitoringData?.report ? (
            <div className="text-sm text-slate-700 space-y-1">
              <p>آخر تشغيل: {formatDate(legalMonitoringData.report.generated_at)}</p>
              <p>
                النتائج: إجمالي {toHindiNumerals(legalMonitoringData.report.counts.total)} — عالي {toHindiNumerals(legalMonitoringData.report.counts.high)}،
                متوسط {toHindiNumerals(legalMonitoringData.report.counts.medium)}، منخفض {toHindiNumerals(legalMonitoringData.report.counts.low)}.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">لا يوجد تقرير رصد بعد. يمكنك تشغيله الآن.</p>
          )}

          <Button
            onClick={() => runLegalMonitoringMutation.mutate()}
            disabled={runLegalMonitoringMutation.isPending}
            data-testid="button-run-legal-monitoring"
          >
            {runLegalMonitoringMutation.isPending ? "جاري تشغيل الرصد..." : "تشغيل الرصد الآن"}
          </Button>
        </CardContent>
      </Card>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>لا توجد بلاغات حالياً</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {pendingReports.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Badge variant="destructive">{toHindiNumerals(pendingReports.length)}</Badge>
                بلاغات قيد المراجعة
              </h2>
              <div className="space-y-3">
                {pendingReports.map((report) => (
                  <Card key={report.id} className="border-amber-200 bg-amber-50/50">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline">المادة {toHindiNumerals(report.articleNumber)}</Badge>
                            <span className="text-xs text-slate-500">{formatDate(report.createdAt)}</span>
                          </div>
                          <p className="text-sm text-slate-700 leading-relaxed">{report.description}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => resolveMutation.mutate(report.id)}
                            disabled={resolveMutation.isPending}
                            title="تم الحل"
                            data-testid={`button-resolve-${report.id}`}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => deleteMutation.mutate(report.id)}
                            disabled={deleteMutation.isPending}
                            title="حذف"
                            data-testid={`button-delete-${report.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {resolvedReports.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-slate-500">
                <Badge variant="secondary">{toHindiNumerals(resolvedReports.length)}</Badge>
                تم حلها
              </h2>
              <div className="space-y-3">
                {resolvedReports.map((report) => (
                  <Card key={report.id} className="opacity-60">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline">المادة {toHindiNumerals(report.articleNumber)}</Badge>
                            <Badge variant="secondary" className="text-xs">تم الحل</Badge>
                          </div>
                          <p className="text-sm text-slate-500 leading-relaxed">{report.description}</p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50"
                          onClick={() => deleteMutation.mutate(report.id)}
                          disabled={deleteMutation.isPending}
                          title="حذف"
                          data-testid={`button-delete-resolved-${report.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
