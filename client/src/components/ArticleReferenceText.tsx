// Onboarding: see /docs/onboarding (VISION, DOMAIN, ARCHITECTURE, DATA_CONTRACTS, DEBUG_PLAYBOOK)
import { useState, useMemo, useCallback, useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
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
  isDefinitionContext?: boolean;
  /** Name of the current law (e.g. "نظام المعالجات التجارية") for resolving unnamed references like "من اللائحة" */
  lawName?: string;
}

/** Detect if text starts with a short definition term followed by `:`.
 *  Returns { term, separator, rest } or null if not a definition pattern.
 *  Guards: term ≤60 chars, rest is non-empty, colon is not at the very end. */
function splitDefinitionTerm(text: string): { term: string; separator: string; rest: string } | null {
  // Match first colon (possibly with surrounding spaces)
  const match = text.match(/^([^:]+?)\s*(:)\s*/);
  if (!match) return null;
  const term = match[1].trim();
  const afterColon = text.slice(match[0].length).trim();
  // Term must be short (a defined term, not a full sentence) and rest must exist
  if (term.length === 0 || term.length > 60 || afterColon.length === 0) return null;
  return { term, separator: ' : ', rest: afterColon };
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

// Pre-sorted keys: longest first so "التاسعة عشرة" matches before "التاسعة"
const arabicOrdinalKeysSorted = Object.keys(arabicOrdinals).sort((a, b) => b.length - a.length);

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

  // Try exact match in the full ordinals dictionary first
  if (arabicOrdinals[normalizedText]) {
    return arabicOrdinals[normalizedText];
  }

  // Try finding the longest matching key from arabicOrdinals within the text
  for (const key of arabicOrdinalKeysSorted) {
    if (normalizedText.includes(key)) {
      return arabicOrdinals[key];
    }
  }

  // Fallback: decompose into hundreds + tens + units
  let total = 0;

  for (const [key, value] of Object.entries(hundredsMap)) {
    if (normalizedText.includes(key)) {
      total += value;
      break;
    }
  }

  // Check for "عشرة/عشر" (teens pattern: 11-19) before checking tens
  const teensMap: Record<string, number> = {
    "إحدى عشرة": 11, "اثنتي عشرة": 12, "ثلاث عشرة": 13, "أربع عشرة": 14,
    "خمس عشرة": 15, "ست عشرة": 16, "سبع عشرة": 17, "ثماني عشرة": 18,
    "تسع عشرة": 19,
  };

  let foundTeens = false;
  for (const [key, value] of Object.entries(teensMap)) {
    if (normalizedText.includes(key)) {
      total += value;
      foundTeens = true;
      break;
    }
  }

  if (!foundTeens) {
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
  }

  if (total > 0) return total;

  return null;
}

function toHindiNumerals(text: string): string {
  if (!text) return text;
  return text.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[parseInt(d)]);
}

interface ParsedSegment {
  type: 'text' | 'reference' | 'external_reference';
  content: string;
  articleNumber?: number;
  hasParentheses?: boolean;
  externalLawName?: string;       // For named external: "نظام المعالجات التجارية"
  unnamedKeyword?: string;         // For unnamed external: "اللائحة", "النظام" (to resolve from context)
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

// Words that follow "المادة" but indicate substance/material, not a legal article reference
const NON_ARTICLE_FOLLOWERS = new Set([
  'الجافة', 'الفعالة', 'الخام', 'السامة', 'الكيميائية', 'العضوية', 'المشعة',
  'الغذائية', 'الدوائية', 'المخدرة', 'المحظورة', 'الأولية', 'النقية',
  'البيضاء', 'السوداء', 'الرمادية', 'الصلبة', 'السائلة', 'الغازية',
]);

// ─── External law reference detection ───────────────────────────
//
// Three categories of "المادة X من ___":
//
// 1. SELF-REFERENCE: "من هذا النظام" / "من هذه اللائحة"
//    → Keep internal link (article X of current law)
//
// 2. NAMED EXTERNAL: "من نظام المعالجات التجارية" / "من لائحة الخدمة المدنية"
//    → indefinite keyword + specific name → search library → external blue link
//    Pattern: من + (نظام|لائحة|...) + NAME (at least one more word)
//
// 3. UNNAMED EXTERNAL: "من النظام" / "من اللائحة" / "من القانون"
//    → definite keyword WITHOUT a specific name → can't determine which law
//    → Don't link (show as plain text) — do NOT create wrong internal link either
//
// IMPORTANT: "من النظام" (definite, no name) ≠ "من نظام X" (indefinite + name).
// "من اللائحة" likely refers to the regulation of THIS law or one mentioned in context.

// Matches "من النظام/اللائحة/..." (definite form, no specific name = ambiguous, skip linking)
const UNNAMED_EXTERNAL_PATTERN = /^\s+من\s+(النظام|اللائحة|التنظيم|القانون|المرسوم|القرار)(?:\s*[،,؛;.!؟?\n]|\s*$)/;

// Matches "من نظام X" / "من لائحة Y" (indefinite + name = identifiable external law)
const NAMED_EXTERNAL_KEYWORDS = 'نظام|لائحة|تنظيم|قانون|مرسوم|قرار';
const NAMED_EXTERNAL_PATTERN = new RegExp(`^\\s+من\\s+((?:${NAMED_EXTERNAL_KEYWORDS})\\s+[^،,؛;.!؟?\\n]+)`);

// Matches self-reference: "من هذا النظام" / "من هذه اللائحة"
const SELF_REFERENCE_PATTERN = /^\s+من\s+هذ[اه]\s+(النظام|اللائحة|التنظيم|القانون|المرسوم|القرار)/;

/** Check text after article number and classify the reference type */
function classifyReference(afterNumber: string): {
  type: 'self' | 'named_external' | 'unnamed_external' | 'internal';
  externalLawName?: string;
  unnamedKeyword?: string;  // e.g. "اللائحة", "النظام" — for smart resolution
  matchLength?: number;
} {
  // 1. Self-reference: "من هذا النظام"
  if (SELF_REFERENCE_PATTERN.test(afterNumber)) {
    return { type: 'self' };
  }
  // 2. Named external: "من نظام المعالجات التجارية"
  const namedMatch = afterNumber.match(NAMED_EXTERNAL_PATTERN);
  if (namedMatch) {
    return { type: 'named_external', externalLawName: namedMatch[1].trim(), matchLength: namedMatch[0].length };
  }
  // 3. Unnamed external: "من اللائحة" / "من النظام" (no specific name — resolve from context)
  const unnamedMatch = afterNumber.match(UNNAMED_EXTERNAL_PATTERN);
  if (unnamedMatch) {
    return { type: 'unnamed_external', unnamedKeyword: unnamedMatch[1], matchLength: unnamedMatch[0].length };
  }
  // 4. Internal reference (no "من" pattern)
  return { type: 'internal' };
}

// Parse article cross-references (المادة الخامسة، المادتين...) into clickable segments.
// See: docs/extraction/boe_formatting_playbook.md (sections C, E)
function parseArticleReferences(text: string, validArticleNumbers: Set<number>): ParsedSegment[] {
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

    // Skip if this is "المادة" used as substance/material (e.g. "المادة الجافة", "المادة الفعالة")
    const followerCheck = remainingText.match(/^\s+(\S+)/);
    if (followerCheck && NON_ARTICLE_FOLLOWERS.has(followerCheck[1])) {
      segments.push({ type: 'text', content: triggerWord });
      currentIndex = afterTrigger;
      triggerPattern.lastIndex = currentIndex;
      continue;
    }

    // Check for parenthetical reference: (X)
    const parenMatch = remainingText.match(/^(\s*)\(([^)]+)\)/);
    
