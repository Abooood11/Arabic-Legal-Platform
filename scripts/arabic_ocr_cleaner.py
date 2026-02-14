"""
Arabic OCR Text Cleaner — Generic, reusable module for cleaning Arabic OCR output.

This module is NOT specific to any single source (BOG, MOJ, etc.).
It reads correction rules from ocr_corrections.json and applies them
to any Arabic OCR text.

The corrections file grows over time as new OCR errors are discovered
(iterative/cumulative learning approach).

Includes an optional LLM-based header normalization step that uses
Mistral to identify corrupted section headers that the regex dictionary
cannot catch, and auto-learns new corrections into ocr_corrections.json.

Usage as a module:
    from arabic_ocr_cleaner import ArabicOCRCleaner
    cleaner = ArabicOCRCleaner(source_id="bog_judicial")
    cleaned_text = cleaner.clean(raw_text)

    # With LLM header normalization (requires mistralai):
    cleaned_text = cleaner.clean(raw_text, use_llm=True)

Usage standalone (for testing):
    python scripts/arabic_ocr_cleaner.py --input file.txt --source bog_judicial
    python scripts/arabic_ocr_cleaner.py --input file.txt --source bog_judicial --llm
"""
import sys, os
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import re
import json
from pathlib import Path
from typing import Optional, List, Dict, Tuple


# Arabic diacritical marks (tashkeel) regex
ARABIC_DIACRITICS_RE = re.compile(
    r'[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED]'
)

# Default corrections file path (next to this script)
DEFAULT_CORRECTIONS_FILE = Path(__file__).parent / "ocr_corrections.json"


