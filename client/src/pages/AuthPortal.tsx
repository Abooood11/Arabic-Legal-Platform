import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export default function AuthPortal() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [login, setLogin] = useState({ email: "", password: "", totpCode: "" });
  const [register, setRegister] = useState({ firstName: "", lastName: "", email: "", password: "" });

  // Check if Google OAuth is configured
  const { data: googleStatus } = useQuery({
    queryKey: ["google-oauth-status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/google/status");
      return res.json() as Promise<{ enabled: boolean }>;
    },
    staleTime: Infinity,
  });

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
      };
      toast({ variant: "destructive", title: messages[error] || "حدث خطأ" });
      // Clean up URL
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
      if (!res.ok) throw new Error(data.message || "فشل تسجيل الدخول");
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "تم تسجيل الدخول بنجاح" });
      setLocation("/library");
    },
    onError: (e: any) => toast({ variant: "destructive", title: e.message || "خطأ" }),
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
      toast({ title: "تم إنشاء الحساب" });
      setLocation("/library");
    },
    onError: (e: any) => toast({ variant: "destructive", title: e.message || "خطأ" }),
  });

  const handleGoogleLogin = () => {
    window.location.href = "/api/auth/google";
  };

  return (
    <div className="container mx-auto max-w-md py-10 px-4" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle>تسجيل الدخول</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Google OAuth Button */}
          {googleStatus?.enabled && (
            <>
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
            </>
          )}

          <Tabs defaultValue="login">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">تسجيل الدخول</TabsTrigger>
              <TabsTrigger value="register">إنشاء حساب</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-3 mt-4">
              <div><Label>البريد الإلكتروني</Label><Input value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} /></div>
              <div><Label>كلمة المرور</Label><Input type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></div>
              <Button className="w-full" onClick={() => loginMutation.mutate()} disabled={loginMutation.isPending}>دخول</Button>
            </TabsContent>

            <TabsContent value="register" className="space-y-3 mt-4">
              <div><Label>الاسم الأول</Label><Input value={register.firstName} onChange={(e) => setRegister({ ...register, firstName: e.target.value })} /></div>
              <div><Label>الاسم الأخير</Label><Input value={register.lastName} onChange={(e) => setRegister({ ...register, lastName: e.target.value })} /></div>
              <div><Label>البريد الإلكتروني</Label><Input value={register.email} onChange={(e) => setRegister({ ...register, email: e.target.value })} /></div>
              <div><Label>كلمة المرور</Label><Input type="password" value={register.password} onChange={(e) => setRegister({ ...register, password: e.target.value })} /></div>
              <p className="text-xs text-muted-foreground">يجب أن تحتوي كلمة المرور على 10 أحرف على الأقل وتتضمن حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا.</p>
              <Button className="w-full" onClick={() => registerMutation.mutate()} disabled={registerMutation.isPending}>إنشاء حساب</Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
