// Onboarding: see /docs/onboarding (VISION, DOMAIN, ARCHITECTURE, DATA_CONTRACTS, DEBUG_PLAYBOOK)
import { useLaw, useLawSearch } from "@/hooks/use-data";
import { Link, useRoute } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, ChevronRight, ChevronDown, Copy, Scale, Edit, AlertTriangle, AlertCircle, Check, Loader2, X, MapPin, FileText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAdmin } from "@/hooks/use-admin";
import { ArticleEditor } from "@/components/ArticleEditor";
import { ArticleReferenceText } from "@/components/ArticleReferenceText";
import { NumberedItem } from "@/components/NumberedItem";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// Helper to format Hijri dates for RTL display (DD / MM / YYYY)
function formatHijriDate(dateStr: string): string {
  if (!dateStr) return dateStr;
  const parts = dateStr.split('/').map(p => p.trim());
  if (parts.length === 3) {
    // We reverse the parts to DD / MM / YYYY and use Unicode markers
    return `\u200F${parts[2]} / ${parts[1]} / ${parts[0]}\u200F`;
  }
  return dateStr;
}

// Helper to convert numbers to Arabic words for headings
function NumberToArabicWord(num: number): string {
  const words: Record<number, string> = {
    1: "الأولى", 2: "الثانية", 3: "الثالثة", 4: "الرابعة", 5: "الخامسة",
    6: "السادسة", 7: "السابعة", 8: "الثامنة", 9: "التاسعة", 10: "العاشرة",
    11: "الحادية عشرة", 12: "الثانية عشرة", 13: "الثالثة عشرة", 14: "الرابعة عشرة",
    15: "الخامسة عشرة", 16: "السادسة عشرة", 17: "السابعة عشرة", 18: "الثامنة عشرة",
    19: "التاسعة عشرة", 20: "العشرون"
  };
  return words[num] || num.toString();
}

// Country flag mapping
const countryFlags: Record<string, string> = {
  "eg": "🇪🇬",
  "ae": "🇦🇪",
  "jo": "🇯🇴",
  "fr": "🇫🇷",
  "kw": "🇰🇼",
  "qa": "🇶🇦",
  "bh": "🇧🇭",
  "om": "🇴🇲",
  "sy": "🇸🇾",
  "iq": "🇮🇶",
  "lb": "🇱🇧",
  "ma": "🇲🇦",
  "tn": "🇹🇳",
  "dz": "🇩🇿",
  "sa": "🇸🇦"
};

interface CrossSimilarItem {
  country_code: string;
  country_ar: string;
  law_name_ar: string;
  article_no: number;
  article_text_ar: string;
  similarity_score: number;
  source_url: string;
}

// Helper to convert numbers to Hindi numerals (١٢٣)
function toHindiNumerals(text: string): string {
  if (!text) return text;
  return text.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[parseInt(d)]);
}

// Helper to normalize dates into YYYY/MM/DDهـ format and convert to Hindi numerals
function normalizeArabicDate(text: string): string {
  if (!text) return text;

  // Convert Arabic/Eastern numerals to Western numerals for consistent parsing
  const westernNumerals = text.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString());

  const dateRegex = /(\b\d{4})([/-])(\d{1,2})\2(\d{1,2})\b|(\b\d{1,2})([/-])(\d{1,2})\6(\d{4})\b/g;

  return westernNumerals.replace(dateRegex, (match, y1, s1, m1, d1, d2, s2, m2, y2) => {
    let year, month, day;
    if (y1) {
      year = y1;
      month = m1.padStart(2, '0');
      day = d1.padStart(2, '0');
    } else {
      year = y2;
      month = m2.padStart(2, '0');
      day = d2.padStart(2, '0');
    }
    
    // Format date and convert to Hindi numerals
    const formattedDate = toHindiNumerals(`${year}/${month}/${day}هـ`);
    return `###DATE_START###${formattedDate}###DATE_END###`;
  }).replace(/###DATE_START###(.*?)###DATE_END###\s*(هـ|هـ\.|هـ\s|ه)?/g, (match, date) => {
    return `<span class="date-ltr" dir="ltr" style="unicode-bidi: isolate; display: inline-block; direction: ltr;">${date}</span>`;
  });
}

interface PreambleSectionProps {
  title: string;
  text?: string;
}

