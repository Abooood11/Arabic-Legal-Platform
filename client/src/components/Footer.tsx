import { Link } from "wouter";
import { Scale, Heart, LogIn } from "lucide-react";
import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export function Footer() {
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const firstClickTimeRef = useRef<number | null>(null);
  const clickCountRef = useRef<number>(0);
  const { isAuthenticated } = useAuth();

  const handleSecretClick = () => {
    if (isAuthenticated) return;
    
    const now = Date.now();
    
    // If this is the first click or the window has expired, start fresh
    if (firstClickTimeRef.current === null || now - firstClickTimeRef.current > 2000) {
      firstClickTimeRef.current = now;
      clickCountRef.current = 1;
      return;
    }
    
    // Increment click count within the strict 2-second window
    clickCountRef.current += 1;
    
    // Check if we have 5 clicks within the 2-second window from first click
    if (clickCountRef.current >= 5) {
      setShowLoginDialog(true);
      firstClickTimeRef.current = null;
      clickCountRef.current = 0;
    }
  };

  const handleLogin = () => {
    window.location.href = "/auth";
  };

  return (
    <>
      <footer className="bg-muted/30 border-t mt-auto">
        <div className="container mx-auto px-4 py-12 md:py-16">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="md:col-span-2 space-y-4">
              <Link href="/library" className="flex items-center" data-testid="link-footer-logo">
                <img src="/tashree-logo.png" alt="شعار تشريع" className="h-10 object-contain" style={{ width: 'auto' }} />
              </Link>
              <p className="text-muted-foreground leading-relaxed max-w-sm">
                منصة رقمية مخصصة لعرض النصوص القانونية السعودية وخدمتها، مع أدوات ذكية للوصول المباشر للمصادر الرسمية المعتمدة.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold mb-4 text-primary">روابط سريعة</h3>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><Link href="/library" className="hover:text-primary transition-colors" data-testid="link-footer-library">الأنظمة</Link></li>
                <li><Link href="/judgments" className="hover:text-primary transition-colors" data-testid="link-footer-judgments">الأحكام القضائية</Link></li>
                <li><Link href="/gazette" className="hover:text-primary transition-colors" data-testid="link-footer-gazette">جريدة أم القرى</Link></li>
                <li><Link href="/regulations" className="hover:text-primary transition-colors" data-testid="link-footer-regulations">اللوائح التنفيذية</Link></li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-semibold mb-4 text-primary">تنويه هام</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                المحتوى المنشور في هذه المنصة للأغراض المعلوماتية والبحثية فقط، ولا يُغني عن الرجوع للمصادر الرسمية أو استشارة محامٍ مرخص.
              </p>
            </div>
          </div>
          
          <div className="border-t mt-12 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
            <p data-testid="text-copyright">
              © {new Date().getFullYear()} جميع الحقوق{" "}
              <span 
                onClick={handleSecretClick}
                className="cursor-default select-none"
                data-testid="text-copyright-secret"
              >
                محفوظة
              </span>
              .
            </p>
            <div className="flex items-center gap-1">
              <span>صنع بكل</span>
              <Heart className="w-4 h-4 text-red-500 fill-red-500 mx-1" />
              <span>في الرياض</span>
            </div>
          </div>
        </div>
      </footer>

      {!isAuthenticated && (
        <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
          <DialogContent className="sm:max-w-md" dir="rtl" data-testid="dialog-admin-login">
            <DialogHeader>
              <DialogTitle className="text-center flex items-center justify-center gap-2" data-testid="text-dialog-title">
                <Scale className="h-5 w-5 text-primary" />
                تسجيل دخول المشرف
              </DialogTitle>
              <DialogDescription className="text-center" data-testid="text-dialog-description">
                تسجيل الدخول لإدارة المحتوى
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <Button 
                onClick={handleLogin}
                className="w-full gap-2"
                data-testid="button-secret-login"
              >
                <LogIn className="w-4 h-4" />
                تسجيل الدخول إلى لوحة الإدارة
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
