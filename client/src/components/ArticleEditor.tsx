import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface ArticleEditorProps {
  isOpen: boolean;
  onClose: () => void;
  lawId: string;
  articleNumber: number;
  originalText: string;
  onSaved: () => void;
}

export function ArticleEditor({ 
  isOpen, 
  onClose, 
  lawId, 
  articleNumber, 
  originalText,
  onSaved 
}: ArticleEditorProps) {
  const [text, setText] = useState(originalText);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      fetch(`/api/articles/${lawId}/${articleNumber}`)
        .then(res => res.json())
        .then(data => {
          if (data.hasOverride) {
            setText(data.overrideText);
          } else {
            setText(originalText);
          }
        })
        .catch(() => {
          setText(originalText);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isOpen, lawId, articleNumber, originalText]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/articles/${lawId}/${articleNumber}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ overrideText: text }),
      });

      if (response.status === 401) {
        toast({
          title: "غير مصرح",
          description: "يجب تسجيل الدخول",
          variant: "destructive",
        });
        return;
      }

      if (response.status === 403) {
        toast({
          title: "غير مسموح",
          description: "صلاحيات المشرف مطلوبة",
          variant: "destructive",
        });
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to save");
      }

      toast({
        title: "تم الحفظ",
        description: "تم حفظ التعديلات بنجاح",
      });
      onSaved();
      onClose();
    } catch (error) {
      toast({
        title: "خطأ",
        description: "فشل في حفظ التعديلات",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevert = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/articles/${lawId}/${articleNumber}/override`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to revert");
      }

      toast({
        title: "تم الإرجاع",
        description: "تم إرجاع النص الأصلي",
      });
      setText(originalText);
      onSaved();
      onClose();
    } catch (error) {
      toast({
        title: "خطأ",
        description: "فشل في إرجاع النص الأصلي",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-xl">
            تحرير المادة {articleNumber}
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden py-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[400px] w-full text-right font-amiri text-lg leading-loose resize-none"
              dir="rtl"
              style={{ fontFamily: "'Amiri', serif" }}
              data-testid="textarea-article-edit"
            />
          )}
        </div>

        <DialogFooter className="flex gap-2 justify-start sm:justify-start">
          <Button 
            onClick={handleSave} 
            disabled={isSaving || isLoading}
            data-testid="button-save-article"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
            حفظ
          </Button>
          <Button 
            variant="outline" 
            onClick={onClose} 
            disabled={isSaving}
            data-testid="button-cancel-edit"
          >
            إلغاء
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleRevert} 
            disabled={isSaving || isLoading}
            data-testid="button-revert-article"
          >
            إرجاع النص الأصلي
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