function PreambleSection({ title, text }: PreambleSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!text) return null;

  const lines = text.split('\n');

  // Classify each line for proper formatting
  const classifyLine = (line: string, idx: number) => {
    const t = line.trim();
    if (!t) return 'empty';

    // Basmala
    if (t === "بسم الله الرحمن الرحيم") return 'basmala';

    // Royal decree / cabinet decision header line — must START with the keyword
    // (not "وبعد الاطلاع على قرار مجلس الوزراء..." which is a clause)
    if (/^(مرسوم ملكي|أمر ملكي|أمر سامي|قرار مجلس الوزراء)\s.*رقم/.test(t)) return 'decree-header';

    // Opening dignitary lines (بعون الله، نحن [الملك]، ملك/نائب ملك)
    if (t === "بعون الله تعالى" || t === "بعون الله") return 'dignitary';
    if (/^نحن\s/.test(t) && t.length < 60) return 'dignitary';
    if (/^(ملك|نائب ملك|ولي العهد)/.test(t) && t.length < 60) return 'dignitary';
    if (/^باسم خادم الحرمين/.test(t)) return 'dignitary';

    // "رسمنا بما هو آت" / "أمرنا بما هو آت"
    if (/^(رسمنا|أمرنا)\s+بما\s+هو\s+آت/.test(t)) return 'pronouncement';

    // Ordinal markers (أولاً، ثانياً...)
    if (/^(أولا|ثانيا|ثالثا|رابعا|خامسا|سادسا|سابعا|ثامنا|تاسعا|عاشرا)/i.test(t.replace(/ً/g, ''))) return 'ordinal-item';

    // Signature / king name lines
    if (/(التوقيع|التوقيـع)/.test(t)) return 'signature-label';
    const kingNames = ["فهد بن عبد العزيز", "عبد الله بن عبد العزيز", "عبدالله بن عبدالعزيز",
      "سلمان بن عبد العزيز", "سلمان بن عبدالعزيز", "نايف بن عبد العزيز", "نايف بن عبدالعزيز",
      "فيصل بن عبد العزيز", "خالد بن عبد العزيز"];
    if (kingNames.some(n => t.includes(n)) && t.length < 60) return 'signature-name';

    // Regular clauses
    return 'clause';
  };

  const classified = lines.map((line, idx) => ({
    text: line.trim(),
    type: classifyLine(line, idx)
  }));

  return (
    <div className="container max-w-5xl mx-auto px-4 mt-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all duration-300 shadow-sm ${
          isOpen
            ? "bg-primary/5 border-primary/30 text-primary"
            : "bg-white border-slate-200 text-slate-700 hover:border-primary/20 hover:bg-slate-50"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg transition-colors ${isOpen ? "bg-primary/10" : "bg-slate-100"}`}>
            <Scale className="w-4 h-4" />
          </div>
          <span className="font-bold text-base">{title}</span>
        </div>
        <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isOpen ? "max-h-[8000px] opacity-100 mt-3" : "max-h-0 opacity-0"
        }`}
      >
        <div className="bg-white border border-primary/10 rounded-xl p-8 shadow-sm">
          <div className="text-base leading-relaxed text-foreground min-w-0" style={{ direction: 'rtl' }}>
            {classified.map((item, idx) => {
              const normalized = toHindiNumerals(normalizeArabicDate(item.text));

              if (item.type === 'empty') return <div key={idx} className="h-3" />;

              if (item.type === 'basmala') {
                return (
                  <div key={idx} className="text-center font-bold text-lg mb-6">
                    {item.text}
                  </div>
                );
              }

              if (item.type === 'decree-header') {
                return (
                  <div
                    key={idx}
                    className="text-center font-bold text-lg text-primary mb-6 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: normalized }}
                  />
                );
              }

              if (item.type === 'dignitary') {
                return (
                  <div
                    key={idx}
                    className="text-center font-bold text-base mb-1 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: normalized }}
                  />
                );
              }

              if (item.type === 'pronouncement') {
                return (
                  <div
                    key={idx}
                    className="text-center font-bold text-primary text-base my-5"
                    dangerouslySetInnerHTML={{ __html: normalized }}
                  />
                );
              }

              if (item.type === 'ordinal-item') {
                // Split into marker and content: "أولاً - الموافقة..." → marker="أولاً" content="الموافقة..."
                // Normalize tanween position before matching: ثانيًا (tanween before alef) → ثانيا (plain) for regex
                const textForMatch = item.text.replace(/ً/g, '');
                const ordMatch = textForMatch.match(/^(أولا|ثانيا|ثالثا|رابعا|خامسا|سادسا|سابعا|ثامنا|تاسعا|عاشرا)\s*[-–:]\s*(.*)/i);
                const marker = ordMatch ? ordMatch[1] + 'ً:' : '';
                const content = ordMatch ? ordMatch[2] : item.text;
                const normalizedContent = toHindiNumerals(normalizeArabicDate(content));

                return (
                  <div key={idx} className="flex gap-1.5 my-3 leading-relaxed items-start">
                    {marker && <div className="font-bold text-primary shrink-0">{marker}</div>}
                    <div className="flex-1 min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: normalizedContent }} />
                  </div>
                );
              }

              if (item.type === 'signature-label') {
                return <div key={idx} className="h-4" />;
              }

              if (item.type === 'signature-name') {
                return (
                  <div key={idx} className="text-left font-bold text-base mt-6 mb-2 pl-4" dir="rtl">
                    <span dangerouslySetInnerHTML={{ __html: normalized }} />
                  </div>
                );
              }

              // Regular clause
              return (
                <div
                  key={idx}
                  className="my-2 leading-relaxed text-justify"
                  dangerouslySetInnerHTML={{ __html: normalized }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Structured Royal Decree Section (for laws with structured preamble data)
interface RoyalDecreeArticle {
  marker: string;
  text: string;
  items?: {
    marker: string;
    text: string;
    sub_items?: { marker: string; text: string }[];
  }[];
}

interface RoyalDecreeData {
  header: string;
  opening: string[];
  recitals: string[];
  enactment_intro: string;
  articles: RoyalDecreeArticle[];
  signature: string;
}

interface CabinetDecisionData {
  header: string;
  opening: string;
  recitals?: string[];
  resolution?: string;
  decision_intro?: string;
  provisions?: string[];
  closing: string;
  signature: string;
}

interface PreambleData {
  title: string;
  year: string;
  basmala: string;
}

interface StructuredRoyalDecreeSectionProps {
  preamble?: PreambleData;
  royalDecree?: RoyalDecreeData;
  cabinetDecision?: CabinetDecisionData;
}

function StructuredRoyalDecreeSection({ preamble, royalDecree, cabinetDecision }: StructuredRoyalDecreeSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!royalDecree) return null;

  return (
    <div className="container max-w-5xl mx-auto px-4 mt-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all duration-300 shadow-sm ${
          isOpen 
            ? "bg-primary/5 border-primary/30 text-primary" 
            : "bg-white border-slate-200 text-slate-700 hover:border-primary/20 hover:bg-slate-50"
        }`}
        data-testid="button-toggle-royal-decree"
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg transition-colors ${isOpen ? "bg-primary/10" : "bg-slate-100"}`}>
            <Scale className="w-4 h-4" />
          </div>
          <span className="font-bold text-base">المرسوم الملكي وقرار مجلس الوزراء</span>
        </div>
        <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <div
        className={`transition-all duration-300 ease-in-out ${
          isOpen ? "max-h-[12000px] opacity-100 mt-3" : "max-h-0 opacity-0 overflow-hidden"
        }`}
      >
        <div className="bg-white border border-primary/10 rounded-xl p-8 shadow-sm" style={{ direction: 'rtl' }}>
          {/* Basmala */}
          {preamble?.basmala && (
            <div className="text-center font-bold text-lg text-foreground my-4">
              {preamble.basmala}
            </div>
          )}

          {/* Royal Decree Header */}
          <div className="text-center font-bold text-lg text-primary my-6 px-4 leading-normal" dir="rtl">
            {toHindiNumerals(royalDecree.header).replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, '\u200F$1/$2/$3\u200F').replace(/([٠-٩]{1,2})\/([٠-٩]{1,2})\/([٠-٩]{4})/g, '\u200F$1/$2/$3\u200F')}
          </div>

          {/* Opening lines */}
          <div className="space-y-2 mb-6">
            {royalDecree.opening.map((line, idx) => (
              <div key={idx} className="text-center font-semibold text-foreground">
                {line}
              </div>
            ))}
          </div>

          {/* Recitals */}
          <div className="space-y-3 mb-6 pr-4">
            {royalDecree.recitals.map((recital, idx) => (
              <div key={idx} className="text-sm leading-relaxed text-foreground">
                {toHindiNumerals(recital).replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, '\u200F$1/$2/$3\u200F').replace(/([٠-٩]{1,2})\/([٠-٩]{1,2})\/([٠-٩]{4})/g, '\u200F$1/$2/$3\u200F')}
              </div>
            ))}
          </div>

          {/* Enactment intro */}
          <div className="font-bold text-foreground my-4 pr-4">
            {royalDecree.enactment_intro}
          </div>

          {/* Royal Decree Articles */}
          <div className="space-y-6 pr-4">
            {royalDecree.articles.map((article, idx) => (
              <div key={idx} className="space-y-3">
                {/* Main article marker (أولاً، ثانياً، etc.) */}
                <div className="flex gap-1.5 items-start">
                  <div className="font-bold text-primary whitespace-nowrap shrink-0">{article.marker}:</div>
                  <div className="text-foreground leading-relaxed flex-1 min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{toHindiNumerals(article.text)}</div>
                </div>

                {/* Sub-items (1-, 2-, etc.) */}
                {article.items && article.items.length > 0 && (
                  <div className="pr-6 space-y-3">
                    {article.items.map((item, itemIdx) => (
                      <div key={itemIdx} className="space-y-2">
                        <div className="flex gap-1.5 items-start">
                          <div className="font-semibold text-emerald-600 whitespace-nowrap shrink-0">{toHindiNumerals(item.marker)}</div>
                          <div className="text-foreground leading-relaxed flex-1 min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{toHindiNumerals(item.text)}</div>
                        </div>

                        {/* Sub-sub-items (أ-, ب-, etc.) */}
                        {item.sub_items && item.sub_items.length > 0 && (
                          <div className="pr-6 space-y-2">
                            {item.sub_items.map((subItem, subIdx) => (
                              <div key={subIdx} className="flex gap-1.5 items-start">
                                {subItem.marker && (
                                  <div className="font-semibold text-emerald-600 whitespace-nowrap shrink-0">{subItem.marker}</div>
                                )}
                                <div className="text-foreground leading-relaxed text-sm flex-1 min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{toHindiNumerals(subItem.text)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Signature */}
          <div className="text-left font-bold text-base mt-8 mb-4 pl-4">
            {royalDecree.signature}
          </div>

          {/* Separator */}
          <div className="border-t border-slate-200 my-8" />

          {/* Cabinet Decision */}
          {cabinetDecision && (
            <div className="space-y-4">
              <div className="text-center font-bold text-lg text-primary my-4">
                {cabinetDecision.header}
              </div>
              <div className="text-foreground pr-4 font-semibold">
                {cabinetDecision.opening}
              </div>
              {/* Recitals if available */}
              {cabinetDecision.recitals && Array.isArray(cabinetDecision.recitals) && (
                <div className="space-y-3 pr-4 my-4">
                  {cabinetDecision.recitals.map((recital: string, idx: number) => (
                    <div key={idx} className="text-sm leading-relaxed text-foreground">
                      {recital}
                    </div>
                  ))}
                </div>
              )}
              {/* Decision intro */}
              {cabinetDecision.decision_intro && (
                <div className="text-foreground pr-4 font-bold my-4">
                  {cabinetDecision.decision_intro}
                </div>
              )}
              {/* Provisions (بنود القرار) */}
              {cabinetDecision.provisions && Array.isArray(cabinetDecision.provisions) && (
                <div className="space-y-6 pr-4">
                  {cabinetDecision.provisions.map((provision: any, idx: number) => (
                    <div key={idx} className="space-y-3">
                      <div className="flex gap-1.5 items-start">
                        <div className="font-bold text-primary whitespace-nowrap shrink-0">{provision.marker}:</div>
                        <div className="text-foreground leading-relaxed flex-1 min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{provision.text}</div>
                      </div>
                      {provision.items && provision.items.length > 0 && (
                        <div className="pr-6 space-y-3">
                          {provision.items.map((item: any, itemIdx: number) => (
                            <div key={itemIdx} className="space-y-2">
                              <div className="flex gap-1.5 items-start">
                                <div className="font-semibold text-emerald-600 whitespace-nowrap shrink-0">{item.marker}</div>
                                <div className="text-foreground leading-relaxed flex-1 min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{item.text}</div>
                              </div>
                              {item.sub_items && item.sub_items.length > 0 && (
                                <div className="pr-6 space-y-2">
                                  {item.sub_items.map((subItem: any, subIdx: number) => (
                                    <div key={subIdx} className="flex gap-1.5 items-start">
                                      {subItem.marker && (
                                        <div className="font-semibold text-emerald-600 whitespace-nowrap shrink-0">{subItem.marker}</div>
                                      )}
                                      <div className="text-foreground leading-relaxed text-sm flex-1 min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{subItem.text}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="text-foreground pr-4 mt-4">
                {cabinetDecision.closing}
              </div>
              <div className="text-left font-bold text-base mt-6 pl-4">
                {cabinetDecision.signature}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type OverridesMap = Record<string, { overrideText: string; updatedAt: string; updatedBy: string }>;

export default function LawDetail() {
  const [, params] = useRoute("/law/:id");
  const id = params?.id || "";
  const lawId = id === "civil-transactions-law-1444" ? "civil_transactions_sa" : id;
  const { data: law, isLoading, error, refetch } = useLaw(lawId);
  const [searchQuery, setSearchQuery] = useState("");
  const [openComparativeId, setOpenComparativeId] = useState<number | null>(null);
  const [editingArticle, setEditingArticle] = useState<{ number: number; text: string } | null>(null);
  const [reportingArticle, setReportingArticle] = useState<number | null>(null);
  const [reportText, setReportText] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);
  
  // Regulations (اللائحة) collapsible state
  const [openRegulationsId, setOpenRegulationsId] = useState<number | null>(null);
  const [showAllRegulations, setShowAllRegulations] = useState(false);
  
  const { toast } = useToast();
  const { isAdmin } = useAdmin();
  const queryClient = useQueryClient();
  
  const { data: overridesData, refetch: refetchOverrides } = useQuery<{ overrides: OverridesMap }>({
    queryKey: ["/api/articles", lawId, "overrides"],
    queryFn: async () => {
      const response = await fetch(`/api/articles/${lawId}/overrides`);
      if (!response.ok) return { overrides: {} };
      return response.json();
    },
    enabled: !!lawId,
    staleTime: 1000 * 60 * 5,
  });
  
  const overrides = overridesData?.overrides || {};
  
  const filteredArticles = useLawSearch(law, searchQuery);

  const [copyingId, setCopyingId] = useState<number | null>(null);
  
  // Sticky breadcrumb state
  const [currentBreadcrumb, setCurrentBreadcrumb] = useState({
    section: '',
    part: '',
    chapter: '',
    branch: ''
  });
  const articleRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);
  
  // Store first article index for each section/part/chapter/branch for click navigation
  const sectionFirstArticle = useRef<Map<string, number>>(new Map());
  
  // Build section index for click navigation
  useEffect(() => {
    if (!law?.articles) return;
    
    sectionFirstArticle.current.clear();
    law.articles.forEach((article: any) => {
      const keys = [
        article.section,
        article.part,
        article.chapter,
        article.branch
      ].filter(Boolean);
      
      keys.forEach(key => {
        if (!sectionFirstArticle.current.has(key)) {
          sectionFirstArticle.current.set(key, article.number);
        }
      });
    });
  }, [law?.articles]);
  
  // Initialize breadcrumb with first article and update on scroll
  useEffect(() => {
    if (!law?.articles || law.articles.length === 0) return;
    
    // Initialize with first article's location
    const firstArticle = law.articles[0];
    setCurrentBreadcrumb({
      section: (firstArticle as any).section || '',
      part: (firstArticle as any).part || '',
      chapter: (firstArticle as any).chapter || '',
      branch: (firstArticle as any).branch || ''
    });
    
    const handleScroll = () => {
      
      // Find current article in view
      let currentArticle: any = null;
      articleRefs.current.forEach((element, articleNumber) => {
        const rect = element.getBoundingClientRect();
        if (rect.top <= 150 && rect.bottom > 0) {
          const article = law.articles.find((a: any) => a.number === articleNumber);
          if (article) currentArticle = article;
        }
      });
      
      if (currentArticle) {
        setCurrentBreadcrumb({
          section: (currentArticle as any).section || '',
          part: (currentArticle as any).part || '',
          chapter: (currentArticle as any).chapter || '',
          branch: (currentArticle as any).branch || ''
        });
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [law?.articles]);
  
  // Navigate to section when clicking breadcrumb
  const scrollToSection = (sectionName: string) => {
    const articleNumber = sectionFirstArticle.current.get(sectionName);
    if (articleNumber) {
      const element = articleRefs.current.get(articleNumber);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const handleCopy = (article: any) => {
    setCopyingId(article.number);
    const articleNum = article.number_text || article.number;
    const articleOverride = overrides[article.number.toString()];
    const textToCopy = articleOverride?.overrideText || article.text;
    const citation = `المادة ${toHindiNumerals(articleNum.toString())}\n${toHindiNumerals(textToCopy)}`;
    navigator.clipboard.writeText(citation);
    
    setTimeout(() => setCopyingId(null), 2000);
  };

  const toggleComparative = (articleNo: number) => {
    setOpenComparativeId(openComparativeId === articleNo ? null : articleNo);
  };

  const handleSubmitReport = async (articleNumber: number) => {
    if (!reportText.trim()) return;
    
    setIsSubmittingReport(true);
    try {
      const response = await fetch("/api/error-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lawId,
          articleNumber,
          description: reportText.trim(),
        }),
      });
      
      if (response.ok) {
        toast({
          title: "تم الإرسال",
          description: "شكراً لك، تم استلام البلاغ وسيتم مراجعته"
        });
        setReportText("");
        setReportingArticle(null);
      } else {
        throw new Error("Failed to submit");
      }
    } catch (error) {
      toast({
        title: "خطأ",
        description: "حدث خطأ أثناء إرسال البلاغ، يرجى المحاولة لاحقاً",
        variant: "destructive"
      });
    } finally {
      setIsSubmittingReport(false);
    }
  };

  if (isLoading) return <LawDetailSkeleton />;
  if (error || !law) {
    console.error("Law loading error:", error, "Law data:", law);
    return <LawNotFound />;
  }

  // Get breadcrumb items for rendering (includes all levels: section, part, chapter, branch)
  const getBreadcrumbItems = () => {
    const items: { label: string; fullLabel: string }[] = [];
    if (currentBreadcrumb.section) {
      items.push({ label: currentBreadcrumb.section.split(':')[0], fullLabel: currentBreadcrumb.section });
    }
    if (currentBreadcrumb.part) {
      items.push({ label: currentBreadcrumb.part, fullLabel: currentBreadcrumb.part });
    }
    if (currentBreadcrumb.chapter) {
      items.push({ label: currentBreadcrumb.chapter.split(':')[0], fullLabel: currentBreadcrumb.chapter });
    }
    if (currentBreadcrumb.branch) {
      items.push({ label: currentBreadcrumb.branch.split(':')[0], fullLabel: currentBreadcrumb.branch });
    }
    return items;
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Sticky Location Breadcrumb Bar - Below Navbar (h-16 = 64px = top-16) */}
      {showBreadcrumbs && (
        <div 
          className="bg-white border-b border-slate-200/80 sticky top-16 z-40" 
          style={{ direction: 'rtl' }}
          data-testid="location-breadcrumb-bar"
        >
          <div className="container max-w-5xl mx-auto px-4 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm w-full">
              <MapPin className="w-4 h-4 text-[#1a8a70] shrink-0" />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 flex-1">
                {getBreadcrumbItems().length > 0 ? (
                  getBreadcrumbItems().map((item, index) => (
                    <span key={index} className="flex items-center gap-2">
                      {index > 0 && <span className="text-slate-400">›</span>}
                      <button
                        onClick={() => scrollToSection(item.fullLabel)}
                        className="text-slate-700 hover:text-[#1a8a70] transition-colors cursor-pointer"
                        data-testid={`breadcrumb-item-${index}`}
                      >
                        {item.fullLabel}
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-slate-700">{law.law_name || law.title_ar}</span>
                )}
              </div>
              
              <div className="flex items-center gap-3 shrink-0 mr-auto">
                <button
                  onClick={() => setShowBreadcrumbs(false)}
                  className="text-[12px] font-bold text-[#1a8a70] hover:underline transition-all flex items-center gap-1"
                  data-testid="button-hide-breadcrumbs"
                >
                  إخفاء المسار
                </button>

                {isAdmin && (
                  <Link href="/admin/reports">
                    <Badge 
                      variant="outline" 
                      className="text-[10px] h-5 px-1.5 text-amber-600 border-amber-300 bg-amber-50 cursor-pointer hover:bg-amber-100"
                      data-testid="link-admin-reports"
                    >
                      <AlertTriangle className="w-3 h-3 ml-1" />
                      بلاغات
                    </Badge>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Re-show Breadcrumbs Toggle (Visible when hidden) */}
      {!showBreadcrumbs && (
        <div className="fixed bottom-6 left-6 z-50">
          <Button
            size="sm"
            onClick={() => setShowBreadcrumbs(true)}
            className="rounded-full shadow-lg bg-[#1a8a70] hover:bg-[#1a8a70]/90 text-white flex items-center gap-2 px-4"
            data-testid="button-show-breadcrumbs"
          >
            <MapPin className="w-4 h-4" />
            إظهار المسار
          </Button>
        </div>
      )}

      {/* Preamble & Cabinet Decision Sections */}
      {!searchQuery && law && (
        <>
          {/* Use structured component if royal_decree has full structured data (header field), otherwise fall back to text */}
          {(law as any).royal_decree?.header ? (
            <StructuredRoyalDecreeSection
              preamble={(law as any).preamble as PreambleData}
              royalDecree={(law as any).royal_decree as RoyalDecreeData}
              cabinetDecision={(law as any).cabinet_decision as CabinetDecisionData}
            />
          ) : (
            (() => {
              // Dynamically detect instrument types from issuing_authority field.
              // Legal documents span 100+ years with no fixed order or structure:
              //   مرسوم ملكي (Royal Decree), أمر ملكي (Royal Order),
              //   قرار مجلس الوزراء (Cabinet Decision), أمر سامي (Royal Directive)
              const issuingAuth = (law as any).issuing_authority || '';
              const rdText = law.preamble_text || (law as any).royal_decree?.text;
              const cdText = law.cabinet_decision_text;

              // Detect the primary instrument type for the royal_decree.text field
              let primaryTitle = 'المرسوم الملكي'; // default
              if (issuingAuth.includes('أمر ملكي')) {
                primaryTitle = 'الأمر الملكي';
              } else if (issuingAuth.includes('أمر سامي')) {
                primaryTitle = 'الأمر السامي';
              } else if (issuingAuth.includes('مرسوم ملكي')) {
                primaryTitle = 'المرسوم الملكي';
              }

              // Determine display order from issuing_authority text:
              // whichever instrument appears first in issuing_authority is shown first.
              const rdPos = issuingAuth.search(/مرسوم ملكي|أمر ملكي|أمر سامي/);
              const cdPos = issuingAuth.search(/قرار مجلس الوزراء/);
              const showCabinetFirst = cdPos !== -1 && (rdPos === -1 || cdPos < rdPos);

              const primarySection = rdText ? <PreambleSection title={primaryTitle} text={rdText} /> : null;
              const cabinetSection = cdText ? <PreambleSection title="قرار مجلس الوزراء" text={cdText} /> : null;

              return showCabinetFirst ? (
                <>{cabinetSection}{primarySection}</>
              ) : (
                <>{primarySection}{cabinetSection}</>
              );
            })()
          )}
        </>
      )}

      {/* Show All Regulations Toggle - Fixed Position */}
      {law && law.articles.some((a: any) => a.regulations && a.regulations.length > 0) && (
        <div className="fixed top-20 right-6 z-50">
          <Button
            size="sm"
            onClick={() => setShowAllRegulations(!showAllRegulations)}
            className={`rounded-full shadow-lg flex items-center gap-2 px-4 backdrop-blur-sm ${
              showAllRegulations 
                ? 'bg-[#1a8a70]/90 hover:bg-[#1a8a70] text-white' 
                : 'bg-white/80 hover:bg-white/95 text-[#1a8a70] border border-[#1a8a70]/50'
            }`}
            data-testid="button-toggle-all-regulations"
          >
            <FileText className="w-4 h-4" />
            {showAllRegulations ? 'إخفاء اللوائح' : 'إظهار اللوائح'}
          </Button>
        </div>
      )}

      {/* Articles List */}
      <div className="law-content-frame" ref={contentRef}>
        {filteredArticles.length > 0 ? (
          (() => {
            let lastSection = '';
            let lastPart = '';
            let lastChapter = '';
            let lastBranch = '';
            let lastSubSection = '';
            let lastSubSubSection = '';
            
            return filteredArticles.map((article) => {
              const hasComparative = article.cross_similar && article.cross_similar.length > 0;
              const isOpen = openComparativeId === article.number;
              const comparativeCount = article.cross_similar?.length || 0;
              const articleOverride = overrides[article.number.toString()];
              const rawDisplayText = articleOverride?.overrideText || article.text;
              const hasOverride = !!articleOverride;
              
              const currentSection = (article as any).section || '';
              const currentPart = (article as any).part || '';
              const currentChapter = (article as any).chapter || '';
              const currentBranch = (article as any).branch || '';
              const currentSubSection = (article as any).sub_section || '';
              const currentSubSubSection = (article as any).sub_sub_section || '';
              
              // Check what changed BEFORE updating lastXxx
              const sectionChanged = currentSection !== lastSection;
              const partChanged = currentPart !== lastPart;
              const chapterChanged = currentChapter !== lastChapter;
              const branchChanged = currentBranch !== lastBranch;
              const subSectionChanged = currentSubSection !== lastSubSection;
              const subSubSectionChanged = currentSubSubSection !== lastSubSubSection;
              const showHeader = sectionChanged || partChanged || chapterChanged || branchChanged || subSectionChanged || subSubSectionChanged;
              
              if (showHeader) {
                lastSection = currentSection;
                lastPart = currentPart;
                lastChapter = currentChapter;
                lastBranch = currentBranch;
                lastSubSection = currentSubSection;
                lastSubSubSection = currentSubSubSection;
              }
              
              // Remove sub_sub_section heading from beginning of article text if it appears there
              let displayText = rawDisplayText;
              if (currentSubSubSection) {
                const lines = displayText.split('\n');
                if (lines.length > 0 && lines[0].trim() === currentSubSubSection.trim()) {
                  displayText = lines.slice(1).join('\n').trim();
                }
              }
              
              // Check if article is repealed (via status field or text starting with ملغاة)
              const articleText = article.text || (article.paragraphs?.[0]?.text || '');
              const isRepealed = article.status === 'ملغاة' || articleText.trim().startsWith('ملغاة');
              
              return (
                <div 
                  key={article.number}
                  ref={(el) => {
                    if (el) articleRefs.current.set(article.number, el);
                  }}
                >
                  {showHeader && (currentSection || currentPart || currentChapter || currentBranch || currentSubSection || currentSubSubSection) && (
                    <div className="text-center py-4 mb-2 mt-4 first:mt-0">
                      {sectionChanged && currentSection && (
                        <div className="section-header-section">{currentSection}</div>
                      )}
                      {partChanged && currentPart && (
                        <div className="section-header-part">{currentPart}</div>
                      )}
                      {chapterChanged && currentChapter && (
                        <div className="section-header-chapter">{currentChapter}</div>
                      )}
                      {branchChanged && currentBranch && (
                        <div className="section-header-branch">{currentBranch}</div>
                      )}
                      {subSectionChanged && currentSubSection && (
                        <div className="section-header-part" data-testid={`subsection-header-${article.number}`}>{currentSubSection}</div>
                      )}
                      {subSubSectionChanged && currentSubSubSection && (
                        <div className="section-header-chapter" data-testid={`subsubsection-header-${article.number}`}>{currentSubSubSection}</div>
                      )}
                    </div>
                  )}
                  <div className={`article-container group ${isRepealed ? 'border-r-4 border-red-500/50' : ''}`} data-testid={`article-container-${article.number}`}>
                    <div className={`article-number-heading ${isRepealed ? 'text-red-600' : ''}`}>
                      {(() => {
                        const numberText = article.number_text || article.number.toString();
                        // Ensure "المادة" is always present and not duplicated
                        const hasAlMadda = numberText.includes('المادة');
                        const displayText = hasAlMadda ? numberText : `المادة ${numberText}`;
                        return toHindiNumerals(displayText);
                      })()}
                      {isRepealed && <span className="mr-2 text-xs font-normal text-red-500">(ملغاة)</span>}
                    </div>
                    
                    <div className="article-text-wrapper">
                      <div className={`prose-law ${isRepealed ? 'text-red-600/80' : ''}`}>
                    {hasOverride ? (
                      <div className="space-y-2">
                        {displayText.split('\n').map((line: string, idx: number) => {
                          const trimmed = line.trim();
                          if (!trimmed) return null;
                          
                          const alphaMarkerMatch = trimmed.match(/^([أ-ي])\s*[-–.]\s*(.*)$/);
                          const numMarkerMatch = trimmed.match(/^(\d+)\s*[-–.]\s*(.*)$/);
                          
                          if (alphaMarkerMatch) {
                            return (
                              <p key={idx} className="flex gap-1.5 pr-4">
                                <span className="text-primary font-bold shrink-0 min-w-[1.5rem]">{alphaMarkerMatch[1]}-</span>
                                <span className="text-justify">
                                  <ArticleReferenceText
                                    text={alphaMarkerMatch[2].trim()}
                                    articles={law.articles}
                                    currentArticleNumber={article.number}
                                  />
                                </span>
                              </p>
                            );
                          }
                          
                          if (numMarkerMatch) {
                            return (
                              <p key={idx} className="flex gap-1.5">
                                <span className="text-primary font-bold shrink-0 min-w-[1.5rem]">{toHindiNumerals(numMarkerMatch[1])}.</span>
                                <span className="text-justify">
                                  <ArticleReferenceText
                                    text={numMarkerMatch[2].trim()}
                                    articles={law.articles}
                                    currentArticleNumber={article.number}
                                  />
                                </span>
                              </p>
                            );
                          }
                          
                          return (
                            <p key={idx} className="text-justify">
                              <ArticleReferenceText
                                text={trimmed}
                                articles={law.articles}
                                currentArticleNumber={article.number}
                              />
                            </p>
                          );
                        })}
                      </div>
                    ) : article.number >= 720 ? (
                      <div className="space-y-4">
                        {article.text.split('\n').map((line: string, idx: number) => {
                          const trimmed = line.trim();
                          if (trimmed.startsWith('القاعدة')) {
                            return <p key={idx} className="font-bold text-primary border-r-4 border-primary/20 pr-3 mt-6 mb-2">{toHindiNumerals(trimmed)}</p>;
                          }
                          return (
                            <p key={idx} className="mr-6 text-foreground/90">
                              <ArticleReferenceText
                                text={trimmed}
                                articles={law.articles}
                                currentArticleNumber={article.number}
                              />
                            </p>
                          );
                        })}
                      </div>
                    ) : article.paragraphs && article.paragraphs.length > 0 ? (
                      <div className="space-y-2">
                        {(() => {
                          // Normalize & parse paragraphs into a visual AST for rendering.
                          // See: docs/extraction/boe_formatting_playbook.md (sections B, C, D)
                          //
                          // Pre-compute visual levels for smart indentation.
                          // Arabic ordinal markers (أولاً، ثانياً...) are top-level,
                          // numeric/letter markers (1-، أ-) under them are sub-level.
                          const isArabicOrdinalMarker = (m: string) =>
                            /^(أولا|ثانيا|ثالثا|رابعا|خامسا|سادسا|سابعا|ثامنا|تاسعا|عاشرا|حادي|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع)/i.test(m.replace(/ً/g, ''));
                          const isNumericMarker = (m: string) => /^\d/.test(m) || /^[٠-٩]/.test(m);
                          const isLetterMarker = (m: string) => /^[أ-ي]/.test(m) && !isArabicOrdinalMarker(m);

                          // Regex to detect ordinal text that should be a marker
                          // Matches: "أولاً :" or "أولاً:" or "ثانياً :" etc (with optional text after)
                          const ordinalTextRegex = /^(أولا[ًً]?|ثانيا[ًً]?|ثالثا[ًً]?|رابعا[ًً]?|خامسا[ًً]?|سادسا[ًً]?|سابعا[ًً]?|ثامنا[ًً]?|تاسعا[ًً]?|عاشرا[ًً]?|حادي[ًً]?\s*عشر|ثاني[ًً]?\s*عشر|ثالث[ًً]?\s*عشر|رابع[ًً]?\s*عشر|خامس[ًً]?\s*عشر)\s*[:：]/;

                          // First pass: normalize paragraphs — promote text-only ordinals to markers
                          // and handle compound num+letter markers (e.g. "6 - أ : text")
                          type NormalizedPara = { marker: string; text: string; dataLevel: number; paraType?: string; tableRows?: string[][] };
                          const normalizedParas: NormalizedPara[] = [];

                          for (const para of article.paragraphs!) {
                            // Pass through table paragraphs as-is
                            if ((para as any).type === 'table' && (para as any).table_rows) {
                              normalizedParas.push({ marker: '', text: '', dataLevel: 0, paraType: 'table', tableRows: (para as any).table_rows });
                              continue;
                            }

                            let m = (para.marker || "").trim();
                            let t = (para.text || "").trim();
                            const dataLevel = para.level || 0;

                            // If no marker but text looks like "أولاً :" or "أولاً : بعض النص"
                            if (!m && t) {
                              const ordMatch = t.match(ordinalTextRegex);
                              if (ordMatch) {
                                const matchEnd = t.indexOf(':', ordMatch[0].length - 1);
                                if (matchEnd !== -1) {
                                  m = t.slice(0, matchEnd + 1).trim();
                                  t = t.slice(matchEnd + 1).trim();
                                } else {
                                  m = ordMatch[0].trim();
                                  t = t.slice(ordMatch[0].length).trim();
                                }
                              }
                            }

                            // If no marker, check for patterns
                            let correctedLevel = dataLevel;
                            if (!m && t) {
                              // Standalone letter: "أ : text" or "ب : text" → extract letter as marker
                              const letterOnly = t.match(/^([أ-ي])\s*[-–:]\s*/);
                              if (letterOnly && !isArabicOrdinalMarker(letterOnly[1])) {
                                m = letterOnly[1] + ' :';
                                t = t.slice(letterOnly[0].length).trim();
                              }
                              // Compound: "6 - أ : text" → parent "6-" (empty text) + child "أ" with text
                              const compoundMatch = !m ? t.match(/^(\d{1,2}|[٠-٩]{1,2})\s*[-–]\s*([أ-ي])\s*[-–:]\s*/) : null;
                              if (compoundMatch) {
                                // Push parent numeric item with empty text
                                normalizedParas.push({ marker: compoundMatch[1] + '-', text: '', dataLevel: correctedLevel });
                                // Push child letter item one level deeper
                                normalizedParas.push({ marker: compoundMatch[2] + ' :', text: t.slice(compoundMatch[0].length).trim(), dataLevel: correctedLevel + 1 });
                                continue;
                              }
                              // Simple numeric: "4 الوسائط :" → marker "4-" with text
                              const numMatch = t.match(/^(\d{1,2}|[٠-٩]{1,2})\s*[-–\s]\s*([\u0600-\u06FF])/);
                              if (numMatch) {
                                m = numMatch[1] + '-';
                                t = t.slice(t.indexOf(numMatch[2])).trim();
                                correctedLevel = 1;
                              }
                            }

                            // If numeric marker and text starts with letter sub-item (أ : text)
                            // split into parent (numeric, empty text) + child (letter with text)
                            if (m && isNumericMarker(m) && t) {
                              const letterStart = t.match(/^([أ-ي])\s*[-–:]\s*/);
                              if (letterStart) {
                                normalizedParas.push({ marker: m, text: '', dataLevel: correctedLevel });
                                normalizedParas.push({ marker: letterStart[1] + ' :', text: t.slice(letterStart[0].length).trim(), dataLevel: correctedLevel + 1 });
                                continue;
                              }
                            }

                            normalizedParas.push({ marker: m, text: t, dataLevel: correctedLevel });
                          }

                          // Link standalone letter markers (ب، ج…) as children under last numeric parent
                          // If a letter marker is at same or lower level as the last numeric, bump it deeper
                          let lastNumericLevel = -1;
                          for (let i = 0; i < normalizedParas.length; i++) {
                            const np = normalizedParas[i];
                            if (np.marker && isNumericMarker(np.marker)) {
                              lastNumericLevel = np.dataLevel;
                            } else if (np.marker && isLetterMarker(np.marker) && lastNumericLevel >= 0 && np.dataLevel <= lastNumericLevel) {
                              np.dataLevel = lastNumericLevel + 1;
                            }
                          }

                          // Merge split paragraphs that belong together:
                          // No marker + previous has no marker + previous doesn't end with sentence-ending punctuation
                          for (let i = normalizedParas.length - 1; i >= 1; i--) {
                            const p = normalizedParas[i];
                            const prev = normalizedParas[i - 1];
                            if (!p.marker && p.text && !p.paraType) {
                              const isSplitSentence = !prev.marker && !prev.paraType && prev.text && !/[.،؛:。]\s*$/.test(prev.text.trim());
                              if (isSplitSentence) {
                                prev.text = prev.text + ' ' + p.text;
                                normalizedParas.splice(i, 1);
                              }
                            }
                          }

                          // Check if article has mixed marker types (ordinal + numeric/letter)
                          const markers = normalizedParas.map(p => p.marker).filter(Boolean);
                          const hasOrdinals = markers.some((m: string) => isArabicOrdinalMarker(m));
                          const hasNumeric = markers.some((m: string) => isNumericMarker(m));
                          const hasMixedLevels = hasOrdinals && hasNumeric;

                          // Compute effective visual level for each paragraph
                          type VisualPara = { marker: string; text: string; dataLevel: number; visualLevel: number; paraType?: string; tableRows?: string[][] };
                          const rawVisualParas: VisualPara[] = normalizedParas.map(np => {
                            if (np.paraType === 'table') {
                              return { ...np, visualLevel: 0 };
                            }
                            let visualLevel = np.dataLevel;
                            if (hasMixedLevels && np.marker) {
                              if (isArabicOrdinalMarker(np.marker)) visualLevel = 0;
                              else if (isNumericMarker(np.marker)) visualLevel = 1;
                              else if (isLetterMarker(np.marker)) visualLevel = 2;
                            }
                            return { marker: np.marker, text: np.text, dataLevel: np.dataLevel, visualLevel };
                          });

                          // Normalize levels: shift so the minimum marker level becomes 0
                          const markerLevels = rawVisualParas.filter(p => p.marker).map(p => p.visualLevel);
                          const minLevel = markerLevels.length > 0 ? Math.min(...markerLevels) : 0;
                          const visualParas = rawVisualParas.map(p => ({
                            ...p,
                            visualLevel: p.marker ? p.visualLevel - minLevel : p.visualLevel
                          }));

                          return visualParas.map((vp, idx) => {
                            const { marker, text, visualLevel } = vp;

                            // Render table paragraphs
                            if (vp.paraType === 'table' && vp.tableRows) {
                              return (
                                <div key={idx} className="my-3 overflow-x-auto">
                                  <table className="w-full border-collapse text-sm" style={{ direction: 'rtl' }}>
                                    <tbody>
                                      {vp.tableRows.map((row: string[], ri: number) => (
                                        <tr key={ri} className={ri % 2 === 0 ? 'bg-amber-50/40' : 'bg-white'}>
                                          {row.map((cell: string, ci: number) => (
                                            <td key={ci} className="border border-slate-200 px-4 py-2.5 text-right">
                                              {toHindiNumerals(cell)}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            }

                            // Skip paragraphs that are just section titles (duplicates of headers)
                            if (!marker && (text === currentPart || text === currentChapter || text === currentBranch)) {
                              return null;
                            }
                            const fullParagraphText = marker ? `${marker} ${text}` : text;
                            if (currentSubSection && fullParagraphText.trim() === currentSubSection.trim()) {
                              return null;
                            }
                            if (currentSubSubSection && fullParagraphText.trim() === currentSubSubSection.trim()) {
                              return null;
                            }

                            if (marker) {
                              return (
                                <NumberedItem key={idx} marker={marker} level={visualLevel}>
                                  <ArticleReferenceText
                                    text={text}
                                    articles={law.articles}
                                    currentArticleNumber={article.number}
                                  />
                                </NumberedItem>
                              );
                            }

                            // Continuation paragraph without marker: align with text of previous marker
                            let prevMarkerLevel = -1;
                            if (idx > 0) {
                              for (let pi = idx - 1; pi >= 0; pi--) {
                                if (visualParas[pi].marker) {
                                  prevMarkerLevel = visualParas[pi].visualLevel;
                                  break;
                                }
                              }
                            }
                            // indent = marker's own indent + offset to clear the marker text
                            const contIndent = prevMarkerLevel >= 2 ? 88 : prevMarkerLevel >= 1 ? 58 : prevMarkerLevel === 0 ? 28 : 0;

                            return (
                              <div key={idx} style={{ marginRight: `${contIndent}px`, whiteSpace: 'pre-wrap' }}>
                                <ArticleReferenceText
                                  text={text}
                                  articles={law.articles}
                                  currentArticleNumber={article.number}
                                />
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ) : (
                      <ArticleReferenceText
                        text={article.text}
                        articles={law.articles}
                        currentArticleNumber={article.number}
                      />
                    )}
                      </div>

                      {/* Amendments (التعديلات) - For BOE laws */}
                      {(article as any).amendments && (article as any).amendments.length > 0 && (
                        <div className="mt-4 border-r-4 border-amber-400/40 bg-amber-50/30 rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                            <span className="font-bold text-amber-800">مادة معدلة</span>
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-amber-600 border-amber-300 bg-amber-50">
                              {(article as any).amendments.length} تعديل
                            </Badge>
                          </div>
                          <div className="space-y-3">
                            {(article as any).amendments.map((amendment: any, idx: number) => (
                              <div key={idx} className="bg-white rounded-md p-3 border border-amber-200/50">
                                {amendment.decree && (
                                  <div className="text-xs text-amber-700 font-semibold mb-1">
                                    المرسوم: {toHindiNumerals(amendment.decree)}
                                    {amendment.date && <span className="mr-2">• التاريخ: {toHindiNumerals(amendment.date)}</span>}
                                  </div>
                                )}
                                {/* Render amendment content using content_parts (preserves original table position) */}
                                {(() => {
                                  const parts: any[] = amendment.content_parts || [];
                                  const markerPattern = /^[\(]?([أ-ي]|جـ)[\)]?\s*[-–—.]\s*/;
                                  const numMarkerPattern = /^[\(]?([0-9]+|[٠-٩]+)[\)]?\s*[-–—.]\s*/;

                                  // If no content_parts, fall back to plain description
                                  if (parts.length === 0 && amendment.description) {
                                    return (
                                      <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap" style={{ direction: 'rtl' }}>
                                        {amendment.description}
                                      </div>
                                    );
                                  }

                                  // Track whether previous text part had a marker (for indenting tables)
                                  let lastLineHadMarker = false;

                                  return (
                                    <div>
                                      {parts.map((part: any, pi: number) => {
                                        if (part.type === 'table' && part.table_rows) {
                                          // Render table — indent if it follows a marked line
                                          return (
                                            <div key={`part-${pi}`} className="overflow-x-auto my-2" style={lastLineHadMarker ? { marginRight: '40px' } : {}}>
                                              <table className="w-full border-collapse text-sm" style={{ direction: 'rtl' }}>
                                                <tbody>
                                                  {part.table_rows.map((row: string[], ri: number) => (
                                                    <tr key={ri} className={ri % 2 === 0 ? 'bg-amber-50/40' : 'bg-white'}>
                                                      {row.map((cell: string, ci: number) => (
                                                        <td key={ci} className="border border-amber-200 px-4 py-2 text-right">
                                                          {toHindiNumerals(cell)}
                                                        </td>
                                                      ))}
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          );
                                        }

                                        // Text part — split into lines and render with markers
                                        const textLines = (part.text || '').split('\n').filter((l: string) => l.trim());
                                        lastLineHadMarker = false;

                                        return (
                                          <div key={`part-${pi}`}>
                                            {textLines.map((line: string, li: number) => {
                                              const trimmed = line.trim();
                                              const letterMatch = trimmed.match(markerPattern);
                                              const numMatch = trimmed.match(numMarkerPattern);

                                              if (letterMatch) {
                                                lastLineHadMarker = true;
                                                return (
                                                  <div key={li} className="flex gap-1.5 my-1 text-sm text-slate-700" style={{ direction: 'rtl', marginRight: '16px' }}>
                                                    <span className="font-bold text-primary shrink-0">{letterMatch[1]}-</span>
                                                    <span className="leading-relaxed">{toHindiNumerals(trimmed.slice(letterMatch[0].length))}</span>
                                                  </div>
                                                );
                                              }
                                              if (numMatch) {
                                                lastLineHadMarker = true;
                                                return (
                                                  <div key={li} className="flex gap-1.5 my-1 text-sm text-slate-700" style={{ direction: 'rtl', marginRight: '16px' }}>
                                                    <span className="font-bold text-primary shrink-0">{toHindiNumerals(numMatch[1])}-</span>
                                                    <span className="leading-relaxed">{toHindiNumerals(trimmed.slice(numMatch[0].length))}</span>
                                                  </div>
                                                );
                                              }

                                              lastLineHadMarker = false;
                                              return (
                                                <div key={li} className="text-sm text-slate-700 leading-relaxed my-1" style={{ direction: 'rtl' }}>
                                                  {toHindiNumerals(trimmed)}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                                {amendment.new_text && (
                                  <div className="mt-2 pt-2 border-t border-amber-100">
                                    <div className="text-xs text-amber-600 font-medium mb-1">النص الجديد:</div>
                                    <div className="text-sm text-slate-600 bg-amber-50 rounded px-2 py-1 whitespace-pre-wrap" style={{ direction: 'rtl' }}>
                                      {amendment.new_text}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Regulations (اللائحة) - Collapsible with Reference Panel Style */}
                      {article.regulations && article.regulations.length > 0 && (
                        <div className="mt-4" data-testid={`regulations-panel-${article.number}`}>
                          <button
                            onClick={() => setOpenRegulationsId(openRegulationsId === article.number ? null : article.number)}
                            className="flex items-center gap-2 text-[#1a8a70] hover:text-[#1a8a70]/80 transition-colors"
                            data-testid={`button-toggle-regulations-${article.number}`}
                          >
                            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openRegulationsId === article.number ? 'rotate-180' : ''}`} />
                            <span className="font-semibold">اللائحة التنفيذية</span>
                          </button>
                          
                          {(openRegulationsId === article.number || showAllRegulations) && (
                            <div 
                              className="mt-3 bg-slate-50 dark:bg-slate-900/50 border-r-4 border-[#1a8a70]/40 rounded-md p-5 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800"
                            >
                              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-[#1a8a70] text-base">اللائحة التنفيذية</span>
                                  <span className="text-xs text-muted-foreground px-2 py-0.5 bg-slate-200/50 dark:bg-slate-800 rounded-full">
                                    {toHindiNumerals(article.regulations.length.toString())} بند
                                  </span>
                                </div>
                                <button
                                  onClick={() => setOpenRegulationsId(null)}
                                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                                  title="إغلاق"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                              <div className="space-y-4">
                                {article.regulations.map((reg: any, regIdx: number) => {
                                  const isRegRepealed = reg.status === 'ملغاة';
                                  return (
                                  <div key={regIdx} data-testid={`regulation-item-${article.number}-${regIdx}`} className={isRegRepealed ? 'opacity-60' : ''}>
                                    {isRegRepealed && <span className="text-xs font-medium text-red-500 mb-1 block">(ملغاة)</span>}
                                    <NumberedItem marker={toHindiNumerals(reg.number)} markerColor={isRegRepealed ? "text-red-400" : "text-[#1a8a70]"}>
                                      <ArticleReferenceText
                                        text={reg.text}
                                        articles={law.articles}
                                        currentArticleNumber={article.number}
                                      />
                                      
                                      {reg.sub_items && reg.sub_items.length > 0 && (
                                        <div className="mt-2 space-y-2">
                                          {reg.sub_items.map((sub: any, subIdx: number) => (
                                            <NumberedItem 
                                              key={subIdx} 
                                              marker={toHindiNumerals(sub.marker)} 
                                              level={1}
                                              markerColor="text-[#1a8a70]"
                                              data-testid={`regulation-subitem-${article.number}-${regIdx}-${subIdx}`}
                                            >
                                              <ArticleReferenceText
                                                text={sub.text}
                                                articles={law.articles}
                                                currentArticleNumber={article.number}
                                              />
                                            </NumberedItem>
                                          ))}
                                        </div>
                                      )}
                                    </NumberedItem>
                                  </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  
                  {/* Article Actions - separate row below text */}
                  <div className="flex items-center gap-1 mt-3">
                    <button
                      onClick={() => handleCopy(article)}
                      className={`p-1 rounded transition-colors ${
                        copyingId === article.number 
                          ? "text-[#1a8a70]" 
                          : "text-[#aaa] hover:text-[#666]"
                      }`}
                      title={copyingId === article.number ? "تم النسخ" : "نسخ المادة"}
                      data-testid={`button-copy-article-${article.number}`}
                    >
                      {copyingId === article.number ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      onClick={() => setReportingArticle(article.number)}
                      className="p-1 rounded text-[#aaa] hover:text-[#666] transition-colors"
                      title="إبلاغ عن خطأ"
                      data-testid={`button-report-article-${article.number}`}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                    </button>

                    {isAdmin && (
                      <button
                        onClick={() => setEditingArticle({ number: article.number, text: article.text })}
                        className="p-1 rounded text-amber-400 hover:text-amber-600 transition-colors"
                        title="تحرير المادة"
                        data-testid={`button-edit-article-${article.number}`}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Comparative Button - always visible if available */}
                  {hasComparative && (
                    <div className="mt-4">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => toggleComparative(article.number)}
                        className={`h-8 px-3 gap-2 transition-all duration-200 border shadow-sm whitespace-nowrap text-xs ${
                          isOpen 
                            ? "text-[#1a8a70] bg-[#1a8a70]/10 border-[#1a8a70]/30 hover:bg-[#1a8a70]/15" 
                            : "text-slate-500 border-slate-200 hover:text-[#1a8a70] hover:bg-[#1a8a70]/5"
                        }`}
                        data-testid={`button-comparative-article-${article.number}`}
                      >
                        <Scale className="w-3.5 h-3.5" />
                        <span className="font-medium">قارن مع قوانين في دول أخرى</span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1 bg-slate-100 text-slate-600">
                          {comparativeCount}
                        </Badge>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
                      </Button>
                    </div>
                  )}

                  {/* Comparative Laws Dropdown */}
                  {hasComparative && (
                    <div
                      className={`transition-all duration-300 ease-in-out ${
                        isOpen ? "max-h-[2000px] opacity-100 mt-5" : "max-h-0 opacity-0 overflow-hidden"
                      }`}
                    >
                      <div className="bg-gradient-to-b from-slate-50 to-slate-100/50 border border-slate-200 rounded-xl p-5">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200">
                          <div className="flex items-center gap-2">
                            <Scale className="w-4 h-4 text-[#1a8a70]" />
                            <h4 className="text-sm font-bold text-slate-700">المواد المقارنة</h4>
                          </div>
                          <Badge className="bg-[#1a8a70]/10 text-[#1a8a70] border-none text-[10px]">
                            {comparativeCount} نتيجة
                          </Badge>
                        </div>

                        {/* Comparative Items */}
                        <div className="space-y-4">
                          {article.cross_similar?.map((item: any, idx: number) => (
                            <a 
                              key={idx}
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block bg-white rounded-lg border border-slate-200 p-4 hover:border-[#1a8a70]/40 hover:shadow-md transition-all duration-200 group/item"
                              data-testid={`link-comparative-${article.number}-${idx}`}
                            >
                              {/* Country & Law Header */}
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <div>
                                    <div className="text-sm font-bold text-slate-700 group-hover/item:text-[#1a8a70] transition-colors">
                                      {item.law_name_ar}
                                    </div>
                                    <div className="text-xs text-slate-400">
                                      المادة {item.article_no}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Article Text */}
                              <div className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-lg p-3 border-r-4 border-[#1a8a70]/30">
                                {item.article_text_ar}
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              );
            });
          })()
        ) : (
          <div className="text-center py-24 bg-white rounded-2xl border border-dashed border-slate-200">
            <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-bold text-slate-700 mb-1">لم نعثر على نتائج</h3>
            <p className="text-slate-400 mb-6">جرب البحث بكلمات مختلفة أو رقم المادة</p>
            <Button 
              variant="outline" 
              onClick={() => setSearchQuery("")} 
              className="text-[#1a8a70] border-[#1a8a70]/20 hover:bg-[#1a8a70]/5"
              data-testid="button-show-all-articles"
            >
              عرض جميع المواد
            </Button>
          </div>
        )}
      </div>

      {/* Error Report Modal */}
      <Dialog 
        open={reportingArticle !== null} 
        onOpenChange={(open) => {
          if (!open) {
            setReportingArticle(null);
            setReportText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader className="pr-6">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <AlertCircle className="w-5 h-5 text-slate-400" />
              <span>الإبلاغ عن خطأ في المادة {reportingArticle ? toHindiNumerals(reportingArticle.toString()) : ""}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="صف الخطأ الموجود في النص..."
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              className="min-h-[120px] text-sm resize-none focus-visible:ring-slate-200"
              data-testid="textarea-report-modal"
            />
          </div>
          <DialogFooter className="flex flex-row gap-2 sm:justify-start">
            <Button
              variant="outline"
              onClick={() => {
                setReportingArticle(null);
                setReportText("");
              }}
              className="flex-1"
            >
              إلغاء
            </Button>
            <Button
              onClick={() => reportingArticle && handleSubmitReport(reportingArticle)}
              disabled={!reportText.trim() || isSubmittingReport}
              className="flex-1 bg-slate-800 hover:bg-slate-900"
            >
              {isSubmittingReport ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4 ml-2" />
                  إرسال البلاغ
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editingArticle && (
        <ArticleEditor
          isOpen={!!editingArticle}
          onClose={() => setEditingArticle(null)}
          lawId={lawId}
          articleNumber={editingArticle.number}
          originalText={editingArticle.text}
          onSaved={() => {
            refetchOverrides();
          }}
        />
      )}

    </div>
  );
}

function LawDetailSkeleton() {
  return (
    <div className="min-h-screen bg-background p-8 space-y-8">
      <Skeleton className="h-12 w-2/3" />
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

function LawNotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center p-4">
      <h1 className="text-4xl font-bold mb-4">النظام غير موجود</h1>
      <p className="text-muted-foreground mb-8">عذراً، لم نتمكن من العثور على النظام المطلوب.</p>
      <Link href="/library">
        <Button data-testid="button-back-to-library">العودة للمكتبة</Button>
      </Link>
    </div>
  );
}
