import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { FileQuestion, ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] w-full flex items-center justify-center">
      <div className="text-center px-4">
        <FileQuestion className="h-20 w-20 mx-auto mb-6 text-muted-foreground/30" />
        <h1 className="text-6xl font-bold text-primary mb-3">404</h1>
        <p className="text-xl text-foreground mb-2">الصفحة غير موجودة</p>
        <p className="text-sm text-muted-foreground mb-8">
          الصفحة التي تبحث عنها غير متوفرة أو تم نقلها
        </p>
        <Link href="/library">
          <Button className="gap-2">
            <ArrowRight className="h-4 w-4" />
            العودة للمكتبة
          </Button>
        </Link>
      </div>
    </div>
  );
}
