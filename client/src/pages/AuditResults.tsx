import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Loader2,
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldAlert,
  CheckCircle2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Play,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function toHindiNumerals(num: number | string): string {
  const hindiDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return num.toString().replace(/[0-9]/g, (d) => hindiDigits[parseInt(d)]);
}

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  critical: { label: "حرج", color: "text-red-700", bg: "bg-red-50 border-red-200", icon: ShieldAlert },
  high: { label: "عالي", color: "text-orange-700", bg: "bg-orange-50 border-orange-200", icon: AlertTriangle },
  medium: { label: "متوسط", color: "text-yellow-700", bg: "bg-yellow-50 border-yellow-200", icon: AlertCircle },
  low: { label: "منخفض", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", icon: Info },
};

const CATEGORY_LABELS: Record<string, string> = {
  structural: "بنية الأنظمة",
  content: "محتوى الأحكام",
  reference: "الإحالات المرجعية",
  health: "صحة النظام",
  ai_law: "تحليل ذكي — أنظمة",
  ai_judgment: "تحليل ذكي — أحكام",
};

const STATUS_LABELS: Record<string, string> = {
  open: "مفتوح",
  acknowledged: "تم الاطلاع",
  resolved: "تم الحل",
  wont_fix: "لن يُصلح",
};

interface AuditRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_laws_scanned: number;
  total_judgments_scanned: number;
  total_findings: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  progress_pct: number;
  current_step: string;
  summary: string | null;
}

interface Finding {
  id: number;
  severity: string;
  code: string;
  category: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  message: string;
  location: string | null;
  details: string | null;
  status: string;
  created_at: string;
}

