import { useState, useMemo, useCallback } from "react";
import { X } from "lucide-react";
import { NumberedItem } from "./NumberedItem";

interface Article {
  number: number;
  number_text?: string;
  text: string;
  paragraphs?: Array<{ marker: string; text: string; level?: number }>;
}

interface ArticleReferenceTextProps {
  text: string;
  articles: Article[];
  currentArticleNumber: number;
  nestingLevel?: number;
  maxNestingLevel?: number;
}

const arabicOrdinals: Record<string, number> = {
  "الأولى": 1, "الثانية": 2, "الثالثة": 3, "الرابعة": 4, "الخامسة": 5,
  "السادسة": 6, "السابعة": 7, "الثامنة": 8, "التاسعة": 9, "العاشرة": 10,
  "الحادية عشرة": 11, "الثانية عشرة": 12, "الثالثة عشرة": 13, "الرابعة عشرة": 14,
  "الخامسة عشرة": 15, "السادسة عشرة": 16, "السابعة عشرة": 17, "الثامنة عشرة": 18,
  "التاسعة عشرة": 19, "العشرين": 20, "العشرون": 20,
  "الحادية والعشرين": 21, "الثانية والعشرين": 22, "الثالثة والعشرين": 23,
  "الرابعة والعشرين": 24, "الخامسة والعشرين": 25, "السادسة والعشرين": 26,
  "السابعة والعشرين": 27, "الثامنة والعشرين": 28, "التاسعة والعشرين": 29,
  "الثلاثين": 30, "الثلاثون": 30,
  "الحادية والثلاثين": 31, "الثانية والثلاثين": 32, "الثالثة والثلاثين": 33,
  "الرابعة والثلاثين": 34, "الخامسة والثلاثين": 35, "السادسة والثلاثين": 36,
  "السابعة والثلاثين": 37, "الثامنة والثلاثين": 38, "التاسعة والثلاثين": 39,
  "الأربعين": 40, "الأربعون": 40,
  "الخمسين": 50, "الخمسون": 50,
  "الستين": 60, "الستون": 60,
  "السبعين": 70, "السبعون": 70,
  "الثمانين": 80, "الثمانون": 80,
  "التسعين": 90, "التسعون": 90,
  "المائة": 100, "المئة": 100,
  "المائتين": 200,
  "الثلاثمائة": 300, "الأربعمائة": 400, "الخمسمائة": 500,
  "الستمائة": 600, "السبعمائة": 700,
};

const tensMap: Record<string, number> = {
  "العشرين": 20, "الثلاثين": 30, "الأربعين": 40, "الخمسين": 50,
  "الستين": 60, "السبعين": 70, "الثمانين": 80, "التسعين": 90,
};

const hundredsMap: Record<string, number> = {
  "المائة": 100, "المئة": 100, "المائتين": 200,
  "الثلاثمائة": 300, "الأربعمائة": 400, "الخمسمائة": 500,
  "الستمائة": 600, "السبعمائة": 700,
};

function parseArabicArticleNumber(text: string): number | null {
  const normalizedText = text.trim();
  
  const digitMatch = normalizedText.match(/(\d+)/);
  if (digitMatch) {
    return parseInt(digitMatch[1], 10);
  }
  
  const hindiMatch = normalizedText.match(/([٠-٩]+)/);
  if (hindiMatch) {
    const hindiDigits = "٠١٢٣٤٥٦٧٨٩";
    const western = hindiMatch[1].split('').map(d => hindiDigits.indexOf(d)).join('');
    return parseInt(western, 10);
  }
  
  if (arabicOrdinals[normalizedText]) {
    return arabicOrdinals[normalizedText];
  }
  
  let total = 0;
  
  for (const [key, value] of Object.entries(hundredsMap)) {
    if (normalizedText.includes(key)) {
      total += value;
      break;
    }
  }
  
  for (const [key, value] of Object.entries(tensMap)) {
    if (normalizedText.includes(key)) {
      total += value;
      break;
    }
  }
  
  const unitsOrdinals: Record<string, number> = {
    "الأولى": 1, "الثانية": 2, "الثالثة": 3, "الرابعة": 4, "الخامسة": 5,
    "السادسة": 6, "السابعة": 7, "الثامنة": 8, "التاسعة": 9,
    "الحادية": 1,
  };
  
  for (const [key, value] of Object.entries(unitsOrdinals)) {
    if (normalizedText.includes(key)) {
      total += value;
      break;
    }
  }
  
  if (total > 0) return total;
  
  return null;
}

