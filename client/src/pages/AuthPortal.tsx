import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function AuthPortal() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [login, setLogin] = useState({ email: "", password: "", totpCode: "" });
  const [register, setRegister] = useState({ firstName: "", lastName: "", email: "", password: "", ageRange: "" });

  useEffect(() => {
    const existing = localStorage.getItem("alp_age_range");
    if (existing) setRegister((r) => ({ ...r, ageRange: existing }));
  }, []);

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
      if (register.ageRange) localStorage.setItem("alp_age_range", register.ageRange);
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

  return (
    <div className="container mx-auto max-w-md py-10 px-4" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle>تسجيل الدخول</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">تسجيل الدخول</TabsTrigger>
              <TabsTrigger value="register">إنشاء حساب</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-3 mt-4">
              <div><Label>البريد الإلكتروني</Label><Input value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} /></div>
              <div><Label>كلمة المرور</Label><Input type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></div>
              <div><Label>رمز التحقق الثنائي (اختياري)</Label><Input value={login.totpCode} onChange={(e) => setLogin({ ...login, totpCode: e.target.value })} /></div>
              <Button className="w-full" onClick={() => loginMutation.mutate()} disabled={loginMutation.isPending}>دخول</Button>
            </TabsContent>

            <TabsContent value="register" className="space-y-3 mt-4">
              <div><Label>الاسم الأول</Label><Input value={register.firstName} onChange={(e) => setRegister({ ...register, firstName: e.target.value })} /></div>
              <div><Label>الاسم الأخير</Label><Input value={register.lastName} onChange={(e) => setRegister({ ...register, lastName: e.target.value })} /></div>
              <div><Label>البريد الإلكتروني</Label><Input value={register.email} onChange={(e) => setRegister({ ...register, email: e.target.value })} /></div>
              <div><Label>كلمة المرور</Label><Input type="password" value={register.password} onChange={(e) => setRegister({ ...register, password: e.target.value })} /></div>
              <div>
                <Label>الفئة العمرية (اختياري لتحليلات النمو)</Label>
                <select className="w-full h-10 px-3 rounded-md border bg-background" value={register.ageRange} onChange={(e) => setRegister({ ...register, ageRange: e.target.value })}>
                  <option value="">غير محدد</option>
                  <option value="18-24">18-24</option>
                  <option value="25-34">25-34</option>
                  <option value="35-44">35-44</option>
                  <option value="45-54">45-54</option>
                  <option value="55+">55+</option>
                </select>
              </div>
              <p className="text-xs text-muted-foreground">يجب أن تحتوي كلمة المرور على 10 أحرف على الأقل وتتضمن حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا.</p>
              <Button className="w-full" onClick={() => registerMutation.mutate()} disabled={registerMutation.isPending}>إنشاء حساب</Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
