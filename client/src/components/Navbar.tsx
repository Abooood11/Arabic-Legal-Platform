import { Link, useLocation } from "wouter";
import { Scale, Menu, BookOpen, LogOut, LogIn, User, Newspaper, Search, LayoutDashboard, FileText, Gavel, ChevronDown, Info } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useAdmin } from "@/hooks/use-admin";

function roundToApprox(n: number): string {
  if (n >= 1000000) {
    const val = Math.floor(n / 100000) / 10;
    return `+${val} مليون`;
  }
  if (n >= 10000) {
    const val = Math.floor(n / 1000);
    return `+${val} ألف`;
  }
  if (n >= 1000) {
    const val = Math.round(n / 1000);
    return `+${val} آلاف`;
  }
  return n.toString();
}

function MoreDropdown({
  links,
  location,
  label,
}: {
  links: { href: string; label: string; icon: any }[];
  location: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const isAnyActive = links.some((l) => location === l.href || location.startsWith(l.href + "/"));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-primary whitespace-nowrap ${isAnyActive ? "text-primary" : "text-muted-foreground"}`}
      >
        {label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 bg-background border rounded-xl shadow-lg z-50 py-2 min-w-[200px]">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-muted ${isActive ? "text-primary font-medium" : "text-muted-foreground"}`}
              >
                <Icon className="w-4 h-4" />
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const [location, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const { isAdmin } = useAdmin();

  const { data: stats } = useQuery<{
    totalDocuments: number;
    laws: { articles: number; laws: number };
    judgments: { total: number };
    gazette: { total: number };
    tameems?: { total: number };
  }>({
    queryKey: ["platform-stats"],
    queryFn: async () => {
      const res = await fetch("/api/search/stats");
      return res.json();
    },
    staleTime: 3600000,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setLocation("/search");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setLocation]);

  const primaryLinks = [
    { href: "/search", label: "البحث", icon: Search },
    { href: "/library", label: "الأنظمة واللوائح", icon: BookOpen },
    { href: "/judgments", label: "الأحكام القضائية", icon: Scale },
  ];

  const secondaryLinks = [
    { href: "/", label: "الرئيسية", icon: Search },
    { href: "/gazette", label: "كشاف أم القرى", icon: Newspaper },
    { href: "/tameems", label: "التعاميم", icon: FileText },
    { href: "/about", label: "عن المنصة", icon: Info },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center group shrink-0" data-testid="brand-link">
          <img
            src="/tashree-logo.png"
            alt="شعار تشريع"
            className="h-11 object-contain transition-transform duration-300 group-hover:scale-105"
            style={{ width: "auto" }}
          />
        </Link>

        <nav className="hidden md:flex items-center gap-4 lg:gap-5">
          {isAdmin && (
            <Link href="/admin" className={`flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-primary ${location.startsWith("/admin") ? "text-primary" : "text-muted-foreground"}`}>
              <LayoutDashboard className="w-4 h-4" />
              لوحة المسؤول
            </Link>
          )}

          {primaryLinks.map((link) => {
            const isActive = location === link.href || (link.href === "/search" && location.startsWith("/search"));
            if (link.href === "/search") {
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full bg-emerald-600 text-white shadow-md shadow-emerald-600/25 hover:bg-emerald-700 transition-all"
                >
                  <link.icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            }
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-primary whitespace-nowrap ${isActive ? "text-primary" : "text-muted-foreground"}`}
              >
                <link.icon className="w-4 h-4" />
                {link.label}
              </Link>
            );
          })}

          <MoreDropdown links={secondaryLinks} location={location} label="مصادر إضافية" />
        </nav>

        <div className="hidden md:flex items-center gap-2 shrink-0">
          {isLoading ? null : isAuthenticated ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <User className="w-4 h-4" />
                {user?.firstName || user?.email || "مستخدم"}
              </span>
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => logout()} data-testid="button-logout">
                <LogOut className="w-4 h-4" />
                خروج
              </Button>
            </div>
          ) : (
            <Link href="/auth">
              <Button variant="outline" size="sm" className="gap-1.5">
                <LogIn className="w-4 h-4" />
                تسجيل الدخول
              </Button>
            </Link>
          )}
        </div>

        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[82%] sm:w-[385px]">
            <div className="flex flex-col gap-6 mt-6">
              <Link href="/" onClick={() => setIsOpen(false)} className="flex items-center" data-testid="brand-link-mobile">
                <img src="/tashree-logo.png" alt="شعار تشريع" className="h-12 object-contain" style={{ width: "auto" }} />
              </Link>

              <nav className="flex flex-col gap-2">
                {isAdmin && (
                  <Link href="/admin" onClick={() => setIsOpen(false)} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${location.startsWith("/admin") ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}>
                    <LayoutDashboard className="w-5 h-5" />
                    لوحة المسؤول
                  </Link>
                )}

                <span className="px-4 text-[11px] text-muted-foreground/60 uppercase tracking-wider">الأقسام الرئيسية</span>
                {primaryLinks.map((link) => {
                  const isActive = location === link.href || (link.href === "/search" && location.startsWith("/search"));
                  const baseClass = link.href === "/search"
                    ? "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                    : `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`;
                  return (
                    <Link key={link.href} href={link.href} onClick={() => setIsOpen(false)} className={baseClass}>
                      <link.icon className="w-5 h-5" />
                      {link.label}
                    </Link>
                  );
                })}

                <div className="mt-2 pt-3 border-t border-dashed">
                  <span className="px-4 text-[11px] text-muted-foreground/60 uppercase tracking-wider">مصادر إضافية</span>
                  {secondaryLinks.map((link) => {
                    const isActive = location === link.href;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setIsOpen(false)}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}
                      >
                        <link.icon className="w-5 h-5" />
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              </nav>

              <div className="flex flex-col gap-2 mt-2 pt-4 border-t">
                {isAuthenticated ? (
                  <>
                    <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
                      <User className="w-4 h-4" />
                      {user?.firstName || user?.email || "مستخدم"}
                    </div>
                    <Button variant="outline" className="justify-start gap-3" onClick={() => { logout(); setIsOpen(false); }} data-testid="button-logout-mobile">
                      <LogOut className="w-4 h-4" />
                      تسجيل خروج
                    </Button>
                  </>
                ) : (
                  <Link href="/auth" onClick={() => setIsOpen(false)}>
                    <Button variant="outline" className="w-full justify-start gap-3">
                      <LogIn className="w-4 h-4" />
                      تسجيل الدخول
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {stats && stats.totalDocuments > 0 && (location === "/" || location === "/library" || location === "/search" || location.startsWith("/search?")) && (
        <div className="border-t border-primary/5 bg-gradient-to-l from-primary/[0.05] via-transparent to-accent/[0.05]">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-center gap-4 sm:gap-8 py-1.5 text-[11px] sm:text-xs text-muted-foreground/70 overflow-x-auto">
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-primary/70 font-bold">{roundToApprox(stats.totalDocuments)}</span>
                <span>وثيقة قانونية</span>
              </span>
              <span className="w-px h-3 bg-border" />
              <span className="flex items-center gap-1 whitespace-nowrap">
                <BookOpen className="h-3 w-3 text-primary/50" />
                <span className="text-primary/70 font-semibold">{roundToApprox(stats.laws.articles)}</span>
                <span>مادة نظامية</span>
              </span>
              <span className="w-px h-3 bg-border hidden sm:block" />
              <span className="hidden sm:flex items-center gap-1 whitespace-nowrap">
                <Gavel className="h-3 w-3 text-primary/50" />
                <span className="text-primary/70 font-semibold">{roundToApprox(stats.judgments.total)}</span>
                <span>حكم قضائي</span>
              </span>
              <span className="w-px h-3 bg-border hidden sm:block" />
              <span className="hidden sm:flex items-center gap-1 whitespace-nowrap">
                <Newspaper className="h-3 w-3 text-primary/50" />
                <span className="text-primary/70 font-semibold">{roundToApprox(stats.gazette.total)}</span>
                <span>إصدار جريدة رسمية</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
