"""
BOG Judgment Splitter — splits Mistral OCR output into individual judgments.

Reads the OCR text file produced by bog_test_mistral_ocr.py and splits it into
individual judgments based on court-specific header patterns.

Uses the generic ArabicOCRCleaner (arabic_ocr_cleaner.py + ocr_corrections.json)
for text cleaning, so OCR corrections learned here benefit all future sources.

Usage:
    python scripts/bog_split_judgments.py [--input FILE] [--output-dir DIR] [--year YEAR] [--volume VOL]
"""
import sys, os
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import re
import json
import argparse
from pathlib import Path

# Import the generic Arabic OCR cleaner
sys.path.insert(0, str(Path(__file__).parent))
from arabic_ocr_cleaner import ArabicOCRCleaner

# Arabic-Hindi numeral mapping
ARABIC_HINDI_MAP = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# Initialize the generic cleaner with BOG-specific source ID
_cleaner = ArabicOCRCleaner(source_id="bog_judicial")


def fix_ocr_date(text: str) -> str:
    """Fix OCR date issues before conversion to Western digits.

    Handles:
    - ه→٥/5: OCR confuses the digit 5 with the letter ه (visually identical)
    - هو→هـ: OCR misreads the Hijri suffix هـ as هو
    - /→-: Slash to hyphen for Arabic-Indic dates (BiDi safe)
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


def to_western(text: str) -> str:
    """Convert Arabic-Indic numerals (٠-٩) to Western (0-9), after fixing OCR date issues."""
    fixed = fix_ocr_date(text)
    return fixed.translate(ARABIC_HINDI_MAP)


def extract_western_number(text: str) -> str:
    """Extract a number from text, converting Arabic-Indic digits."""
    western = to_western(text)
    nums = re.findall(r'\d+', western)
    return nums[0] if nums else ""


# ─── Judgment type configurations ────────────────────────
JUDGMENT_TYPE_PATTERNS = {
    'administrative': {
        'court_name': 'المحكمة الإدارية',
        'appeal_court': 'محكمة الاستئناف الإدارية',
        'header_pattern': r'رقم القضية في المحكمة الإدارية\s*[-–]?\s*(.+?)\s+لعام\s+(.+?)هـ',
        'collection_keywords': ['الإدارية', 'الادارية', 'إدارية', 'ادارية'],
    },
    'commercial': {
        'court_name': 'المحكمة التجارية',
        'appeal_court': 'محكمة الاستئناف التجارية',
        'header_pattern': r'رقم القضية في المحكمة التجارية\s*[-–]?\s*(.+?)\s+لعام\s+(.+?)هـ',
        'collection_keywords': ['التجارية', 'تجارية'],
    },
    'criminal': {
        'court_name': 'المحكمة الجزائية',
        'appeal_court': 'محكمة الاستئناف الجزائية',
        'header_pattern': r'رقم القضية في المحكمة الجزائية\s*[-–]?\s*(.+?)\s+لعام\s+(.+?)هـ',
        'collection_keywords': ['الجزائية', 'جزائية'],
    },
    'supreme_administrative': {
        'court_name': 'المحكمة الإدارية العليا',
        'appeal_court': 'المحكمة الإدارية العليا',
        'header_pattern': r'رقم القضية في المحكمة الإدارية العليا\s*[-–]?\s*(.+?)\s+لعام\s+(.+?)هـ',
        'collection_keywords': ['الإدارية العليا', 'الادارية العليا'],
    },
}

# Older format (pre-1440): two variants
# Variant A (1427-1428): "رقم القضية ٤١٦/٥/ق لعام ١٤٢٦هـ\nرقم الحكم الابتدائي"
# Variant B (1429-1432): "رقم القضية: ١٠٠٥/٧/ق لعام ١٤٢٩هـ\nرقم الحكم الابتدائي"
# Note: OCR may produce "الحتم"/"الحاكم" instead of "الحكم"
# and "الايبتدائي"/"الإيتدائي"/"الائتدافي" instead of "الابتدائي"
LEGACY_HEADER_PATTERN = re.compile(
    r'^رقم القضية[:/]?\s*(.+?)\s+(?:لعام|ق\.?\s*ل[ـعم]*)\s+(.+?)هـ\s*\n'
    r'رقم ال\S+\s+ال[اإ]\S*[يئ]',
    re.MULTILINE
)

# Oldest format (commercial 1408-1427, criminal 1402-1427):
# "القَضْيَة رقم: ٢/١١٥/ق لعام ١٤٢٤هـ\nالحَكَم الابتدائي رقم:"
# OCR variants: القضيّة, القضية, القَضْيَة, القضيب (OCR error)
OLDEST_HEADER_PATTERN = re.compile(
    r'^ال\S*قض\S*\s+رقم:?\s*(.+?)\s+(?:لعام|ق\.?\s*ل[ـعم]*)\s+(.+?)هـ\s*\n'
    r'ال\S+\s+ال[اإ]\S*[يئ]',
    re.MULTILINE
)

# Supreme Administrative Court format A (main content):
# 1442/1443: "رقم الحكم في المجموعة ١\nرقم القضية في محكمة الاستئناف الإدارية ١٣٢٧٦/ق لعام ١٤٤٠هـ"
# 1444: "رقم الحكم في المجموعة 1\nرقم الاستئناف ١٥٣٩ لعام ١٤٤١هـ"
SUPREME_RULING_PATTERN = re.compile(
    r'^رقم الحكم في المجموعة\s+([٠-٩\d]+)\s*\n'
    r'(?:رقم القضية في محكمة الاستئناف الإدارية|رقم الاستئناف)\s+(.+?)\s+لعام\s+(.+?)هـ',
    re.MULTILINE
)

# Supreme Administrative Court format B (General Assembly decisions):
# "قرار الهيئة العامة للمحكمة الإدارية العليا\nرقم القرار 1 لعام ١٤٤٢هـ"
SUPREME_GENERAL_ASSEMBLY_PATTERN = re.compile(
    r'^(?:#+\s+)?قرار الهيئة العامة للمحكمة الإدارية العليا\s*\n'
    r'(?:#+\s+)?رقم القرار\s+([٠-٩\d]+)\s+لعام\s+([٠-٩\d]{4})هـ',
    re.MULTILINE
)

# Pre-1402 format A: criminal decisions (رشوة/تزوير)
# "قرار ه/٢/١ لعام ١٤٠٢هـ\nفي القضية رقم ٦٥٤/١/ق لعام ١٤٠١هـ"
# Also: "قرار رقم ١٧/٨٥/١٣٩٩هـ\nالقضية رقم ١٧٠/١/ق لعام ١٣٩٩هـ"
PRE1402_DECISION_PATTERN = re.compile(
    r'^(?:#+\s+)?قرار\s+(?:ه[ /]|رقم\s+)(.+?)(?:لعام\s+)?(\d{4}|[\d٠-٩]{4})هـ\s*\n'
    r'(?:#+\s+)?(?:في\s+)?(?:ال)?قضية\s+رقم',
    re.MULTILINE
)

# Pre-1402 format B: disciplinary board rulings (أحكام هيئة التأديب)
# "(١)\n\nجلسة ٢٣-١-١٣٩٥هـ"
# OCR variants: جامعة (for جلسة), جلسته
DISCIPLINE_HEADER_PATTERN = re.compile(
    r'^\(([٠-٩\d]+)\)\s*\n\s*(?:جلسة|جامعة|جلسته)\s+(.+?)$',
    re.MULTILINE
)


def detect_judgment_type(ocr_text: str) -> str:
    """Auto-detect judgment type from OCR text content."""
    sample = ocr_text[:5000]
    for jtype, config in JUDGMENT_TYPE_PATTERNS.items():
        if config['court_name'] in sample:
            return jtype
    # Fallback: check collection header keywords
    for jtype, config in JUDGMENT_TYPE_PATTERNS.items():
        for kw in config['collection_keywords']:
            if kw in sample:
                return jtype
    return 'administrative'


# ─── PDF Book Artifact Removal ─────────────────────────
# Whitelist of standalone short lines that ARE valid judgment content.
# Everything else that's a standalone short line between blank lines = PDF book artifact.
_VALID_STANDALONE_RE = re.compile(
    r'^(?:الوقائع|الأسباب|\( الأسباب \)|\(الأسباب\)|المنطوق|خاتمة'
    r'|بسم الله الرحمن الرحيم|الحمد لله|وصلى الله|والله الموفق|وبالله التوفيق|الموفق'
    r'|لذلك حكم|فلهذه الأسباب|حكمت ال|قررت ال|قضاء[،.]'
    r'|بالأسباب|لما هو م|هو موضح|مبين بالأسباب|موضح بالأسباب'
    r'|ورفض ما عدا|وصحبه أجمعين|هيئة الت|أدلة الاتهام)'
)
_ASBAB_CONTENT_START_RE = re.compile(r'^(?:لما كان|من حيث|وحيث إن|ولما كان|وبعد الاطلاع)')
_WAQAEI_CONTENT_START_RE = re.compile(r'^(?:تتلخص|تخلص|تتحصل|حيث إن الوقائع|تتمثل وقائع|وقائع ال)')


def strip_pdf_book_artifacts(text: str) -> str:
    """
    Strip PDF book structural artifacts from BOG judgment text.

    Root solution: any short standalone line (surrounded by blank lines) that is NOT
    valid judgment content gets removed. This catches ALL OCR corruptions of page
    headers (الأنتيك, الموصوفات, مجمع علم الكلام, etc.) without needing to enumerate
    each specific corrupted word.

    Special handling: if artifact appears before الأسباب/الوقائع content, replace
    with the correct section header instead of removing.
    """
    lines = text.split('\n')
    result = []
    for i, line in enumerate(lines):
        t = line.strip()
        prev = lines[i - 1].strip() if i > 0 else ''
        nxt = lines[i + 1].strip() if i < len(lines) - 1 else ''

        if 2 <= len(t) < 60 and prev == '' and nxt == '':
            # Strip markdown formatting for matching
            clean = re.sub(r'^#{1,3}\s*', '', t)
            clean = clean.replace('**', '').strip()
            if _VALID_STANDALONE_RE.match(clean):
                result.append(line)
            else:
                # Check if this is a corrupted section header
                next_content = ''
                for j in range(i + 1, min(i + 5, len(lines))):
                    if len(lines[j].strip()) > 10:
                        next_content = lines[j].strip()
                        break
                if _ASBAB_CONTENT_START_RE.match(next_content):
                    result.append('الأسباب')
                elif _WAQAEI_CONTENT_START_RE.match(next_content):
                    result.append('الوقائع')
                else:
                    result.append('')  # remove artifact
        else:
            result.append(line)
    return '\n'.join(result)


# ─── Text cleaning (delegates to generic ArabicOCRCleaner) ─────
def clean_text(text: str, use_llm: bool = False) -> str:
    """
    Clean judgment text using the generic ArabicOCRCleaner.

    All OCR corrections are loaded from ocr_corrections.json so they
    benefit ALL future extraction sources, not just BOG.

    Structural artifact removal strips all PDF book page headers/footers
    using whitelist approach (no word-matching needed).

    Args:
        use_llm: If True, use Mistral LLM to identify remaining corrupted
                 section headers. Only identifies headers — never modifies body text.
    """
    # Use the generic cleaner for all standard passes
    text = _cleaner.clean(text, use_llm=use_llm)

    # Structural artifact removal: remove ALL standalone short lines between blank lines
    # that are NOT valid judgment content. This replaces the old word-matching approach.
    text = strip_pdf_book_artifacts(text)

    # Remove leaked next-judgment content: after appeal confirmation,
    # if a judgment metadata block appears (2+ "رقم ال..." lines), truncate.
    text = re.sub(
        r'(حكمت (?:المحكمة|الهيئة) بتأييد الحكم فيما انتهى إليه من قضاء[.،]?)[\s\S]*?'
        r'((?:^|\n)رقم ال\S+\s+.+\n\s*رقم ال\S+\s+[\s\S]*)$',
        r'\1', text
    )

    return text.strip()


# ─── Splitting logic ─────────────────────────────────────
def split_judgments(ocr_text: str, collection_year: str = "1442",
                    volume_num: str = "1", judgment_type: str = None,
                    use_llm: bool = False):
    """
    Split OCR text into individual judgments.

    Args:
        ocr_text: Full OCR text from a volume PDF
        collection_year: Hijri year of the collection
        volume_num: Volume number within the collection
        judgment_type: 'administrative', 'commercial', or 'criminal' (auto-detected if None)

    Returns list of dicts with keys:
        case_id, case_number, case_year, appeal_number, appeal_year, session_date,
        topics, category, text, source, char_count, judgment_type
    """
    # Auto-detect judgment type if not specified
    if judgment_type is None:
        judgment_type = detect_judgment_type(ocr_text)
    print(f"  Judgment type: {judgment_type}")

    config = JUDGMENT_TYPE_PATTERNS.get(judgment_type, JUDGMENT_TYPE_PATTERNS['administrative'])

    # Main pattern: judgment header
    header_pattern = re.compile(
        r'^' + config['header_pattern'],
        re.MULTILINE
    )

    # Find all judgment start positions
    matches = list(header_pattern.finditer(ocr_text))

    legacy_mode = False
    oldest_mode = False
    pre1402_decision_mode = False
    discipline_mode = False
    supreme_ruling_mode = False
    supreme_assembly_mode = False
    if not matches:
        print("  No modern-format headers found. Trying supreme court formats...")
        # Try Supreme Administrative Court main format first (most common in supreme collections)
        matches = list(SUPREME_RULING_PATTERN.finditer(ocr_text))
        if matches:
            print(f"  Found {len(matches)} headers using Supreme Court ruling format")
            supreme_ruling_mode = True
            # Also check for General Assembly decisions (they appear before the rulings)
            assembly_matches = list(SUPREME_GENERAL_ASSEMBLY_PATTERN.finditer(ocr_text))
            if assembly_matches:
                print(f"  Also found {len(assembly_matches)} General Assembly decisions")
                # Merge both lists and sort by position
                all_positions = []
                for m in matches:
                    all_positions.append(('ruling', m))
                for m in assembly_matches:
                    all_positions.append(('assembly', m))
                all_positions.sort(key=lambda x: x[1].start())
                matches = [p[1] for p in all_positions]
                # Store type info for each match
                supreme_match_types = [p[0] for p in all_positions]
            else:
                supreme_match_types = ['ruling'] * len(matches)
        else:
            # Try General Assembly only
            matches = list(SUPREME_GENERAL_ASSEMBLY_PATTERN.finditer(ocr_text))
            if matches:
                print(f"  Found {len(matches)} headers using Supreme General Assembly format")
                supreme_assembly_mode = True
                supreme_match_types = ['assembly'] * len(matches)
            else:
                print("  Trying legacy format (pre-1440)...")
                # Try legacy format: "رقم القضية ... لعام ...هـ\nرقم الحكم الابتدائي"
                matches = list(LEGACY_HEADER_PATTERN.finditer(ocr_text))
                if matches:
                    print(f"  Found {len(matches)} headers using legacy format")
                    legacy_mode = True
                else:
                    # Try oldest format: "القضية رقم: ... لعام ...هـ\nالحكم الابتدائي رقم:"
                    matches = list(OLDEST_HEADER_PATTERN.finditer(ocr_text))
                    if matches:
                        print(f"  Found {len(matches)} headers using oldest format")
                        oldest_mode = True
                        legacy_mode = True  # reuse legacy metadata extraction
                    else:
                        # Try pre-1402 decision format: "قرار ه/X/Y لعام ...هـ\nفي القضية رقم"
                        matches = list(PRE1402_DECISION_PATTERN.finditer(ocr_text))
                        if matches:
                            print(f"  Found {len(matches)} headers using pre-1402 decision format")
                            pre1402_decision_mode = True
                            legacy_mode = True
                        else:
                            # Try discipline board format: "(N)\nجلسة ..."
                            matches = list(DISCIPLINE_HEADER_PATTERN.finditer(ocr_text))
                            if matches:
                                print(f"  Found {len(matches)} headers using discipline board format")
                                discipline_mode = True
                            else:
                                # Try all types as fallback
                                for fallback_type, fallback_config in JUDGMENT_TYPE_PATTERNS.items():
                                    if fallback_type == judgment_type:
                                        continue
                                    fallback_pattern = re.compile(r'^' + fallback_config['header_pattern'], re.MULTILINE)
                                    matches = list(fallback_pattern.finditer(ocr_text))
                                    if matches:
                                        print(f"  Found headers using fallback type: {fallback_type}")
                                        judgment_type = fallback_type
                                        config = fallback_config
                                        break
                                if not matches:
                                    return []

    # Filter out index/table entries (they appear in table rows with | chars)
    real_matches = []
    for m in matches:
        # Check surrounding context — table rows have | characters
        start = max(0, m.start() - 5)
        context = ocr_text[start:m.start()]
        if '|' not in context:
            real_matches.append(m)

    print(f"  Found {len(real_matches)} judgment headers (filtered from {len(matches)} total matches)")

    # First pass: extract raw texts for all judgments
    raw_texts = []
    match_info = []  # (match, text_start, text_end)
    for idx, match in enumerate(real_matches):
        text_start = match.start()
        if idx + 1 < len(real_matches):
            text_end = real_matches[idx + 1].start()
        else:
            # Last judgment — find where the index/appendix starts
            index_markers = [
                r'# فهر[سش]',
                r'# قهقرش',  # OCR variant of فهرس
                r'# فاىشه',  # OCR variant of فهرس
                r'\|  م \| المجلد',
                r'\|  ص \| الموضوع',
            ]
            text_end = len(ocr_text)
            for marker in index_markers:
                idx_match = re.search(marker, ocr_text[match.start():])
                if idx_match:
                    candidate = match.start() + idx_match.start()
                    if candidate < text_end:
                        text_end = candidate

        raw_text = ocr_text[text_start:text_end]
        raw_texts.append(raw_text)
        match_info.append((match, text_start, text_end))

    # Batch LLM scan: one call for ALL judgments instead of per-judgment
    if use_llm and raw_texts:
        print(f"  Running batch LLM scan on {len(raw_texts)} judgments...")
        _cleaner.batch_llm_scan(raw_texts)

    # Second pass: extract metadata and clean each judgment
    judgments = []
    for idx, (match, text_start, text_end) in enumerate(match_info):
        raw_text = raw_texts[idx]

        # Extract metadata from the header block
        case_number = ""
        case_year = ""
        appeal_number = ""
        appeal_year = ""
        session_date = ""

        if supreme_ruling_mode or supreme_assembly_mode:
            # Supreme Administrative Court
            match_type = 'ruling'
            if supreme_ruling_mode and not supreme_assembly_mode:
                match_type = supreme_match_types[idx] if idx < len(supreme_match_types) else 'ruling'
            elif supreme_assembly_mode:
                match_type = 'assembly'

            if match_type == 'ruling':
                # Format: رقم الحكم في المجموعة N\nرقم القضية في محكمة الاستئناف الإدارية X لعام Yهـ
                collection_num = to_western(match.group(1).strip())
                case_number = to_western(match.group(2).strip())
                case_year = extract_western_number(match.group(3).strip())

                # Extract objection number: "رقم الاعتراض N لعام Yهـ"
                objection_pat = re.search(r'رقم الاعتراض\s+([٠-٩\d]+)\s+لعام\s+([٠-٩\d]+)هـ', raw_text[:500])
                if objection_pat:
                    appeal_number = extract_western_number(objection_pat.group(1))
                    appeal_year = extract_western_number(objection_pat.group(2))

                # Session date: "تاريخ الجلسة ٧/١/١٤٤٢هـ"
                date_pat = re.search(r'تاريخ الجلسة\s+(.+?)هـ', raw_text[:500])
                if date_pat:
                    session_date = to_western(date_pat.group(1).strip())

                # Override case_id to include collection number
                case_number = f"{case_number}-M{collection_num}"

            else:  # assembly
                # Format: قرار الهيئة العامة...\nرقم القرار N لعام YYYYهـ
                decision_num = to_western(match.group(1).strip())
                decision_year = extract_western_number(match.group(2).strip())
                case_number = f"GA-{decision_num}"
                case_year = decision_year

                # Session date: "تاريخ الجلسة ٢٨/١٠/١٤٤٢هـ"
                date_pat = re.search(r'تاريخ الجلسة\s+(.+?)هـ', raw_text[:500])
                if date_pat:
                    session_date = to_western(date_pat.group(1).strip())

            judgment_type = "supreme_administrative"

        elif discipline_mode:
            # Discipline board format: (N)\nجلسة date
            # group(1) = ruling number, group(2) = session date line
            ruling_num = to_western(match.group(1).strip())
            case_number = ruling_num
            date_raw = match.group(2).strip()
            # Extract year from date like "٢٣-١-١٣٩٥هـ" or "٢٣ - ١ - ١٣٩٥"
            year_match = re.search(r'(\d{4}|[\d٠-٩]{4})', date_raw)
            if year_match:
                case_year = extract_western_number(year_match.group(1))
            session_date = to_western(date_raw.replace('هـ', '').strip())

            # Try to extract case number from text: "القضية رقم N لسنة YYYY"
            case_pat = re.search(r'القضية رقم\s+([٠-٩\d/]+)\s+لسنة\s+([٠-٩\d]+)', raw_text[:1500])
            if case_pat:
                case_number = extract_western_number(case_pat.group(1))
                case_year = extract_western_number(case_pat.group(2))

        elif pre1402_decision_mode:
            # Pre-1402 decision: "قرار ه/X/Y لعام YYYYهـ\nفي القضية رقم ..."
            # group(1) = decision number, group(2) = decision year
            decision_num_raw = match.group(1).strip()
            decision_year_raw = match.group(2).strip()
            appeal_number = extract_western_number(decision_num_raw)  # decision number as appeal
            appeal_year = extract_western_number(decision_year_raw)

            # Extract actual case number from next line: "في القضية رقم ٥٦٧/١/ق لعام ١٤٠١هـ"
            case_pat = re.search(
                r'(?:في\s+)?(?:ال)?قضية\s+رقم\s+(.+?)\s+(?:لعام|لسنة)\s+(.+?)هـ',
                raw_text[:600]
            )
            if case_pat:
                case_number = extract_western_number(case_pat.group(1))
                case_year = extract_western_number(case_pat.group(2))
            else:
                case_number = appeal_number
                case_year = appeal_year

            # Session date: "الصادر بجلسة ٧/١/١٤٠٢هـ"
            date_pat = re.search(r'(?:الصادر\s+)?بجلسة\s+(.+?)هـ', raw_text[:600])
            if date_pat:
                session_date = to_western(date_pat.group(1).strip())

        elif legacy_mode:
            # Legacy format: extract from structured header block
            # Variant A (1427-1428): رقم حكم التدقيق ٥/ت/٦ لعام ١٤٢٧هـ
            # Variant B (1429-1432): رقم حكم الاستئناف: ١٥٨/إس/٦ لعام ١٤٣٠هـ
            # Variant C (oldest): حَكَم التَدقيق رقم: ١٤٨/ت/٣ لعام ١٤٢٤هـ
            appeal_pat = re.compile(
                r'(?:رقم حكم (?:التدقيق|الاستئناف)|'
                r'(?:حَكَم|حكم)\s+الت[َّ]*دقيق\s+رقم|'
                r'حكم\s+(?:هيئة\s+)?الاستئناف\s+رقم):?\s+(.+?)\s+لعام\s+(.+?)هـ'
            )
            appeal_match = appeal_pat.search(raw_text[:800])
            if appeal_match:
                appeal_number = extract_western_number(appeal_match.group(1))
                appeal_year = extract_western_number(appeal_match.group(2))

            date_pattern = re.compile(r'تاريخ الجلسة:?\s+(.+?)هـ')
            date_match = date_pattern.search(raw_text[:800])
            if date_match:
                session_date = to_western(date_match.group(1).strip())
        else:
            # Modern format: extract appeal from "رقم القضية في محكمة الاستئناف..."
            appeal_pattern = re.compile(
                r'رقم القضية في ' + re.escape(config['appeal_court']) + r'\s*(.+?)\s+لعام\s+(.+?)هـ',
            )
            appeal_match = appeal_pattern.search(raw_text[:500])
            if appeal_match:
                appeal_number = extract_western_number(appeal_match.group(1))
                appeal_year = extract_western_number(appeal_match.group(2))

            date_pattern = re.compile(r'تاريخ الجلسة\s+(.+?)هـ')
            date_match = date_pattern.search(raw_text[:500])
            if date_match:
                session_date = to_western(date_match.group(1).strip())

        # Extract topics (الموضوعات / المبادئ المستخلصة section)
        # Supreme court uses many OCR variants of "المبادئ المستخلصة"
        # Strategy: scan lines, stripping tashkeel for matching, but extracting original text
        _strip_t = re.compile(r'[\u064B-\u065F\u0670]')
        topics_match = None
        lines = raw_text[:4000].split('\n')
        topics_start_line = -1
        topics_end_line = -1
        for li, line in enumerate(lines):
            stripped_line = _strip_t.sub('', line).strip()
            bare = re.sub(r'^#+\s*', '', stripped_line)
            if topics_start_line < 0:
                # Check for topics header
                if re.match(r'(?:الموضوعات|الموصوفات|الموضعت|المووضعت|المب\S+\s+الم\S*لص\S*)$', bare):
                    topics_start_line = li + 1
            else:
                # Check for end of topics section
                if re.match(r'(?:مستند|الوقائع|الوقاية|الانظمة|الائتلاف|الملخص|القرار|القسرار)', bare):
                    topics_end_line = li
                    break
        if topics_start_line >= 0 and topics_end_line > topics_start_line:
            topics_content = '\n'.join(lines[topics_start_line:topics_end_line])
            topics_match = type('Match', (), {
                'group': lambda self, n=1: topics_content
            })()
        topics = ""
        category = ""
        if topics_match:
            topics_raw = topics_match.group(1).strip()
            # Clean up markdown bullets
            topics = re.sub(r'^[-*•]\s*', '', topics_raw, flags=re.MULTILINE).strip()
            # Extract category from first topic line (before first dash)
            first_line = topics.split('\n')[0]
            first_line_clean = re.sub(r'\*\*', '', first_line)
            parts = re.split(r'\s*[-–]\s*', first_line_clean)
            if parts:
                category = parts[0].strip()
                category = re.sub(r'^#+\s*', '', category).strip()
                # Supreme court topics start with letter prefix like "أ- دعوى - ..."
                # or "أ. دعوى - ..." — strip the letter prefix
                category = re.sub(r'^[أ-ي]\.\s*', '', category).strip()
                # Skip single-letter categories and take the next part
                if len(category) <= 2 and len(parts) > 1:
                    category = parts[1].strip()
                    category = re.sub(r'^[أ-ي]\.\s*', '', category).strip()

        # Clean the full text (LLM results already cached from batch scan)
        cleaned = clean_text(raw_text, use_llm=use_llm)

        # Build case ID
        case_id = f"BOG-{collection_year}-V{volume_num}-{case_number}/{case_year}"

        # Determine court body
        court_body = "ديوان المظالم"
        if supreme_ruling_mode or supreme_assembly_mode:
            court_body = "المحكمة الإدارية العليا"
            judgment_type = "supreme_administrative"
        elif discipline_mode:
            court_body = "هيئة التأديب"
            judgment_type = "disciplinary"
        elif pre1402_decision_mode and "رشوة" in raw_text[:500] or "تزوير" in raw_text[:500]:
            court_body = "هيئة الحكم - قضايا الرشوة والتزوير"

        judgment = {
            "case_id": case_id,
            "case_number": case_number,
            "case_year": case_year,
            "appeal_number": appeal_number,
            "appeal_year": appeal_year,
            "session_date": session_date,
            "topics": topics,
            "category": category,
            "year_hijri": int(re.search(r'\d{4}', collection_year).group()) if re.search(r'\d{4}', collection_year) else None,
            "court_body": court_body,
            "circuit_type": category,
            "judgment_type": judgment_type,
            "text": cleaned,
            "source": "bog_judicial",
            "char_count": len(cleaned),
        }
        judgments.append(judgment)

    return judgments


def main():
    parser = argparse.ArgumentParser(description="Split BOG OCR text into individual judgments")
    parser.add_argument("--input", type=str,
                        default=r"C:\Users\Alemr\Desktop\bog_judgments\test_mistral_ocr_output.txt",
                        help="Path to OCR text file")
    parser.add_argument("--output-dir", type=str,
                        default=r"C:\Users\Alemr\Desktop\bog_judgments\split_judgments",
                        help="Output directory for split judgments")
    parser.add_argument("--year", type=str, default="1442",
                        help="Collection year (Hijri)")
    parser.add_argument("--volume", type=str, default="1",
                        help="Volume number")
    parser.add_argument("--type", type=str, default=None,
                        choices=['administrative', 'commercial', 'criminal', 'supreme_administrative'],
                        help="Judgment type (auto-detected if not specified)")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        sys.exit(1)

    print(f"Reading OCR text from: {input_path}")
    with open(input_path, 'r', encoding='utf-8') as f:
        ocr_text = f.read()
    print(f"  Total length: {len(ocr_text)} characters")

    # Split into judgments
    print(f"\nSplitting into individual judgments...")
    judgments = split_judgments(ocr_text, args.year, args.volume, args.type)
    print(f"  Total judgments extracted: {len(judgments)}")

    if not judgments:
        print("No judgments found. Exiting.")
        sys.exit(1)

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Save individual judgment files
    for i, j in enumerate(judgments):
        filename = f"{args.year}_V{args.volume}_{i+1:03d}_{j['case_number']}.json"
        filepath = output_dir / filename
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(j, f, ensure_ascii=False, indent=2)

    # Save combined file for easy import
    combined_file = output_dir / f"{args.year}_V{args.volume}_all.json"
    with open(combined_file, 'w', encoding='utf-8') as f:
        json.dump({
            "collection_year": args.year,
            "volume": args.volume,
            "judgment_type": judgments[0].get("judgment_type", "administrative") if judgments else "administrative",
            "total_judgments": len(judgments),
            "judgments": judgments,
        }, f, ensure_ascii=False, indent=2)

    # Print summary
    print(f"\n{'='*60}")
    print(f"SPLITTING COMPLETE")
    print(f"{'='*60}")
    print(f"Total judgments: {len(judgments)}")
    print(f"Output directory: {output_dir}")
    print(f"Combined file: {combined_file}")

    # Category breakdown
    categories = {}
    for j in judgments:
        cat = j["category"] or "غير مصنف"
        categories[cat] = categories.get(cat, 0) + 1

    print(f"\nCategory breakdown:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    # Show sample of first 3 judgments
    print(f"\nSample judgments:")
    for j in judgments[:3]:
        print(f"\n  Case: {j['case_id']}")
        print(f"  Category: {j['category']}")
        print(f"  Session date: {j['session_date']}")
        print(f"  Appeal: {j['appeal_number']}/{j['appeal_year']}")
        print(f"  Topics: {j['topics'][:100]}...")
        print(f"  Text length: {j['char_count']} chars")


if __name__ == "__main__":
    main()
