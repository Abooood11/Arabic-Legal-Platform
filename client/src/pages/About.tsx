import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Scale, AlertTriangle } from "lucide-react";

export default function About() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-primary mb-4">عن منصة تشريع</h1>
        <p className="text-xl text-muted-foreground">
          عرض النصوص القانونية السعودية وخدمتها بدقة ووضوح
        </p>
      </div>

      <div className="grid gap-8 mb-16">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Scale className="w-6 h-6 text-primary" />
              الغرض من المنصة
            </CardTitle>
          </CardHeader>
          <CardContent className="text-lg leading-relaxed text-muted-foreground">
            تُعنى منصة تشريع بعرض النصوص القانونية السعودية وخدمتها، من خلال توفير تجربة رقمية تيسّر الوصول للنصوص الرسمية كما هي، مع أدوات تقنية تساعد الباحث والمختص في استعراض الأنظمة وتوثيقها مباشرة من مصادرها الرسمية.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-primary" />
              خدمة النص القانوني
            </CardTitle>
          </CardHeader>
          <CardContent className="text-lg leading-relaxed text-muted-foreground">
            نعمل على خدمة النص القانوني عبر الحفاظ على دقته وسلامته، وتوفير أدوات النسخ والبحث والتصفح التي تجعل من التعامل مع النصوص التشريعية السعودية عملية سهلة وميسرة، مع الالتزام التام بالنص الرسمي المعتمد.
          </CardContent>
        </Card>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-8 flex gap-6 items-start">
        <div className="bg-amber-100 dark:bg-amber-900/50 p-3 rounded-full text-amber-700 dark:text-amber-400 shrink-0">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div>
          <h3 className="font-bold text-xl text-amber-900 dark:text-amber-300 mb-2">إخلاء مسؤولية</h3>
          <p className="text-amber-800 dark:text-amber-200/80 leading-relaxed">
            جميع المعلومات والنصوص الواردة في هذه المنصة هي لأغراض البحث والعلم فقط، ولا تعتبر مشورة قانونية رسمية. لا تتحمل المنصة أي مسؤولية عن أي إجراء يُتخذ بناءً على المعلومات الواردة هنا دون الرجوع إلى مستشار قانوني مرخص أو المصدر الرسمي للنظام.
          </p>
        </div>
      </div>
    </div>
  );
}
