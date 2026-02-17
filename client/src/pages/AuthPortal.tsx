import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const checks = useMemo(() => {
    return {
      length: password.length >= 10,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      digit: /\d/.test(password),
      symbol: /[^A-Za-z0-9]/.test(password),
    };
  }, [password]);

  const score = Object.values(checks).filter(Boolean).length;
  if (!password) return null;

  const colors = ["", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-blue-500", "bg-green-500"];
  const labels = ["", "ضعيفة جداً", "ضعيفة", "متوسطة", "جيدة", "قوية"];

  return (
    <div className="space-y-2 mt-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= score ? colors[score] : "bg-muted"}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className={checks.length ? "text-green-600" : "text-muted-foreground"}>
          {checks.length ? "✓" : "○"} 10 أحرف
        </span>
        <span className={checks.upper ? "text-green-600" : "text-muted-foreground"}>
          {checks.upper ? "✓" : "○"} حرف كبير
        </span>
        <span className={checks.lower ? "text-green-600" : "text-muted-foreground"}>
          {checks.lower ? "✓" : "○"} حرف صغير
        </span>
        <span className={checks.digit ? "text-green-600" : "text-muted-foreground"}>
          {checks.digit ? "✓" : "○"} رقم
        </span>
        <span className={checks.symbol ? "text-green-600" : "text-muted-foreground"}>
          {checks.symbol ? "✓" : "○"} رمز
        </span>
      </div>
      <p className="text-xs font-medium" style={{ color: score <= 2 ? "#ef4444" : score <= 3 ? "#f59e0b" : "#22c55e" }}>
        قوة كلمة المرور: {labels[score]}
      </p>
    </div>
  );
}

export default function AuthPortal() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [login, setLogin] = useState({ email: "", password: "", totpCode: "" });
  const [register, setRegister] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [mfaStep, setMfaStep] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  // Show error from Google OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      const messages: Record<string, string> = {
        missing_params: "حدث خطأ أثناء المصادقة مع Google",
        invalid_state: "انتهت صلاحية الجلسة، حاول مرة أخرى",
        token_exchange: "فشل الاتصال بحساب Google",
        profile_fetch: "تعذر جلب بيانات الحساب من Google",
        server_error: "حدث خطأ في الخادم",
        not_configured: "تسجيل الدخول عبر Google غير مُفعّل حالياً",
      };
      toast({ variant: "destructive", title: messages[error] || "حدث خطأ" });
      window.history.replaceState({}, "", "/auth");
    }
  }, [toast]);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(login),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.mfaRequired) throw Object.assign(new Error(data.message), { mfaRequired: true });
        throw new Error(data.message || "فشل تسجيل الدخول");
      }
      return data;
    },
    onSuccess: async (data) => {
      if (data.mfaRequired) {
        setMfaStep(true);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "تم تسجيل الدخول بنجاح" });
      setLocation("/library");
    },
    onError: (e: any) => {
      if (e.mfaRequired) {
        setMfaStep(true);
        return;
      }
      toast({ variant: "destructive", title: e.message || "خطأ" });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(register),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "فشل إنشاء الحساب");
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "تم إنشاء الحساب بنجاح" });
      setLocation("/library");
    },
    onError: (e: any) => toast({ variant: "destructive", title: e.message || "خطأ" }),
  });

  const handleGoogleLogin = () => {
    window.location.href = "/api/auth/google";
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4" dir="rtl">
      <Card className="w-full max-w-md shadow-lg border-t-4 border-t-primary">
        <CardHeader className="text-center pb-2">
          <img src="/tashree-logo.png" alt="تشريع" className="h-10 mx-auto mb-3 object-contain" style={{ width: 'auto' }} />
          <CardTitle className="text-xl">تسجيل الدخول</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">سجّل دخولك للوصول لأدوات المنصة المتقدمة</p>
        </CardHeader>
        <CardContent>
          {/* Google OAuth Button - always visible */}
          <Button
            variant="outline"
            className="w-full gap-3 h-11 text-sm font-medium"
            onClick={handleGoogleLogin}
          >
            <GoogleIcon className="w-5 h-5" />
            المتابعة عبر حساب Google
          </Button>
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">أو</span>
            </div>
          </div>

          <Tabs defaultValue="login">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">تسجيل الدخول</TabsTrigger>
              <TabsTrigger value="register">إنشاء حساب</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-4 mt-4">
              {!mfaStep ? (
                <>
                  <div className="space-y-1.5">
                    <Label>البريد الإلكتروني</Label>
                    <Input
                      type="email"
                      value={login.email}
                      onChange={(e) => setLogin({ ...login, email: e.target.value })}
                      placeholder="email@example.com"
                      dir="ltr"
                      className="text-left"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>كلمة المرور</Label>
                    <div className="relative">
                      <Input
                        type={showLoginPassword ? "text" : "password"}
                        value={login.password}
                        onChange={(e) => setLogin({ ...login, password: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate()}
                        className="pe-10"
                      />
                      <button
                        type="button"
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        tabIndex={-1}
                      >
                        {showLoginPassword ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <Button className="w-full h-10" onClick={() => loginMutation.mutate()} disabled={loginMutation.isPending}>
                    {loginMutation.isPending ? "جاري تسجيل الدخول..." : "دخول"}
                  </Button>
                </>
              ) : (
                /* MFA Step */
                <div className="space-y-4">
                  <div className="text-center space-y-2">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                      <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium">المصادقة الثنائية</p>
                    <p className="text-xs text-muted-foreground">أدخل الرمز المكون من 6 أرقام من تطبيق المصادقة</p>
                  </div>
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={login.totpCode}
                    onChange={(e) => setLogin({ ...login, totpCode: e.target.value.replace(/\D/g, "") })}
                    onKeyDown={(e) => e.key === "Enter" && login.totpCode.length === 6 && loginMutation.mutate()}
                    placeholder="000000"
                    className="text-center text-2xl tracking-[0.5em] font-mono"
                    dir="ltr"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setMfaStep(false); setLogin(l => ({ ...l, totpCode: "" })); }}>
                      رجوع
                    </Button>
                    <Button className="flex-1" onClick={() => loginMutation.mutate()} disabled={loginMutation.isPending || login.totpCode.length !== 6}>
                      {loginMutation.isPending ? "جاري التحقق..." : "تحقق"}
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="register" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>الاسم الأول</Label><Input value={register.firstName} onChange={(e) => setRegister({ ...register, firstName: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>الاسم الأخير</Label><Input value={register.lastName} onChange={(e) => setRegister({ ...register, lastName: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5">
                <Label>البريد الإلكتروني</Label>
                <Input
                  type="email"
                  value={register.email}
                  onChange={(e) => setRegister({ ...register, email: e.target.value })}
                  placeholder="email@example.com"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-1.5">
                <Label>كلمة المرور</Label>
                <div className="relative">
                  <Input
                    type={showRegisterPassword ? "text" : "password"}
                    value={register.password}
                    onChange={(e) => setRegister({ ...register, password: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && registerMutation.mutate()}
                    className="pe-10"
                  />
                  <button
                    type="button"
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                    onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                    tabIndex={-1}
                  >
                    {showRegisterPassword ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                  </button>
                </div>
                <PasswordStrength password={register.password} />
              </div>
              <Button className="w-full h-10" onClick={() => registerMutation.mutate()} disabled={registerMutation.isPending}>
                {registerMutation.isPending ? "جاري إنشاء الحساب..." : "إنشاء حساب"}
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
