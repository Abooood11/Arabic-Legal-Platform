import { Link, useLocation } from "wouter";
import { Scale, Menu, BookOpen, Info, LogOut, User, FileText, Newspaper, Search, LayoutDashboard } from "lucide-react";
import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useAdmin } from "@/hooks/use-admin";

export function Navbar() {
  const [location, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const { isAdmin } = useAdmin();

  // Global Ctrl+K shortcut to open search page
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

  const links = [
    { href: "/search", label: "البحث", icon: Search },
    { href: "/library", label: "الأنظمة واللوائح", icon: BookOpen },
    { href: "/judgments", label: "الأحكام القضائية", icon: Scale },
    { href: "/gazette", label: "كشاف جريدة أم القرى", icon: Newspaper },
    { href: "/about", label: "عن المنصة", icon: Info },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/library" className="flex items-center group" data-testid="brand-link">
            <img
              src="/tashree-logo.png"
              alt="شعار تشريع"
              className="h-11 object-contain transition-transform duration-300 group-hover:scale-105"
              style={{ width: 'auto' }}
            />
          </Link>
        </div>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-6">
          {isAdmin && (
            <Link href="/admin" className={`flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary ${location.startsWith("/admin") ? "text-primary" : "text-muted-foreground"}`}>
              <LayoutDashboard className="w-4 h-4" />
              لوحة المسؤول
            </Link>
          )}
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-2 text-base font-medium transition-colors hover:text-primary ${location === link.href || (link.href === "/search" && location.startsWith("/search")) ? "text-primary" : "text-muted-foreground"}`}
            >
              <link.icon className="w-5 h-5" />
              {link.label}
              {link.href === "/search" && (
                <kbd className="hidden lg:inline-flex items-center text-[10px] font-mono bg-muted/80 text-muted-foreground px-1.5 py-0.5 rounded border mr-0.5">
                  Ctrl+K
                </kbd>
              )}
            </Link>
          ))}
        </nav>

        {/* Auth (Desktop) - Only show when authenticated */}
        <div className="hidden md:flex items-center gap-2">
          {isLoading ? null : isAuthenticated ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <User className="w-4 h-4" />
                {user?.firstName || user?.email || "مستخدم"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => logout()}
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4" />
                خروج
              </Button>
            </div>
          ) : null}
        </div>

        {/* Mobile Nav */}
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[80%] sm:w-[385px]">
            <div className="flex flex-col gap-6 mt-6">
              <div className="flex flex-col">
                <Link href="/library" onClick={() => setIsOpen(false)} className="flex items-center" data-testid="brand-link-mobile">
                  <img src="/tashree-logo.png" alt="شعار تشريع" className="h-12 object-contain" style={{ width: 'auto' }} />
                </Link>
              </div>
              <nav className="flex flex-col gap-2">
                {isAdmin && (
                  <Link href="/admin" onClick={() => setIsOpen(false)} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${location.startsWith("/admin") ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}>
                    <LayoutDashboard className="w-5 h-5" />
                    لوحة المسؤول
                  </Link>
                )}
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${location === link.href ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}
                  >
                    <link.icon className="w-5 h-5" />
                    {link.label}
                  </Link>
                ))}
              </nav>
              {/* Only show logout in mobile menu when authenticated */}
              {isAuthenticated && (
                <div className="flex flex-col gap-2 mt-4 pt-4 border-t">
                  <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
                    <User className="w-4 h-4" />
                    {user?.firstName || user?.email || "مستخدم"}
                  </div>
                  <Button
                    variant="outline"
                    className="justify-start gap-3"
                    onClick={() => { logout(); setIsOpen(false); }}
                    data-testid="button-logout-mobile"
                  >
                    <LogOut className="w-4 h-4" />
                    تسجيل خروج
                  </Button>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