function toHindiNumerals(text: string): string {
  if (!text) return text;
  return text.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[parseInt(d)]);
}

interface ParsedSegment {
  type: 'text' | 'reference';
  content: string;
  articleNumber?: number;
  hasParentheses?: boolean;
}

// Base trigger words for article references
const BASE_TRIGGER_WORDS = [
  'كلتا المادتين',
  'كلا المادتين', 
  'المادتين',
  'المادتان',
  'المادتي',
  'المواد',
  'المادة',
];

// Generate all prefixed forms of trigger words
// Arabic prepositions that attach to words: ل، ب، ك، ف، و
// When ل attaches to المادة: ل + المادة = للمادة (the ا is dropped)
// When ب/ك/ف/و attach: ب + المادة = بالمادة (the ا stays)
function generatePrefixedForms(baseWords: string[]): string[] {
  const prefixedWords: string[] = [];
  
  for (const word of baseWords) {
    // Skip multi-word phrases for prefixing
    if (word.includes(' ')) {
      prefixedWords.push(word);
      // Add و prefix for phrases
      prefixedWords.push('و' + word);
      continue;
    }
    
    // Original word
    prefixedWords.push(word);
    
    // Words starting with ال (like المادة, المواد, المادتين)
    if (word.startsWith('ال')) {
      const withoutAl = word.slice(2); // Remove ال
      
      // ل prefix: ل + المادة = للمادة (ال becomes ل)
      prefixedWords.push('لل' + withoutAl);
      
      // ب، ك، ف prefixes: keep the ال
      prefixedWords.push('بال' + withoutAl);
      prefixedWords.push('كال' + withoutAl);
      prefixedWords.push('فال' + withoutAl);
      prefixedWords.push('وال' + withoutAl);
      
      // Combined prefixes: و + ل، و + ب، ف + ل، ف + ب
      prefixedWords.push('ولل' + withoutAl);
      prefixedWords.push('وبال' + withoutAl);
      prefixedWords.push('وكال' + withoutAl);
      prefixedWords.push('فلل' + withoutAl);
      prefixedWords.push('فبال' + withoutAl);
    }
  }
  
  // Sort by length descending to match longer patterns first
  return prefixedWords.sort((a, b) => b.length - a.length);
}

const TRIGGER_WORDS = generatePrefixedForms(BASE_TRIGGER_WORDS);

function parseArticleReferences(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let currentIndex = 0;
  
  // Build regex pattern from trigger words (longer phrases first to avoid partial matches)
  const triggerPattern = new RegExp(`(${TRIGGER_WORDS.join('|')})`, 'g');
  
  let triggerMatch;
  while ((triggerMatch = triggerPattern.exec(text)) !== null) {
    const triggerWord = triggerMatch[1];
    const triggerStart = triggerMatch.index;
    const afterTrigger = triggerStart + triggerWord.length;
    
    // Add text before this trigger
    if (triggerStart > currentIndex) {
      segments.push({
        type: 'text',
        content: text.slice(currentIndex, triggerStart)
      });
    }
    
    // Look at what follows the trigger word
    const remainingText = text.slice(afterTrigger);
    
    // Check for parenthetical reference: (X)
    const parenMatch = remainingText.match(/^(\s*)\(([^)]+)\)/);
    
    if (parenMatch) {
      const whitespace = parenMatch[1];
      const refContent = parenMatch[2].trim();
      const articleNumber = parseArabicArticleNumber(refContent);
      
      if (articleNumber && articleNumber >= 1 && articleNumber <= 721) {
        // Valid parenthetical reference
        segments.push({ type: 'text', content: triggerWord + whitespace });
        segments.push({
          type: 'reference',
          content: refContent,
          articleNumber,
          hasParentheses: true
        });
        
        currentIndex = afterTrigger + parenMatch[0].length;
        
        // Look for continuation references: و(X) و(Y) etc.
        let contText = text.slice(currentIndex);
        let contMatch;
        const contPattern = /^(\s*و\s*)\(([^)]+)\)/;
        
        while ((contMatch = contPattern.exec(contText)) !== null) {
          const connector = contMatch[1];
          const contRef = contMatch[2].trim();
          const contNumber = parseArabicArticleNumber(contRef);
          
          if (contNumber && contNumber >= 1 && contNumber <= 721) {
            segments.push({ type: 'text', content: connector });
            segments.push({
              type: 'reference',
              content: contRef,
              articleNumber: contNumber,
              hasParentheses: true
            });
            currentIndex += contMatch[0].length;
            contText = text.slice(currentIndex);
          } else {
            break;
          }
        }
      } else {
        // Invalid reference, treat as plain text
        segments.push({ type: 'text', content: triggerWord });
        currentIndex = afterTrigger;
      }
    } else {
      // Check for non-parenthetical reference: المادة الخامسة
      const nonParenMatch = remainingText.match(/^(\s+)([^،,؛;:.!؟?\n\(]+)/);
      
      if (nonParenMatch) {
        const whitespace = nonParenMatch[1];
        const candidateText = nonParenMatch[2].trim();
        const articleNumber = parseArabicArticleNumber(candidateText);
        
        if (articleNumber && articleNumber >= 1 && articleNumber <= 721) {
          const numberText = extractNumberText(candidateText, articleNumber);
          
          segments.push({ type: 'text', content: triggerWord + whitespace });
          segments.push({
            type: 'reference',
            content: numberText,
            articleNumber,
            hasParentheses: false
          });
          
          currentIndex = afterTrigger + whitespace.length + numberText.length;
        } else {
          segments.push({ type: 'text', content: triggerWord });
          currentIndex = afterTrigger;
        }
      } else {
        // No valid reference follows, treat trigger as plain text
        segments.push({ type: 'text', content: triggerWord });
        currentIndex = afterTrigger;
      }
    }
    
    // Update regex lastIndex to continue from our position
    triggerPattern.lastIndex = currentIndex;
  }
  
  // Add remaining text
  if (currentIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(currentIndex)
    });
  }
  
  return segments;
}

