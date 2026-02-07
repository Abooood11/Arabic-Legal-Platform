import { useLibrary } from "@/hooks/use-data";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, BookOpen } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Library() {
  const { data: library, isLoading } = useLibrary();
  const [search, setSearch] = useState("");

  const filteredLibrary = library?.filter(item => 
    item.title_ar.includes(search) || item.jurisdiction_ar.includes(search)
  );

  return (
    <div className="container mx-auto px-4 py-8 min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary mb-2">المكتبة القانونية</h1>
          <p className="text-muted-foreground">تصفح جميع الأنظمة واللوائح المتوفرة في المنصة</p>
        </div>
        
        <div className="relative w-full md:w-96">
          <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="بحث في المكتبة..." 
            className="pr-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array(6).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredLibrary?.map((item) => (
            <Link key={item.id} href={`/law/${item.id}`}>
              <Card className="h-full hover:shadow-lg hover:border-primary/50 transition-all cursor-pointer group">
                <CardHeader>
                  <div className="flex justify-between items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <Badge variant={item.category === 'law' ? 'default' : 'secondary'}>
                      {item.category === 'law' ? 'نظام' : 'لائحة'}
                    </Badge>
                  </div>
                  <CardTitle className="mt-4 text-xl leading-snug group-hover:text-primary transition-colors">
                    {item.title_ar}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {item.jurisdiction_ar}
                  </p>
                  
                  {item.laws_included && (
                    <div className="flex flex-wrap gap-2">
                      {item.laws_included.map((law, idx) => (
                        <span key={idx} className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
                          {law}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
          
          {filteredLibrary?.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              <Filter className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>لا توجد نتائج مطابقة لبحثك</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