class ArabicOCRCleaner:
    """
    Generic Arabic OCR text cleaner with configurable correction rules.

    Loads rules from ocr_corrections.json and applies them in a multi-pass pipeline.
    The source_id parameter selects source-specific patterns (e.g., "bog_judicial")
    while also applying all default/generic patterns.
    """

    def __init__(self, corrections_file: Optional[Path] = None, source_id: str = "_default"):
        """
        Initialize the cleaner.

        Args:
            corrections_file: Path to ocr_corrections.json. Uses default if None.
            source_id: Source identifier for source-specific patterns (e.g., "bog_judicial").
                       Falls back to "_default" patterns if source not found.
        """
        self.corrections_file = corrections_file or DEFAULT_CORRECTIONS_FILE
        self.source_id = source_id
        self._llm_cache = {}
        self._load_corrections()

    def _load_corrections(self):
        """Load correction rules from JSON file."""
        if not self.corrections_file.exists():
            print(f"  WARNING: Corrections file not found: {self.corrections_file}")
            self.word_corrections = {}
            self.section_corrections = {}
            self.page_header_patterns = []
            self.page_number_patterns = []
            self.noise_patterns = []
            self.footer_patterns = []
            return

        with open(self.corrections_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Word corrections (filter out _comment keys)
        self.word_corrections = {
            k: v for k, v in data.get("word_corrections", {}).items()
            if not k.startswith("_")
        }

        # Section header corrections
        self.section_corrections = {
            k: v for k, v in data.get("section_header_corrections", {}).items()
            if not k.startswith("_")
        }

        # Page header patterns — use source-specific if available, otherwise default
        header_patterns_data = data.get("page_header_patterns", {})
        if self.source_id in header_patterns_data:
            self.page_header_patterns = header_patterns_data[self.source_id]
        elif "_default" in header_patterns_data:
            self.page_header_patterns = header_patterns_data["_default"]
        else:
            self.page_header_patterns = []

        # Page number patterns
        self.page_number_patterns = data.get("page_number_patterns", {}).get("patterns", [])

        # Noise patterns
        self.noise_patterns = data.get("noise_patterns", {}).get("patterns", [])

        # Footer markers
        self.footer_patterns = data.get("footer_markers", {}).get("patterns", [])

        print(f"  OCR cleaner loaded: {len(self.word_corrections)} word corrections, "
              f"{len(self.section_corrections)} section corrections, "
              f"{len(self.page_header_patterns)} header patterns (source: {self.source_id})")

    def reload(self):
        """Reload corrections from file (useful after editing the JSON)."""
        self._load_corrections()

    # ─── Individual cleaning passes ──────────────────────

    def remove_image_refs(self, text: str) -> str:
        """Remove markdown image references from OCR output."""
        return re.sub(r'!\[.*?\]\(.*?\)', '', text)

    def remove_page_breaks(self, text: str) -> str:
        """Remove page break markers inserted during OCR."""
        return re.sub(r'\n*---PAGE_BREAK---\n*', '\n', text)

    def remove_page_headers(self, text: str) -> str:
        """Remove page headers using patterns from corrections file."""
        for pattern in self.page_header_patterns:
            try:
                text = re.sub(pattern, '', text, flags=re.MULTILINE)
            except re.error as e:
                print(f"  WARNING: Invalid header pattern '{pattern}': {e}")
        return text

    def remove_page_numbers(self, text: str) -> str:
        """Remove standalone page numbers."""
        for pattern in self.page_number_patterns:
            try:
                text = re.sub(pattern, '', text, flags=re.MULTILINE)
            except re.error as e:
                print(f"  WARNING: Invalid page number pattern '{pattern}': {e}")
        return text

    def remove_noise(self, text: str) -> str:
        """Remove noise patterns (CJK artifacts, table lines, etc.)."""
        for pattern in self.noise_patterns:
            try:
                # Determine if pattern needs MULTILINE flag
                flags = re.MULTILINE if pattern.startswith('^') else 0
                text = re.sub(pattern, '', text, flags=flags)
            except re.error as e:
                print(f"  WARNING: Invalid noise pattern '{pattern}': {e}")
        return text

    def remove_footers(self, text: str) -> str:
        """Remove footer/index markers."""
        for pattern in self.footer_patterns:
            try:
                text = re.sub(pattern, '', text, flags=re.MULTILINE)
            except re.error as e:
                print(f"  WARNING: Invalid footer pattern '{pattern}': {e}")
        return text

    # Real Arabic words that happen to be OCR corruptions of section headers.
    # These must ONLY be corrected in markdown header lines, never in body text.
    HEADER_ONLY_CORRECTIONS = {
        "الانتكاب", "الانتقادات", "الانتساب", "الانشباب", "الانتخاب",
        "الاستماع", "الائتمان", "الامتنان", "الأسبان", "الوقاية",
        "الاشتقاق", "الاستيثاق", "مختصة الاستئناف", "الاستباق",
        "الاستئناف",
        # V2-V4 new real-word corrections
        "الانتحار", "الانضباط", "الامتثال", "الاستبيان", "الانسياب",
        "الانتقائي", "الائتلاف", "الاشتباك",
        # Cycle 8: found via positional analysis in display
        "المشتبك", "الاكتفاء", "المستبش", "المسيات", "الانشآء",
        "الانسان", "الانشأت", "الأستياف", "الأنشباق",
    }

    def normalize_section_headers(self, text: str) -> str:
        """
        Fix OCR-corrupted section headers using corrections dictionary.

        Uses two strategies:
        1. Direct replacement of known corrupted forms (safe ones in all text,
           real-word homographs only in markdown header lines)
        2. Diacritics-stripped matching: strip tashkeel from markdown header lines
           and match against corrections dictionary, then replace with clean form
        """
        # Strategy 1a: Safe replacements (non-real-words) — apply everywhere
        for corrupted, correct in self.section_corrections.items():
            if corrupted in self.HEADER_ONLY_CORRECTIONS:
                continue  # handled in 1b below
            # In markdown headers: ## corrupted → ## correct
            text = re.sub(
                rf'((?:^|\n)#+\s+){re.escape(corrupted)}',
                rf'\g<1>{correct}',
                text
            )
            # Plain text occurrences (safe because these aren't real words)
            text = text.replace(corrupted, correct)

        # Strategy 1b: Real-word corrections — ONLY in header-like lines
        # Match both markdown headers (## الاستباق) and standalone lines (الاستباق)
        # Standalone lines must be surrounded by blank lines (header-like structure)
        for corrupted, correct in self.section_corrections.items():
            if corrupted not in self.HEADER_ONLY_CORRECTIONS:
                continue
            # Markdown headers: ## corrupted
            text = re.sub(
                rf'(^#+\s+){re.escape(corrupted)}\s*$',
                rf'\g<1>{correct}',
                text,
                flags=re.MULTILINE
            )
            # Standalone line: blank line, then corrupted word alone, then blank line
            text = re.sub(
                rf'(\n\s*\n){re.escape(corrupted)}\s*(\n\s*\n)',
                rf'\1## {correct}\2',
                text
            )

        # Strategy 2: Diacritics-stripped matching for markdown headers
        # Many OCR corruptions are just the correct word with heavy diacritics
        # Build a lookup of stripped-form → correct-form
        stripped_lookup = {}
        for corrupted, correct in self.section_corrections.items():
            stripped = self.strip_diacritics(corrupted)
            stripped_lookup[stripped] = correct
        # Also add the correct forms themselves (in case they appear with diacritics)
        for correct_form in set(self.section_corrections.values()):
            stripped_lookup[self.strip_diacritics(correct_form)] = correct_form

        def _fix_header_line(match):
            prefix = match.group(1)  # "## " or "# " etc.
            header_text = match.group(2)
            stripped = self.strip_diacritics(header_text.strip())
            if stripped in stripped_lookup:
                return prefix + stripped_lookup[stripped]
            return match.group(0)

        text = re.sub(
            r'(^#+\s+)(.+)$',
            _fix_header_line,
            text,
            flags=re.MULTILINE
        )

        # Fuzzy pattern for محكمة الاستئناف variants (very common OCR corruption)
        text = re.sub(
            r'((?:^|\n)(?:#+\s+)?)'
            r'مُ?[حخ][َِّْ]*[كصحض][َِّْ]*[مَّ]*[ةه]?\s*'
            r'الاست[ئينغ][ئاي]*[نا]*[فقت](?:[فق])?',
            r'\1محكمة الاستئناف',
            text,
            flags=re.MULTILINE
        )

        # Fuzzy pattern for مستند الحكم variants
        text = re.sub(
            r'((?:^|\n)(?:#+\s+)?)'
            r'مُ?[سص][ْ]*[تط][َ]*[نن][ْ]*[دذ][ُ]?\s+'
            r'ال[حخ][ُ]*[كق][ْ]*[مم][َ]*',
            r'\1مستند الحكم',
            text,
            flags=re.MULTILINE
        )

        return text

    # ─── LLM-based header normalization ─────────────────────

    # Known legal section headers (the correct forms)
    KNOWN_SECTION_HEADERS = {
        "الأسباب", "الوقائع", "مستند الحكم", "محكمة الاستئناف",
        "الموضوعات", "المنطوق",
    }

    def find_suspicious_headers(self, text: str) -> List[Tuple[str, int, int]]:
        """
        Find standalone lines that look like section headers but don't match
        any known header. These are candidates for LLM identification.

        Returns list of (line_text, start_pos, end_pos).
        """
        suspicious = []
        # Pattern: a short line (1-30 chars) surrounded by blank lines
        for m in re.finditer(r'(?:\n\s*\n|\A)(\s*)(\S[^\n]{0,30}?)\s*(?:\n\s*\n|\Z)', text):
            line = m.group(2).strip()
            # Skip markdown headers already handled
            if line.startswith('#'):
                continue
            # Skip lines that are too long or too short
            if len(line) < 3 or len(line) > 25:
                continue
            # Skip known headers
            stripped = self.strip_diacritics(line)
            if stripped in self.KNOWN_SECTION_HEADERS:
                continue
            # Skip lines that are numbers or dates
            if re.match(r'^[\d٠-٩/\-\s]+$', line):
                continue
            # Skip lines that look like names or regular text
            if ' ' in line and len(line.split()) > 3:
                continue
            suspicious.append((line, m.start(2), m.end(2)))
        return suspicious

    def llm_identify_headers(self, suspicious_lines: List[str]) -> Dict[str, str]:
        """
        Use an LLM (Gemini or Mistral) to identify corrupted section headers.

        Tries Gemini first (faster, free with API key), falls back to Mistral.

        Args:
            suspicious_lines: List of text strings to classify

        Returns:
            Dict mapping corrupted text → correct header name, only for identified matches.
        """
        if not suspicious_lines:
            return {}

        # Deduplicate
        unique_lines = list(set(suspicious_lines))
        if not unique_lines:
            return {}

        # Build compact prompt
        lines_text = "\n".join(f"{i+1}. {line}" for i, line in enumerate(unique_lines))

        prompt = f"""أنت مصحح أخطاء OCR متخصص في النصوص القانونية العربية. مهمتك محددة جداً:

هذه أسطر قصيرة مستخرجة من أحكام قضائية عبر OCR. بعضها قد يكون عناوين أقسام مشوهة بسبب أخطاء OCR.

العناوين الصحيحة الوحيدة هي:
- الأسباب
- الوقائع
- مستند الحكم
- محكمة الاستئناف

قواعد صارمة:
1. إذا كان السطر كلمة عربية حقيقية مفهومة (مثل: دعوى، خدمة، تقاعد، تعليم، اختصاص، جامعات، تعويض، عقد) فهو ليس تشوه OCR → أجب null
2. إذا كان السطر اختصاراً أو رمزاً أو عنوان تصنيف → أجب null
3. فقط إذا كان السطر يبدو كتشوه حرفي واضح لأحد العناوين الأربعة أعلاه → حدد التصحيح
4. إذا لم تكن متأكداً 100% → أجب null. الحذر أولى.

أجب بتنسيق JSON فقط: {{"results": [{{"line": "النص", "correction": "العنوان الصحيح أو null"}}]}}

الأسطر:
{lines_text}"""

        # Try Gemini first
        result_text = self._call_gemini(prompt)
        if result_text is None:
            # Fallback to Mistral
            result_text = self._call_mistral(prompt)
        if result_text is None:
            return {}

        return self._parse_llm_response(result_text)

    def _call_gemini(self, prompt: str) -> Optional[str]:
        """Call Google Gemini API. Returns response text or None."""
        api_key = os.environ.get("GOOGLE_API_KEY", "AIzaSyD0oxxaBai0UIgE0VwVnbTJhNnPqhR7CQ4")
        try:
            from google import genai
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "temperature": 0,
                },
            )
            return response.text
        except ImportError:
            return None
        except Exception as e:
            print(f"  Gemini failed: {e}, trying Mistral...")
            return None

    def _call_mistral(self, prompt: str) -> Optional[str]:
        """Call Mistral API. Returns response text or None."""
        try:
            from mistralai import Mistral
            client = Mistral(api_key=os.environ.get("MISTRAL_API_KEY", "4lckVFweCTCsg7GV60nQTh8mOqSvR2pw"))
            response = client.chat.complete(
                model="mistral-small-latest",
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                response_format={"type": "json_object"},
            )
            return response.choices[0].message.content
        except ImportError:
            print("  WARNING: Neither google-generativeai nor mistralai installed")
            return None
        except Exception as e:
            print(f"  WARNING: Mistral also failed: {e}")
            return None

    def _parse_llm_response(self, result_text: str) -> Dict[str, str]:
        """Parse LLM JSON response into corrections dict."""
        try:
            result = json.loads(result_text)
            corrections = {}
            items = result.get("results", result.get("نتائج", []))
            for item in items:
                original = item.get("line", item.get("سطر", ""))
                correction = item.get("correction", item.get("تصحيح"))
                if correction and correction != "null" and str(correction) != "None" \
                        and correction in self.KNOWN_SECTION_HEADERS:
                    corrections[original] = correction

            if corrections:
                print(f"  LLM identified {len(corrections)} new header corrections:")
                for orig, corr in corrections.items():
                    print(f"    '{orig}' → '{corr}'")

            return corrections
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"  WARNING: Failed to parse LLM response: {e}")
            return {}

    def auto_learn_corrections(self, new_corrections: Dict[str, str]):
        """
        Add newly discovered corrections to ocr_corrections.json for future use.
        This implements the cumulative learning approach.
        """
        if not new_corrections or not self.corrections_file.exists():
            return

        try:
            with open(self.corrections_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            section_corrections = data.get("section_header_corrections", {})
            added = 0
            for corrupted, correct in new_corrections.items():
                if corrupted not in section_corrections:
                    section_corrections[corrupted] = correct
                    added += 1

            if added > 0:
                data["section_header_corrections"] = section_corrections
                # Update meta
                meta = data.get("_meta", {})
                meta["last_updated"] = __import__("datetime").date.today().isoformat()
                data["_meta"] = meta

                with open(self.corrections_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)

                # Reload corrections into memory
                self._load_corrections()
                print(f"  Auto-learned {added} new corrections into {self.corrections_file.name}")

        except Exception as e:
            print(f"  WARNING: Failed to auto-learn corrections: {e}")

    def normalize_headers_with_llm(self, text: str) -> str:
        """
        Use LLM to identify and fix remaining corrupted section headers
        that the regex dictionary could not catch.

        Also auto-learns new corrections for future use.
        """
        suspicious = self.find_suspicious_headers(text)
        if not suspicious:
            return text

        # Check if we already have cached corrections for these lines
        suspicious_texts = [s[0] for s in suspicious]
        uncached = [t for t in suspicious_texts if t not in self._llm_cache]

        if uncached:
            corrections = self.llm_identify_headers(uncached)
            # Cache all results (including non-matches as None)
            for line in uncached:
                self._llm_cache[line] = corrections.get(line)
            # Auto-learn for future
            if corrections:
                self.auto_learn_corrections(corrections)

        # Apply corrections from cache
        applied = False
        for line_text, start, end in reversed(suspicious):
            correct = self._llm_cache.get(line_text)
            if correct and correct in self.KNOWN_SECTION_HEADERS:
                text = text[:start] + f"## {correct}" + text[end:]
                applied = True

        return text

    def batch_llm_scan(self, texts: List[str]):
        """
        Pre-scan multiple texts to collect all suspicious headers,
        then make ONE LLM call for all of them. Much faster than per-text calls.

        Call this before processing individual texts with clean(use_llm=True).
        """
        all_suspicious = set()
        for text in texts:
            # Quick pre-clean to find headers (don't call full pipeline)
            cleaned = self.remove_image_refs(text)
            cleaned = self.remove_page_breaks(cleaned)
            cleaned = self.remove_page_headers(cleaned)
            cleaned = self.remove_page_numbers(cleaned)
            cleaned = self.remove_noise(cleaned)
            cleaned = self.normalize_section_headers(cleaned)
            cleaned = self.apply_word_corrections(cleaned)

            for line, _, _ in self.find_suspicious_headers(cleaned):
                all_suspicious.add(line)

        if not all_suspicious:
            print("  LLM scan: no suspicious headers found")
            return

        # Filter out already-known corrections
        unknown = [s for s in all_suspicious if s not in self.section_corrections]
        if not unknown:
            print("  LLM scan: all suspicious headers already in dictionary")
            return

        print(f"  LLM batch scan: {len(unknown)} unique suspicious headers")
        corrections = self.llm_identify_headers(unknown)

        # Cache everything
        for line in unknown:
            self._llm_cache[line] = corrections.get(line)

        # Auto-learn
        if corrections:
            self.auto_learn_corrections(corrections)

    def strip_all_diacritics(self, text: str) -> str:
        """Remove ALL Arabic diacritical marks from the entire text.
        This improves readability, searchability, and eliminates HEAVY_DIACRITICS issues."""
        return ARABIC_DIACRITICS_RE.sub('', text)

    def apply_word_corrections(self, text: str) -> str:
        """Apply word-level OCR corrections from dictionary."""
        for wrong, correct in self.word_corrections.items():
            text = text.replace(wrong, correct)
        return text

    def fix_ocr_dates(self, text: str) -> str:
        """Fix OCR date issues: ه→٥/5, هو→هـ.

        OCR frequently confuses the Arabic digit ٥ (five) with the letter ه (ha)
        because they look nearly identical. This only applies in date contexts
        where a Hijri year (13xx/14xx) is present, to avoid false positives.
        Also fixes هو (misread of هـ, the Hijri calendar suffix).
        """
        t = text
        # Fix ه→٥ in Arabic-Indic digit dates
        t = re.sub(r'ه/ه(/[١][٣٤][٠-٩]{2})', r'٥/٥\1', t)
        t = re.sub(r'ه(/[٠-٩]{1,2}/[١][٣٤][٠-٩]{2})', r'٥\1', t)
        t = re.sub(r'([٠-٩]{1,2}/)ه(/[١][٣٤][٠-٩]{2})', r'\g<1>٥\2', t)
        t = re.sub(r'([١][٣٤][٠-٩]{2}/[٠-٩]{1,2}/)ه(?=[^٠-٩\d]|$)', r'\g<1>٥', t)
        t = re.sub(r'([١][٣٤][٠-٩]{2}/)ه(/[٠-٩]{1,2})', r'\g<1>٥\2', t)
        # Fix ه→5 in Western digit dates
        t = re.sub(r'ه/ه(/1[34]\d{2})', r'5/5\1', t)
        t = re.sub(r'ه(/\d{1,2}/1[34]\d{2})', r'5\1', t)
        t = re.sub(r'(\d{1,2}/)ه(/1[34]\d{2})', r'\g<1>5\2', t)
        t = re.sub(r'(1[34]\d{2}/\d{1,2}/)ه(?=[^\d٠-٩]|$)', r'\g<1>5', t)
        t = re.sub(r'(1[34]\d{2}/)ه(/\d{1,2})', r'\g<1>5\2', t)
        # Fix هو→هـ after dates
        t = re.sub(r'([\d٠-٩]+[/\-.][\d٠-٩]+[/\-.][\d٠-٩]+)\s*هو(?=[^٠-٩\w]|$)', r'\1هـ', t)
        return t

    def collapse_blank_lines(self, text: str) -> str:
        """Collapse 3+ consecutive blank lines into 2."""
        return re.sub(r'\n{3,}', '\n\n', text)

    # ─── Main cleaning pipeline ──────────────────────────

    def clean(self, text: str, use_llm: bool = False) -> str:
        """
        Run the full cleaning pipeline on OCR text.

        The pipeline order matters — each pass builds on the previous one:
        1. Remove structural artifacts (images, page breaks)
        2. Remove page-level noise (headers, numbers)
        3. Remove general noise (CJK, tables)
        4. Normalize content (section headers, word corrections)
        5. LLM header normalization (optional — catches what regex missed)
        6. Final cleanup (footers, blank lines)

        Args:
            text: The OCR text to clean
            use_llm: If True, use Mistral LLM to identify remaining corrupted
                     headers after regex passes. Auto-learns new corrections.
        """
        text = self.remove_image_refs(text)
        text = self.remove_page_breaks(text)
        text = self.remove_page_headers(text)
        text = self.remove_page_numbers(text)
        text = self.remove_noise(text)
        text = self.normalize_section_headers(text)
        text = self.strip_all_diacritics(text)
        text = self.apply_word_corrections(text)
        text = self.fix_ocr_dates(text)
        if use_llm:
            text = self.normalize_headers_with_llm(text)
        text = self.remove_footers(text)
        text = self.collapse_blank_lines(text)
        return text.strip()

    # ─── Utility ─────────────────────────────────────────

    @staticmethod
    def strip_diacritics(text: str) -> str:
        """Remove Arabic diacritical marks (tashkeel) for matching purposes."""
        return ARABIC_DIACRITICS_RE.sub('', text)

    def get_stats(self, original: str, cleaned: str) -> dict:
        """Return cleaning statistics for a single text."""
        return {
            "original_chars": len(original),
            "cleaned_chars": len(cleaned),
            "chars_removed": len(original) - len(cleaned),
            "removal_pct": round((1 - len(cleaned) / max(len(original), 1)) * 100, 1),
        }


# ─── Standalone usage ────────────────────────────────────
def main():
    import argparse

    parser = argparse.ArgumentParser(description="Clean Arabic OCR text using correction rules")
    parser.add_argument("--input", type=str, required=True, help="Input OCR text file")
    parser.add_argument("--output", type=str, help="Output cleaned text file (default: input_cleaned.txt)")
    parser.add_argument("--source", type=str, default="_default",
                        help="Source ID for source-specific patterns (e.g., bog_judicial)")
    parser.add_argument("--corrections", type=str, help="Path to ocr_corrections.json")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"ERROR: File not found: {input_path}")
        sys.exit(1)

    output_path = Path(args.output) if args.output else input_path.with_name(
        input_path.stem + "_cleaned" + input_path.suffix
    )
    corrections_path = Path(args.corrections) if args.corrections else None

    print(f"Arabic OCR Cleaner")
    print(f"  Input: {input_path}")
    print(f"  Source: {args.source}")

    cleaner = ArabicOCRCleaner(corrections_file=corrections_path, source_id=args.source)

    with open(input_path, 'r', encoding='utf-8') as f:
        original_text = f.read()

    cleaned_text = cleaner.clean(original_text)
    stats = cleaner.get_stats(original_text, cleaned_text)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(cleaned_text)

    print(f"\n  Output: {output_path}")
    print(f"  Original: {stats['original_chars']:,} chars")
    print(f"  Cleaned:  {stats['cleaned_chars']:,} chars")
    print(f"  Removed:  {stats['chars_removed']:,} chars ({stats['removal_pct']}%)")


if __name__ == "__main__":
    main()