    if (parenMatch) {
      const whitespace = parenMatch[1];
      const refContent = parenMatch[2].trim();

      // Check for multiple references first: (الخامسة، والسادسة، والسابعة)
      if (refContent.includes('،') || refContent.includes(',')) {
        const parts = refContent.split(/[،,]/);
        let anyValid = false;
        const tempSegments: ParsedSegment[] = [];

        for (let pi = 0; pi < parts.length; pi++) {
          const rawPart = parts[pi].trim();
          const part = rawPart.replace(/^و/, '').trim();
          const partNum = parseArabicArticleNumber(part);
          if (partNum && validArticleNumbers.has(partNum)) {
            anyValid = true;
            if (pi > 0) {
              // Preserve the original connector text (و prefix)
              const connector = rawPart.startsWith('و') ? '، و' : '، ';
              tempSegments.push({ type: 'text', content: connector });
            }
            tempSegments.push({
              type: 'reference',
              content: part,
              articleNumber: partNum,
              hasParentheses: false
            });
          } else {
            if (pi > 0) tempSegments.push({ type: 'text', content: '، ' });
            tempSegments.push({ type: 'text', content: rawPart });
          }
        }

        if (anyValid) {
          // Check for external law reference after the parenthetical group
          const afterMultiParen = text.slice(afterTrigger + parenMatch[0].length);
          const multiRef = classifyReference(afterMultiParen);

          if (multiRef.type === 'named_external') {
            const fullMultiRefText = triggerWord + parenMatch[0];
            const fromText = afterMultiParen.slice(0, multiRef.matchLength || 0);
            segments.push({
              type: 'external_reference',
              content: fullMultiRefText + fromText,
              externalLawName: multiRef.externalLawName
            });
            currentIndex = afterTrigger + parenMatch[0].length + (multiRef.matchLength || 0);
            triggerPattern.lastIndex = currentIndex;
            continue;
          }
          if (multiRef.type === 'unnamed_external') {
            // "من اللائحة" / "من النظام" — resolve from context using current law name
            const fullMultiUnnamedText = triggerWord + parenMatch[0];
            const multiUnnamedFromText = afterMultiParen.slice(0, multiRef.matchLength || 0);
            segments.push({
              type: 'external_reference',
              content: fullMultiUnnamedText + multiUnnamedFromText,
              unnamedKeyword: multiRef.unnamedKeyword
            });
            currentIndex = afterTrigger + parenMatch[0].length + (multiRef.matchLength || 0);
            triggerPattern.lastIndex = currentIndex;
            continue;
          }

          segments.push({ type: 'text', content: triggerWord + whitespace + '(' });
          segments.push(...tempSegments);
          segments.push({ type: 'text', content: ')' });
          currentIndex = afterTrigger + parenMatch[0].length;
        } else {
          segments.push({ type: 'text', content: triggerWord });
          currentIndex = afterTrigger;
        }
      } else {
        const articleNumber = parseArabicArticleNumber(refContent);

        // Check for external law reference first (before internal validation)
        if (articleNumber) {
          const afterParen = text.slice(afterTrigger + parenMatch[0].length);
          const parenRef = classifyReference(afterParen);

          if (parenRef.type === 'named_external') {
            const fullParenRefText = triggerWord + parenMatch[0];
            const parenFromText = afterParen.slice(0, parenRef.matchLength || 0);
            segments.push({
              type: 'external_reference',
              content: fullParenRefText + parenFromText,
              articleNumber,
              externalLawName: parenRef.externalLawName
            });
            currentIndex = afterTrigger + parenMatch[0].length + (parenRef.matchLength || 0);
            triggerPattern.lastIndex = currentIndex;
            continue;
          }
          if (parenRef.type === 'unnamed_external') {
            // "من اللائحة" / "من النظام" — resolve from context
            const fullParenUnnamedText = triggerWord + parenMatch[0];
            const parenUnnamedFromText = afterParen.slice(0, parenRef.matchLength || 0);
            segments.push({
              type: 'external_reference',
              content: fullParenUnnamedText + parenUnnamedFromText,
              articleNumber,
              unnamedKeyword: parenRef.unnamedKeyword
            });
            currentIndex = afterTrigger + parenMatch[0].length + (parenRef.matchLength || 0);
            triggerPattern.lastIndex = currentIndex;
            continue;
          }
        }

        if (articleNumber && validArticleNumbers.has(articleNumber)) {
          // Valid single parenthetical reference (internal)
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

            if (contNumber && validArticleNumbers.has(contNumber)) {
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
      }
    } else {
      // Check for non-parenthetical reference: المادة الخامسة
      // Match up to 4 words, stopping at punctuation or parentheses
      const nonParenMatch = remainingText.match(/^(\s+)([^،,؛;:.!؟?\n\(]+)/);

      if (nonParenMatch) {
        const whitespace = nonParenMatch[1];
        const candidateText = nonParenMatch[2].trim();
        const candidateWords = candidateText.split(/\s+/);

        // Try progressively longer prefixes using EXACT dictionary/digit match only.
        // IMPORTANT: First find the LONGEST valid number (e.g. "السادسة عشرة"=16 not "السادسة"=6),
        // then check if that number exists in the law's articles.
        // Phase 1: Find the longest matching number text (regardless of validity)
        let bestParsed: number | null = null;
        let bestNumberText = "";
        for (let wi = 1; wi <= Math.min(candidateWords.length, 4); wi++) {
          const testText = candidateWords.slice(0, wi).join(' ');
          const exactMatch = arabicOrdinals[testText];
          const digitMatch = testText.match(/^(\d+)$/) ? parseInt(testText, 10)
            : testText.match(/^([٠-٩]+)$/) ? parseInt(testText.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString()), 10)
            : null;
          const parsed = exactMatch ?? digitMatch ?? null;
          if (parsed !== null) {
            bestParsed = parsed;
            bestNumberText = testText;
          } else if (bestParsed !== null) {
            break; // No longer matches, stop extending
          }
        }
        // Phase 2: Check for EXTERNAL law reference first (must happen before internal validation!)
        // "المادة الرابعة من نظام المعالجات التجارية" → named external → blue link
        // "المادة العاشرة من اللائحة" → unnamed external → plain text (can't determine which)
        // "المادة الخامسة من هذا النظام" → self-reference → internal link
        if (bestParsed !== null) {
          const afterNumber = text.slice(afterTrigger + whitespace.length + bestNumberText.length);
          const refClass = classifyReference(afterNumber);

          if (refClass.type === 'named_external') {
            // Named external: "من نظام المعالجات التجارية" → create external link
            const fullRefText = triggerWord + whitespace + bestNumberText;
            const fromText = afterNumber.slice(0, refClass.matchLength || 0);
            segments.push({
              type: 'external_reference',
              content: fullRefText + fromText,
              articleNumber: bestParsed,
              externalLawName: refClass.externalLawName
            });
            currentIndex = afterTrigger + whitespace.length + bestNumberText.length + (refClass.matchLength || 0);
            triggerPattern.lastIndex = currentIndex;
            continue;
          }
          if (refClass.type === 'unnamed_external') {
            // Unnamed external: "من اللائحة" / "من النظام" → resolve from context using law name
            const fullUnnamedRefText = triggerWord + whitespace + bestNumberText;
            const unnamedFromText = afterNumber.slice(0, refClass.matchLength || 0);
            segments.push({
              type: 'external_reference',
              content: fullUnnamedRefText + unnamedFromText,
              articleNumber: bestParsed,
              unnamedKeyword: refClass.unnamedKeyword
            });
            currentIndex = afterTrigger + whitespace.length + bestNumberText.length + (refClass.matchLength || 0);
            triggerPattern.lastIndex = currentIndex;
            continue;
          }
          // 'self' and 'internal' fall through to Phase 3 (internal validation)
        }

        // Phase 3: Validate the longest matched number against this law's articles (internal reference)
        let articleNumber: number | null = null;
        let numberText = "";
        if (bestParsed !== null && validArticleNumbers.has(bestParsed)) {
          articleNumber = bestParsed;
          numberText = bestNumberText;
        }

        if (articleNumber && numberText) {
          segments.push({ type: 'text', content: triggerWord + whitespace });
          segments.push({
            type: 'reference',
            content: numberText,
            articleNumber,
            hasParentheses: false
          });

          currentIndex = afterTrigger + whitespace.length + numberText.length;

          // For plural triggers (المادتين، المادتان، المواد), look for continuation references
          // e.g. "والمادتين الرابعة والسادسة" → "الرابعة" + "السادسة"
          const pluralTriggers = ['المادتين', 'المادتان', 'المادتي', 'المواد'];
          const isTriggerPlural = pluralTriggers.some(pt => triggerWord.includes(pt));
          if (isTriggerPlural) {
            let contText = text.slice(currentIndex);
            const contOrdinalPattern = /^(\s*و\s*)([^\s،,؛;:.!؟?\n\(]+)/;
            let contMatch;
            while ((contMatch = contOrdinalPattern.exec(contText)) !== null) {
              const connector = contMatch[1];
              const contCandidate = contMatch[2].trim();
              const contNumber = parseArabicArticleNumber(contCandidate);
              if (contNumber && validArticleNumbers.has(contNumber)) {
                segments.push({ type: 'text', content: connector });
                segments.push({
                  type: 'reference',
                  content: contCandidate,
                  articleNumber: contNumber,
                  hasParentheses: false
                });
                currentIndex += contMatch[0].length;
                contText = text.slice(currentIndex);
              } else {
                break;
              }
            }
          }
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
  const words = candidateText.split(/\s+/);

  // Try progressively longer prefixes. When we find one that matches targetNumber,
  // check if adding more words would give a DIFFERENT number — if so, we found
  // the boundary. If not, keep going to find the tightest match.
  // E.g. for "التاسعة عشرة فإن الجهة" with target=19:
  //   "التاسعة" → 9 ≠ 19 → skip
  //   "التاسعة عشرة" → 19 = 19 → check next: "التاسعة عشرة فإن" → 19 still
  //     but "التاسعة عشرة" is an exact dictionary key → return it

  let lastMatch = "";

  for (let i = 1; i <= words.length; i++) {
    const testText = words.slice(0, i).join(' ');
    const parsed = parseArabicArticleNumber(testText);
    if (parsed === targetNumber) {
      // Prefer exact dictionary match — it's the most precise
      if (arabicOrdinals[testText] === targetNumber) {
        return testText;
      }
      if (!lastMatch) {
        lastMatch = testText;
      }
    } else if (lastMatch) {
      // We had a match but this longer version gives a different number — return previous
      return lastMatch;
    }
  }

  return lastMatch || candidateText;
}

// ============================================
// Library cache for external law name → ID lookup
// ============================================
interface LibraryCacheEntry {
  id: string;
  title_ar: string;
}

// Module-level cache: loaded once, shared across all ArticleReferenceText instances
let libraryCache: LibraryCacheEntry[] | null = null;
let libraryCachePromise: Promise<LibraryCacheEntry[]> | null = null;

function loadLibraryCache(): Promise<LibraryCacheEntry[]> {
  if (libraryCache) return Promise.resolve(libraryCache);
  if (libraryCachePromise) return libraryCachePromise;

  libraryCachePromise = fetch('/api/library')
    .then(res => res.json())
    .then((items: any[]) => {
      libraryCache = items.map(item => ({
        id: item.id,
        title_ar: item.title_ar || ''
      }));
      return libraryCache;
    })
    .catch(() => {
      libraryCachePromise = null;
      return [] as LibraryCacheEntry[];
    });

  return libraryCachePromise;
}

/** Find a law by matching its name against the library.
 *  Uses fuzzy matching: the referenced name must be a substring of or contain the library title. */
function findLawByName(name: string, cache: LibraryCacheEntry[]): LibraryCacheEntry | null {
  if (!name || !cache.length) return null;

  const normalized = name.trim();

  // 1. Exact match on title
  const exact = cache.find(c => c.title_ar === normalized);
  if (exact) return exact;

  // 2. Library title contains the referenced name
  const contained = cache.find(c => c.title_ar.includes(normalized));
  if (contained) return contained;

  // 3. Referenced name contains library title
  const containing = cache.find(c => normalized.includes(c.title_ar) && c.title_ar.length > 10);
  if (containing) return containing;

  // 4. Try without the type prefix: "نظام المعالجات التجارية" → "المعالجات التجارية"
  const withoutType = normalized.replace(/^(نظام|لائحة|تنظيم|قانون|مرسوم|قرار|النظام|اللائحة|التنظيم|القانون|المرسوم|القرار)\s+/, '');
  if (withoutType !== normalized) {
    const byContent = cache.find(c => c.title_ar.includes(withoutType) && withoutType.length > 5);
    if (byContent) return byContent;
  }

  return null;
}

/**
 * Extract ALL inline definitions from the law's articles.
 * Scans ALL articles (not just Article 1) for two patterns:
 *
 * Pattern A (colon): "النظام : نظام المعالجات التجارية." (Article 1 of most BOE laws)
 * Pattern B (inline): 'نظام المعالجات التجارية "النظام"' (any article, e.g. uqn_28552)
 *
 * Returns a map: { "النظام": "نظام المعالجات التجارية في التجارة الدولية", "اللائحة": "اللائحة التنفيذية للنظام", ... }
 */
function extractDefinitionsMap(articles: Article[]): Record<string, string> {
  const defs: Record<string, string> = {};
  const aliasKeywords = ['النظام', 'اللائحة', 'التنظيم', 'القانون', 'المرسوم', 'القرار', 'الهيئة', 'الوكالة', 'المركز', 'المجلس'];

  // Pattern A: Colon-based (Article 0-1 only) — "الكلمة : التعريف."
  // ONLY match actual colon (:) separator, NOT quotes — quotes are handled by Pattern B
  for (const art of articles.filter(a => a.number <= 1)) {
    const text = art.text || '';
    for (const kw of aliasKeywords) {
      if (defs[kw]) continue;
      const colonRe = new RegExp(`${kw}\\s*:\\s*([^.،]+)`, 'g');
      const m = colonRe.exec(text);
      if (m) {
        const val = m[1].trim().replace(/["\u201C\u201D\u200F]/g, '');
        if (val.length > 5) defs[kw] = val;
      }
    }
  }

  // Pattern B: Inline alias (ALL articles) — 'FULL_NAME "الكلمة"'
  // The full name appears BEFORE the quoted alias.
  // e.g. 'نظام المعالجات التجارية في التجارة الدولية "النظام"'
  // e.g. 'اللائحة التنفيذية للنظام "اللائحة"'
  for (const art of articles) {
    const text = art.text || '';
    for (const kw of aliasKeywords) {
      if (defs[kw]) continue;
      const inlineRe = new RegExp(
        `([^\u201C\u201D"'،.\\n]{3,100})\\s*["\u201C\u201D]${kw}["\u201C\u201D]`,
        'g'
      );
      const m = inlineRe.exec(text);
      if (m) {
        let fullName = m[1].trim();
        // Strip "المادة X من" prefix: "المادة الرابعة  من نظام X" → "نظام X"
        const strip = fullName.match(
          /(?:من|وفق|بموجب|في)\s+((?:نظام|لائحة|تنظيم|قانون|مرسوم|قرار|اللائحة|النظام|هيئة|وكالة|مركز|مجلس)\s+.+)/
        );
        if (strip) {
          fullName = strip[1].trim();
        } else {
          const typeExtract = fullName.match(
            /((?:نظام|لائحة|تنظيم|قانون|مرسوم|قرار|اللائحة|النظام|هيئة|وكالة)\s+[^\u201C\u201D"']+)/
          );
          if (typeExtract) fullName = typeExtract[1].trim();
        }
        if (fullName.length > 5) defs[kw] = fullName;
      }
    }
  }

  return defs;
}

// Module-level cache for definitions per law (keyed by first article text hash)
let _defsCache: { key: string; defs: Record<string, string> } | null = null;

function getDefinitionsMap(articles: Article[]): Record<string, string> {
  // Simple cache key: article count + first article text length
  const key = `${articles.length}_${(articles[0]?.text || '').length}`;
  if (_defsCache && _defsCache.key === key) return _defsCache.defs;
  const defs = extractDefinitionsMap(articles);
  _defsCache = { key, defs };
  return defs;
}

/**
 * Smart resolution for unnamed references like "من اللائحة" / "من النظام".
 *
 * Multi-strategy approach (ordered by reliability):
 *
 * Strategy 0: Extract definitions from the law's articles (colon + inline patterns)
 *             Then resolve back-references (e.g. "للنظام" → expand using "النظام" definition)
 * Strategy 1: Name-based search — use current law name to find related documents
 *
 * Works across ALL 3900+ laws on the platform.
 */
function resolveUnnamedReference(
  keyword: string, // "النظام", "اللائحة", "القانون", etc.
  currentLawName: string,
  cache: LibraryCacheEntry[],
  articles?: Article[]  // ALL articles of the current law
): LibraryCacheEntry | null {
  if (!cache.length) return null;

  // ── Strategy 0: Definition-based resolution ──
  if (articles && articles.length > 0) {
    const defs = getDefinitionsMap(articles);
    let definedName = defs[keyword];

    if (definedName) {
      // Check if the definition contains a back-reference like "للنظام" / "لهذا النظام"
      // e.g. "اللائحة التنفيذية للنظام" where "للنظام" = "for THIS law"
      // IMPORTANT: Try to expand back-references FIRST, because a direct match on
      // a generic name like "اللائحة التنفيذية للنظام" will match the WRONG law.
      const backRefPatterns: Array<{ pattern: RegExp; refKeyword: string; preposition: string }> = [
        { pattern: /لهذا النظام/, refKeyword: 'النظام', preposition: 'لنظام' },
        { pattern: /للنظام/, refKeyword: 'النظام', preposition: 'لنظام' },
        { pattern: /لهذه اللائحة/, refKeyword: 'اللائحة', preposition: 'للائحة' },
        { pattern: /للائحة/, refKeyword: 'اللائحة', preposition: 'للائحة' },
        { pattern: /لهذا التنظيم/, refKeyword: 'التنظيم', preposition: 'لتنظيم' },
        { pattern: /للتنظيم/, refKeyword: 'التنظيم', preposition: 'لتنظيم' },
      ];

      let hasBackRef = false;
      for (const br of backRefPatterns) {
        if (br.pattern.test(definedName) && br.refKeyword !== keyword) {
          hasBackRef = true;
          const refName = defs[br.refKeyword];
          if (refName) {
            // Expand: "اللائحة التنفيذية للنظام" → "اللائحة التنفيذية لنظام المعالجات التجارية..."
            const expanded = definedName.replace(br.pattern, `ل${refName}`);
            const expandedFound = findLawByName(expanded, cache);
            // Validate: the result's type must match the definition's type
            // e.g. if definition is "اللائحة التنفيذية", result must contain "لائحة" not just "نظام"
            const defFirstWord = definedName.split(/\s+/)[0]; // "اللائحة"
            if (expandedFound && expandedFound.title_ar.includes(defFirstWord.replace(/^ال/, ''))) {
              return expandedFound;
            }

            // Topic-based search: title contains "اللائحة التنفيذية" AND contains "المعالجات التجارية"
            const refTopic = refName.replace(/^(?:نظام|لائحة|تنظيم|قانون|مرسوم|قرار)\s+/, '');
            if (refTopic.length > 5) {
              const typePrefix = definedName.split(/\s+/).slice(0, 2).join(' ');
              const topicFound = cache.find(c =>
                c.title_ar.includes(typePrefix) && c.title_ar.includes(refTopic)
              );
              if (topicFound) return topicFound;
            }
          } else if (currentLawName) {
            // No definition for the referenced keyword — use current law name as fallback
            // e.g. "اللائحة : اللائحة التنفيذية لهذا النظام" but no "النظام" definition
            // → use currentLawName to extract topic
            const coreMatch = currentLawName.match(/^(?:نظام|لائحة|تنظيم|قانون|مرسوم|قرار)\s+(.+)/);
            if (coreMatch) {
              const topic = coreMatch[1];
              const typePrefix = definedName.split(/\s+/).slice(0, 2).join(' ');
              const fallbackFound = cache.find(c =>
                c.title_ar.includes(typePrefix) && c.title_ar.includes(topic)
              );
              if (fallbackFound) return fallbackFound;
              // Also try shorter topic
              const shortTopic = topic.split(/\s+/).slice(0, 3).join(' ');
              if (shortTopic.length > 5) {
                const shortFound = cache.find(c =>
                  c.title_ar.includes(typePrefix) && c.title_ar.includes(shortTopic)
                );
                if (shortFound) return shortFound;
              }
            }
          }
          break;
        }
      }

      // If no back-reference, try direct match in library
      if (!hasBackRef) {
        const directFound = findLawByName(definedName, cache);
        if (directFound) return directFound;
      }
    }
  }

  // ── Strategy 1: Name-based search using current law name ──
  if (!currentLawName) return null;

  // Extract the core topic from the current law name
  const coreTopicMatch = currentLawName.match(/^(?:نظام|لائحة|تنظيم|قانون|مرسوم|قرار)\s+(.+)/);
  const coreTopic = coreTopicMatch ? coreTopicMatch[1] : currentLawName;
  const shortTopic = coreTopic.split(/\s+/).slice(0, 3).join(' ');

  // Determine what type of document we're looking for based on keyword
  const searchTypes: string[] = [];
  if (keyword === 'اللائحة' || keyword === 'التنظيم') {
    searchTypes.push('لائحة', 'اللائحة التنفيذية', 'تنظيم');
  } else if (keyword === 'النظام' || keyword === 'القانون') {
    searchTypes.push('نظام', 'قانون');
  } else if (keyword === 'المرسوم') {
    searchTypes.push('مرسوم');
  } else if (keyword === 'القرار') {
    searchTypes.push('قرار');
  }

  // 1a. Search for "لائحة [core topic]" or "نظام [core topic]"
  for (const type of searchTypes) {
    const searchName = `${type} ${coreTopic}`;
    const found = cache.find(c => c.title_ar.includes(searchName));
    if (found) return found;
  }

  // 1b. Search for "اللائحة التنفيذية لنظام [core topic]"
  if (keyword === 'اللائحة' || keyword === 'التنظيم') {
    const execRegSearch = cache.find(c =>
      c.title_ar.includes('اللائحة التنفيذية') && c.title_ar.includes(shortTopic)
    );
    if (execRegSearch) return execRegSearch;
  }

  // 1c. Fuzzy: any document containing the short topic with the right type prefix
  for (const type of searchTypes) {
    const found = cache.find(c =>
      c.title_ar.startsWith(type) && c.title_ar.includes(shortTopic) && shortTopic.length > 5
    );
    if (found) return found;
  }

  return null;
}

interface ExpandedArticlePanelProps {
  article: Article;
  articles: Article[];
  nestingLevel: number;
  maxNestingLevel: number;
  onClose: () => void;
  lawName?: string;
}

function ExpandedArticlePanel({ article, articles, nestingLevel, maxNestingLevel, onClose, lawName }: ExpandedArticlePanelProps) {
  return (
    <div 
      className="mt-2 mb-3 bg-slate-50 dark:bg-slate-900/50 border-r-4 border-primary/40 rounded-md p-4 shadow-sm animate-in slide-in-from-top-2 duration-300 ring-1 ring-slate-200 dark:ring-slate-800"
      style={{ direction: 'rtl' }}
    >
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="font-bold text-primary text-base">
            {toHindiNumerals(
              article.number_text
                ? (article.number_text.startsWith("المادة")
                    ? article.number_text
                    : "المادة " + article.number_text)
                : "المادة رقم (" + article.number + ")"
            )}
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
            {(() => {
              const isArabicOrdinalMarker = (m: string) =>
                /^(أولا|ثانيا|ثالثا|رابعا|خامسا|سادسا|سابعا|ثامنا|تاسعا|عاشرا|حادي|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع)/i.test(m.replace(/ً/g, ''));
              const isNumericMarker = (m: string) => /^\d/.test(m) || /^[٠-٩]/.test(m);
              const isLetterMarker = (m: string) => /^[أ-ي]/.test(m) && !isArabicOrdinalMarker(m);

              const ordinalTextRegex = /^(أولا[ًً]?|ثانيا[ًً]?|ثالثا[ًً]?|رابعا[ًً]?|خامسا[ًً]?|سادسا[ًً]?|سابعا[ًً]?|ثامنا[ًً]?|تاسعا[ًً]?|عاشرا[ًً]?|حادي[ًً]?\s*عشر|ثاني[ًً]?\s*عشر|ثالث[ًً]?\s*عشر|رابع[ًً]?\s*عشر|خامس[ًً]?\s*عشر)\s*[:：]/;

              // Normalize & parse paragraphs into visual AST.
              // See: docs/extraction/boe_formatting_playbook.md (sections B, C, D)
              // Promote text-only ordinals to markers
              // and handle compound num+letter markers (e.g. "6 - أ : text")
              type NP = { marker: string; text: string; dataLevel: number };
              const normalizedParas: NP[] = [];

              for (const para of article.paragraphs!) {
                let m = (para.marker || "").trim();
                let t = (para.text || "").trim();
                const dataLevel = para.level || 0;
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
                let correctedLevel = dataLevel;
                if (!m && t) {
                  // Standalone letter: "أ : text" or "ب : text" → extract letter as marker
                  const letterOnly = t.match(/^([أ-ي])\s*[-–:]\s*/);
                  if (letterOnly && !isArabicOrdinalMarker(letterOnly[1])) {
                    m = letterOnly[1] + ' :';
                    t = t.slice(letterOnly[0].length).trim();
                  }
                  // Compound: "6 - أ : text" → parent "6-" (empty) + child "أ" with text
                  const compoundMatch = !m ? t.match(/^(\d{1,2}|[٠-٩]{1,2})\s*[-–]\s*([أ-ي])\s*[-–:]\s*/) : null;
                  if (compoundMatch) {
                    normalizedParas.push({ marker: compoundMatch[1] + '-', text: '', dataLevel: correctedLevel });
                    normalizedParas.push({ marker: compoundMatch[2] + ' :', text: t.slice(compoundMatch[0].length).trim(), dataLevel: correctedLevel + 1 });
                    continue;
                  }
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

              // Link standalone letter markers as children under last numeric parent
              let lastNumLevel = -1;
              for (let i = 0; i < normalizedParas.length; i++) {
                const np = normalizedParas[i];
                if (np.marker && isNumericMarker(np.marker)) {
                  lastNumLevel = np.dataLevel;
                } else if (np.marker && isLetterMarker(np.marker) && lastNumLevel >= 0 && np.dataLevel <= lastNumLevel) {
                  np.dataLevel = lastNumLevel + 1;
                }
              }

              // Merge split paragraphs that belong together:
              // No marker + previous has no marker + previous doesn't end with sentence-ending punctuation
              for (let i = normalizedParas.length - 1; i >= 1; i--) {
                const p = normalizedParas[i];
                const prev = normalizedParas[i - 1];
                if (!p.marker && p.text) {
                  const isSplitSentence = !prev.marker && prev.text && !/[.،؛:。]\s*$/.test(prev.text.trim());
                  if (isSplitSentence) {
                    prev.text = prev.text + ' ' + p.text;
                    normalizedParas.splice(i, 1);
                  }
                }
              }

              const markers = normalizedParas.map(p => p.marker).filter(Boolean);
              const hasOrdinals = markers.some(m => isArabicOrdinalMarker(m));
              const hasNumeric = markers.some(m => isNumericMarker(m));
              const hasMixedLevels = hasOrdinals && hasNumeric;

              type VP = { marker: string; text: string; dataLevel: number; visualLevel: number };
              const rawVps: VP[] = normalizedParas.map(np => {
                let vl = np.dataLevel;
                if (hasMixedLevels && np.marker) {
                  if (isArabicOrdinalMarker(np.marker)) vl = 0;
                  else if (isNumericMarker(np.marker)) vl = 1;
                  else if (isLetterMarker(np.marker)) vl = 2;
                }
                return { marker: np.marker, text: np.text, dataLevel: np.dataLevel, visualLevel: vl };
              });

              // Normalize levels: shift so the minimum marker level becomes 0
              const mkLevels = rawVps.filter(p => p.marker).map(p => p.visualLevel);
              const minLvl = mkLevels.length > 0 ? Math.min(...mkLevels) : 0;
              const vps = rawVps.map(p => ({
                ...p,
                visualLevel: p.marker ? p.visualLevel - minLvl : p.visualLevel
              }));

              return vps.map((vp, idx) => {
                if (vp.marker) {
                  return (
                    <NumberedItem key={idx} marker={vp.marker} level={vp.visualLevel}>
                      {nestingLevel < maxNestingLevel ? (
                        <ArticleReferenceText
                          text={vp.text}
                          articles={articles}
                          currentArticleNumber={article.number}
                          nestingLevel={nestingLevel + 1}
                          maxNestingLevel={maxNestingLevel}
                          lawName={lawName}
                        />
                      ) : (
                        <span>{toHindiNumerals(vp.text)}</span>
                      )}
                    </NumberedItem>
                  );
                }

                // If this paragraph is at dataLevel 0 (top-level), don't indent —
                // it's a new item, not a continuation of a sub-list.
                let prevMarkerLevel = -1;
                if (vp.dataLevel === 0) {
                  prevMarkerLevel = -1; // top-level: no indent
                } else if (idx > 0) {
                  for (let pi = idx - 1; pi >= 0; pi--) {
                    if (vps[pi].marker) { prevMarkerLevel = vps[pi].visualLevel; break; }
                  }
                }
                const contIndent = prevMarkerLevel >= 2 ? 88 : prevMarkerLevel >= 1 ? 58 : prevMarkerLevel === 0 ? 28 : 0;

                return (
                  <div key={idx} style={{ marginInlineStart: `${contIndent}px` }}>
                    {nestingLevel < maxNestingLevel ? (
                      <ArticleReferenceText
                        text={vp.text}
                        articles={articles}
                        currentArticleNumber={article.number}
                        nestingLevel={nestingLevel + 1}
                        maxNestingLevel={maxNestingLevel}
                        isDefinitionContext={vp.dataLevel === 0 && !vp.marker}
                        lawName={lawName}
                      />
                    ) : (
                      toHindiNumerals(vp.text)
                    )}
                  </div>
                );
              });
            })()}
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
                lawName={lawName}
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
  maxNestingLevel = 2,
  isDefinitionContext = false,
  lawName
}: ArticleReferenceTextProps) {
  // Track expanded articles by article number only (not segment index) to avoid duplicates
  const [expandedArticles, setExpandedArticles] = useState<Record<number, boolean>>({});

  // Library cache for external law lookups
  const [libCache, setLibCache] = useState<LibraryCacheEntry[]>(libraryCache || []);

  // Build a Set of valid article numbers from the actual articles in this law
  const validArticleNumbers = useMemo(() => new Set(articles.map(a => a.number)), [articles]);

  const segments = useMemo(() => parseArticleReferences(text, validArticleNumbers), [text, validArticleNumbers]);

  // Load library cache on first render if we have external references
  const hasExternalRefs = segments.some(s => s.type === 'external_reference');
  useEffect(() => {
    if (hasExternalRefs && !libraryCache) {
      loadLibraryCache().then(cache => setLibCache(cache));
    }
  }, [hasExternalRefs]);

  const toggleReference = useCallback((articleNumber: number) => {
    setExpandedArticles(prev => ({
      ...prev,
      [articleNumber]: !prev[articleNumber]
    }));
  }, []);

  const getArticle = useCallback((articleNumber: number) => {
    return articles.find(a => a.number === articleNumber);
  }, [articles]);

  const hasReferences = segments.some(s => s.type === 'reference' || s.type === 'external_reference');

  // Render the definition term (before colon) in green bold
  const renderDefinitionTerm = (term: string, separator: string) => (
    <>
      <span className="text-primary font-bold">{toHindiNumerals(term)}</span>
      <span>{separator}</span>
    </>
  );

  // Function to render text with line breaks
  const renderTextWithLineBreaks = (content: string) => {
    // If definition context, highlight the term before the first colon
    if (isDefinitionContext) {
      const def = splitDefinitionTerm(content);
      if (def) {
        return (
          <span>
            {renderDefinitionTerm(def.term, def.separator)}
            {toHindiNumerals(def.rest)}
          </span>
        );
      }
    }
    const parts = content.split(/\n+/);
    if (parts.length === 1) {
      return <span>{toHindiNumerals(content)}</span>;
    }
    return (
      <>
        {parts.map((part, i) => (
          <span key={i}>
            {toHindiNumerals(part)}
            {i < parts.length - 1 && <br />}
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
            // For the first text segment in a definition context, highlight the term
            if (isDefinitionContext && idx === 0) {
              const def = splitDefinitionTerm(segment.content);
              if (def) {
                return (
                  <span key={idx}>
                    {renderDefinitionTerm(def.term, def.separator)}
                    {toHindiNumerals(def.rest)}
                  </span>
                );
              }
            }
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
                    {i < parts.length - 1 && <br />}
                  </span>
                ))}
              </span>
            );
          }
          
          // External law reference — show as link to external law page
          if (segment.type === 'external_reference') {
            // Try to find the external law: named first, then unnamed (smart resolution)
            let externalLaw: LibraryCacheEntry | null = null;
            if (segment.externalLawName) {
              externalLaw = findLawByName(segment.externalLawName, libCache);
            } else if (segment.unnamedKeyword && lawName) {
              // Smart resolution: "من اللائحة" + current law "نظام X" → find "لائحة X"
              externalLaw = resolveUnnamedReference(segment.unnamedKeyword, lawName, libCache, articles);
            }

            if (externalLaw) {
              // Found the external law — create a link to it
              const articleParam = segment.articleNumber ? `#article-${segment.articleNumber}` : '';
              return (
                <a
                  key={idx}
                  href={`/law/${externalLaw.id}${articleParam}`}
                  className="text-blue-600 dark:text-blue-400 font-semibold underline decoration-blue-400/30 underline-offset-4 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all inline-flex items-center gap-1"
                  style={{ display: 'inline' }}
                  title={`الانتقال إلى ${externalLaw.title_ar}`}
                >
                  {toHindiNumerals(segment.content)}
                  <ExternalLink className="w-3 h-3 inline-block opacity-50" />
                </a>
              );
            }
            // External law not found in library — show as plain text (no wrong link)
            return <span key={idx}>{toHindiNumerals(segment.content)}</span>;
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
                  lawName={lawName}
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