export default function AuditResults() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [page, setPage] = useState(1);
  const [expandedSummary, setExpandedSummary] = useState(true);

  // Poll audit status every 3 seconds if running
  const { data: statusData, isLoading: statusLoading } = useQuery<{ run: AuditRun | null }>({
    queryKey: ["/api/admin/audit/status"],
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      return run?.status === "running" ? 3000 : false;
    },
  });

  const run = statusData?.run;
  const isRunning = run?.status === "running";

  // Fetch findings
  const params = new URLSearchParams();
  if (severityFilter) params.set("severity", severityFilter);
  if (categoryFilter) params.set("category", categoryFilter);
  if (statusFilter) params.set("status", statusFilter);
  params.set("page", String(page));
  params.set("limit", "50");

  const { data: findingsData, isLoading: findingsLoading } = useQuery<{ findings: Finding[]; total: number }>({
    queryKey: ["/api/admin/audit/findings", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/admin/audit/findings?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch findings");
      return res.json();
    },
    refetchInterval: isRunning ? 5000 : false,
  });

  // Start audit mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/audit/run", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to start audit");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit/status"] });
      toast({ title: "بدأت المراجعة", description: "ستظهر النتائج تباعاً..." });
    },
    onError: (err: any) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  // Update finding status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/admin/audit/findings/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit/findings"] });
    },
  });

  const findings = findingsData?.findings || [];
  const total = findingsData?.total || 0;
  const totalPages = Math.ceil(total / 50);

  function getEntityLink(f: Finding): string | null {
    if (f.entity_type === "law") return `/law/${f.entity_id}`;
    if (f.entity_type === "judgment") return `/judgments/${f.entity_id}`;
    return null;
  }

  return (
    <div className="container max-w-5xl mx-auto px-4 py-8" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">المراجعة الشاملة</h1>
          <p className="text-muted-foreground text-sm">فحص شامل لمحتوى المنصة تمهيداً للإطلاق</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin">
            <Button variant="outline" size="sm">لوحة التحكم</Button>
          </Link>
        </div>
      </div>

      {/* Status / Progress Bar */}
      {isRunning && run && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="font-medium text-primary">{run.current_step}</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-3 mb-2">
              <div
                className="bg-primary h-3 rounded-full transition-all duration-500"
                style={{ width: `${run.progress_pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{toHindiNumerals(run.progress_pct)}%</span>
              <span>
                {run.total_findings > 0 && `${toHindiNumerals(run.total_findings)} نتيجة حتى الآن`}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      {run && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-6">
          <Card className="border-red-200 bg-red-50/50">
            <CardContent className="py-3 text-center">
              <p className="text-3xl font-bold text-red-700">{toHindiNumerals(run.critical_count)}</p>
              <p className="text-xs text-red-600">حرج</p>
            </CardContent>
          </Card>
          <Card className="border-orange-200 bg-orange-50/50">
            <CardContent className="py-3 text-center">
              <p className="text-3xl font-bold text-orange-700">{toHindiNumerals(run.high_count)}</p>
              <p className="text-xs text-orange-600">عالي</p>
            </CardContent>
          </Card>
          <Card className="border-yellow-200 bg-yellow-50/50">
            <CardContent className="py-3 text-center">
              <p className="text-3xl font-bold text-yellow-700">{toHindiNumerals(run.medium_count)}</p>
              <p className="text-xs text-yellow-600">متوسط</p>
            </CardContent>
          </Card>
          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="py-3 text-center">
              <p className="text-3xl font-bold text-blue-700">{toHindiNumerals(run.low_count)}</p>
              <p className="text-xs text-blue-600">منخفض</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Summary */}
      {run?.summary && run.status === "completed" && (
        <Card className="mb-6 border-primary/20">
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpandedSummary(!expandedSummary)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">الملخص التنفيذي</CardTitle>
              {expandedSummary ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </CardHeader>
          {expandedSummary && (
            <CardContent>
              <div className="text-sm leading-relaxed whitespace-pre-line text-slate-700">
                {run.summary}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Start Button */}
      {(!run || (run.status !== "running")) && (
        <div className="mb-6">
          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            size="lg"
            className="w-full md:w-auto"
          >
            {startMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin ml-2" />
            ) : run ? (
              <RefreshCw className="w-4 h-4 ml-2" />
            ) : (
              <Play className="w-4 h-4 ml-2" />
            )}
            {run ? "إعادة تشغيل المراجعة" : "تشغيل المراجعة الشاملة"}
          </Button>
          {run?.status === "failed" && (
            <p className="text-sm text-destructive mt-2">فشلت المراجعة السابقة: {run.error_message}</p>
          )}
        </div>
      )}

      {/* Filters */}
      {(run && run.total_findings > 0) && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              className="border rounded-md px-3 py-1.5 text-sm bg-background"
              value={severityFilter}
              onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
            >
              <option value="">كل الشدات</option>
              <option value="critical">حرج</option>
              <option value="high">عالي</option>
              <option value="medium">متوسط</option>
              <option value="low">منخفض</option>
            </select>

            <select
              className="border rounded-md px-3 py-1.5 text-sm bg-background"
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            >
              <option value="">كل الفئات</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>

            <select
              className="border rounded-md px-3 py-1.5 text-sm bg-background"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">كل الحالات</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>

            <span className="text-sm text-muted-foreground self-center mr-auto">
              {toHindiNumerals(total)} نتيجة
            </span>
          </div>

          {/* Findings List */}
          {findingsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : findings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>لا توجد نتائج تطابق الفلاتر المختارة</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {findings.map((f) => {
                const sev = SEVERITY_CONFIG[f.severity] || SEVERITY_CONFIG.low;
                const Icon = sev.icon;
                const link = getEntityLink(f);

                return (
                  <Card key={f.id} className={sev.bg}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start gap-3">
                        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${sev.color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge variant="outline" className={`text-[10px] ${sev.color}`}>
                              {sev.label}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {CATEGORY_LABELS[f.category] || f.category}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {f.code}
                            </Badge>
                            {f.location && (
                              <span className="text-[10px] text-muted-foreground">{f.location}</span>
                            )}
                          </div>

                          {f.entity_name && (
                            <p className="text-sm font-medium mb-1">
                              {link ? (
                                <Link href={link} className="hover:underline text-primary">
                                  {f.entity_name}
                                </Link>
                              ) : (
                                f.entity_name
                              )}
                            </p>
                          )}

                          <p className="text-sm text-slate-700 leading-relaxed">{f.message}</p>
                        </div>

                        <div className="flex gap-1 shrink-0">
                          {f.status === "open" && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="تم الاطلاع"
                                onClick={() => updateStatusMutation.mutate({ id: f.id, status: "acknowledged" })}
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-green-600"
                                title="تم الحل"
                                onClick={() => updateStatusMutation.mutate({ id: f.id, status: "resolved" })}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-slate-400"
                                title="تجاهل"
                                onClick={() => updateStatusMutation.mutate({ id: f.id, status: "wont_fix" })}
                              >
                                <EyeOff className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {f.status !== "open" && (
                            <Badge variant="secondary" className="text-[10px]">
                              {STATUS_LABELS[f.status] || f.status}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                السابق
              </Button>
              <span className="text-sm text-muted-foreground">
                صفحة {toHindiNumerals(page)} من {toHindiNumerals(totalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                التالي
              </Button>
            </div>
          )}
        </>
      )}

      {/* No audit run yet */}
      {!run && !statusLoading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="mb-4">لم تُجرَ أي مراجعة بعد. شغّل المراجعة الشاملة لفحص المنصة.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