// Helper function to extract just the number portion from candidate text
function extractNumberText(candidateText: string, targetNumber: number): string {
  // Try progressively longer substrings until we find the shortest that gives the target number
  const words = candidateText.split(/\s+/);
  
  for (let i = 1; i <= words.length; i++) {
    const testText = words.slice(0, i).join(' ');
    const parsed = parseArabicArticleNumber(testText);
    if (parsed === targetNumber) {
      return testText;
    }
  }
  
  return candidateText;
}

interface ExpandedArticlePanelProps {
  article: Article;
  articles: Article[];
  nestingLevel: number;
  maxNestingLevel: number;
  onClose: () => void;
}

function ExpandedArticlePanel({ article, articles, nestingLevel, maxNestingLevel, onClose }: ExpandedArticlePanelProps) {
  return (
    <div 
      className="mt-4 mb-6 bg-slate-50 dark:bg-slate-900/50 border-r-4 border-primary/40 rounded-md p-5 shadow-sm animate-in slide-in-from-top-2 duration-300 ring-1 ring-slate-200 dark:ring-slate-800"
      style={{ direction: 'rtl' }}
    >
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="font-bold text-primary text-base">
            المادة {toHindiNumerals(article.number_text || article.number.toString())}
          </span>
          <span className="text-xs text-muted-foreground px-2 py-0.5 bg-slate-200/50 dark:bg-slate-800 rounded-full">مرجع</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          title="إغلاق المعاينة"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="text-base leading-relaxed text-foreground/90 prose-law">
        {article.paragraphs && article.paragraphs.length > 0 ? (
          <div className="space-y-3">
            {article.paragraphs.map((para, idx) => {
              const marker = (para.marker || "").trim();
              const paraText = (para.text || "").trim();
              const level = para.level || 0;
              
              if (marker) {
                return (
                  <NumberedItem key={idx} marker={marker} level={level}>
                    {nestingLevel < maxNestingLevel ? (
                      <ArticleReferenceText
                        text={paraText}
                        articles={articles}
                        currentArticleNumber={article.number}
                        nestingLevel={nestingLevel + 1}
                        maxNestingLevel={maxNestingLevel}
                      />
                    ) : (
                      <span>{toHindiNumerals(paraText)}</span>
                    )}
                  </NumberedItem>
                );
              }
              
              return (
                <div key={idx} style={{ marginRight: level === 2 ? '60px' : level === 1 ? '30px' : '0', whiteSpace: 'pre-wrap' }}>
                  {nestingLevel < maxNestingLevel ? (
                    <ArticleReferenceText
                      text={paraText}
                      articles={articles}
                      currentArticleNumber={article.number}
                      nestingLevel={nestingLevel + 1}
                      maxNestingLevel={maxNestingLevel}
                    />
                  ) : (
                    toHindiNumerals(paraText)
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-justify">
            {nestingLevel < maxNestingLevel ? (
              <ArticleReferenceText
                text={article.text}
                articles={articles}
                currentArticleNumber={article.number}
                nestingLevel={nestingLevel + 1}
                maxNestingLevel={maxNestingLevel}
              />
            ) : (
              toHindiNumerals(article.text)
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ArticleReferenceText({
  text,
  articles,
  currentArticleNumber,
  nestingLevel = 0,
  maxNestingLevel = 2
}: ArticleReferenceTextProps) {
  // Track expanded articles by article number only (not segment index) to avoid duplicates
  const [expandedArticles, setExpandedArticles] = useState<Record<number, boolean>>({});
  
  const segments = useMemo(() => parseArticleReferences(text), [text]);
  
  const toggleReference = useCallback((articleNumber: number) => {
    setExpandedArticles(prev => ({
      ...prev,
      [articleNumber]: !prev[articleNumber]
    }));
  }, []);
  
  const getArticle = useCallback((articleNumber: number) => {
    return articles.find(a => a.number === articleNumber);
  }, [articles]);
  
  const hasReferences = segments.some(s => s.type === 'reference');
  
  // Function to render text with line breaks
  const renderTextWithLineBreaks = (content: string) => {
    const parts = content.split(/\n+/);
    if (parts.length === 1) {
      return <span>{toHindiNumerals(content)}</span>;
    }
    return (
      <>
        {parts.map((part, i) => (
          <span key={i}>
            {toHindiNumerals(part)}
            {i < parts.length - 1 && <><br /><br /></>}
          </span>
        ))}
      </>
    );
  };
  
  if (!hasReferences) {
    return renderTextWithLineBreaks(text);
  }
  
  return (
    <>
      <span className="inline">
        {segments.map((segment, idx) => {
          if (segment.type === 'text') {
            // Handle line breaks in text segments
            const parts = segment.content.split(/\n+/);
            if (parts.length === 1) {
              return <span key={idx}>{toHindiNumerals(segment.content)}</span>;
            }
            return (
              <span key={idx}>
                {parts.map((part, i) => (
                  <span key={i}>
                    {toHindiNumerals(part)}
                    {i < parts.length - 1 && <><br /><br /></>}
                  </span>
                ))}
              </span>
            );
          }
          
          const articleNumber = segment.articleNumber!;
          const isExpanded = !!expandedArticles[articleNumber];
          const referencedArticle = getArticle(articleNumber);
          const isSelfReference = articleNumber === currentArticleNumber;
          
          if (isSelfReference || !referencedArticle) {
            return <span key={idx}>{toHindiNumerals(segment.content)}</span>;
          }
          
          const clickableRef = (
            <span
              onClick={() => toggleReference(articleNumber)}
              className={`
                text-primary font-semibold underline decoration-primary/30 underline-offset-4
                hover:bg-primary/5 transition-all cursor-pointer
                ${isExpanded ? 'bg-primary/10 decoration-primary' : ''}
              `}
              style={{ 
                cursor: 'pointer',
                display: 'inline',
                letterSpacing: 0,
                wordBreak: 'normal'
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && toggleReference(articleNumber)}
              data-testid={`article-ref-${currentArticleNumber}-to-${articleNumber}`}
            >
              {toHindiNumerals(segment.content)}
            </span>
          );
          
          if (segment.hasParentheses) {
            return (
              <span key={idx}>
                ({clickableRef})
              </span>
            );
          }
          
          return <span key={idx}>{clickableRef}</span>;
        })}
      </span>

      {/* Expanded Panels Container - deduplicated by article number */}
      {(() => {
        // Get unique expanded article numbers
        const expandedArticleNumbers = Object.entries(expandedArticles)
          .filter(([_, isOpen]) => isOpen)
          .map(([num]) => parseInt(num));
        
        if (expandedArticleNumbers.length === 0) return null;
        
        return (
          <div className="w-full block">
            {expandedArticleNumbers.map(articleNumber => {
              const referencedArticle = getArticle(articleNumber);
              if (!referencedArticle) return null;

              return (
                <ExpandedArticlePanel
                  key={`panel-${articleNumber}`}
                  article={referencedArticle}
                  articles={articles}
                  nestingLevel={nestingLevel}
                  maxNestingLevel={maxNestingLevel}
                  onClose={() => toggleReference(articleNumber)}
                />
              );
            })}
          </div>
        );
      })()}
    </>
  );
}

export default ArticleReferenceText;
