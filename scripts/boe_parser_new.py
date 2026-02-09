#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BOE Law Parser - Parse amendments and canceled articles correctly
"""

from bs4 import BeautifulSoup
import re
import json

def parse_law_html(html_content):
    """
    Parse BOE law HTML extracting articles with amendments tracking

    Returns:
        {
            'title': str,
            'royal_decree': dict,
            'articles': [
                {
                    'number': int/str,
                    'text': str (current version),
                    'status': 'active'|'amended'|'canceled',
                    'amendments': [
                        {
                            'date': str,
                            'decree': str,
                            'description': str,
                            'old_text': str,
                            'new_text': str
                        }
                    ]
                }
            ]
        }
    """
    soup = BeautifulSoup(html_content, 'html.parser')

    law_data = {
        'title': None,
        'royal_decree': {},
        'articles': []
    }

    # Extract title
    title_tag = soup.find('title')
    if title_tag:
        law_data['title'] = title_tag.text.strip()

    # Find all article divs
    article_divs = soup.find_all('div', class_=re.compile(r'article_item'))

    # Extract preamble/royal decree (appears before first article)
    if article_divs:
        first_article = article_divs[0]
        # Find HTMLContainer divs before first article
        for elem in first_article.find_all_previous('div'):
            if 'HTMLContainer' in elem.get('class', []):
                # Replace <br> with newlines to preserve formatting
                elem_copy = elem.__copy__()
                for br in elem_copy.find_all('br'):
                    br.replace_with('\n')

                # Get text with line breaks preserved
                text = elem_copy.get_text(separator=' ', strip=False)

                # Clean up: remove excessive spaces but keep line breaks
                lines = []
                for line in text.split('\n'):
                    cleaned = ' '.join(line.split())  # Remove extra spaces
                    if cleaned:
                        lines.append(cleaned)
                text = '\n'.join(lines)

                # Royal decree typically starts with "بعون الله" or "بسم الله" or contains "أمر ملكي"
                if text and (text.startswith('بعون الله') or text.startswith('بسم الله') or 'أمر ملكي' in text or 'مرسوم ملكي' in text):
                    law_data['royal_decree'] = {
                        'text': text
                    }
                    # Try to extract decree number and date
                    decree_match = re.search(r'(?:أمر|مرسوم)\s+ملكي\s+رقم\s+([^\s]+)\s+(?:بتاريخ|وتاريخ)\s+([٠-٩\d\s/]+)', text)
                    if decree_match:
                        law_data['royal_decree']['number'] = decree_match.group(1)
                        law_data['royal_decree']['date'] = decree_match.group(2).strip()
                    break

    for article_div in article_divs:
        # Skip popup divs (they're amendment details)
        if 'article_item_popup' in article_div.get('class', []):
            continue

        article = parse_article(article_div, soup)
        if article:
            law_data['articles'].append(article)

    return law_data

def parse_article(article_div, soup):
    """Parse a single article div"""

    article = {
        'number': None,
        'number_text': None,
        'text': None,
        'original_text': None,  # النص الأصلي قبل التعديلات
        'status': 'active',
        'amendments': []
    }

    # Check if canceled
    if 'canceled' in ' '.join(article_div.get('class', [])):
        article['status'] = 'canceled'

    # Check if amended
    if 'changed-article' in ' '.join(article_div.get('class', [])):
        article['status'] = 'amended'

    # Extract article number
    h3 = article_div.find('h3')
    if h3:
        article['number_text'] = h3.text.strip()
        # Extract number from text like "المادة الخامسة" or "المادة (١)"
        # Just check if it contains "المادة" - extract_article_number will handle the details
        if 'المادة' in h3.text:
            article['number'] = extract_article_number(h3.text)

    # Extract article text - CRITICAL: Get HTMLContainer that is NOT inside popup-list
    # This contains the ORIGINAL text (النص الأصلي) before amendments
    # Amendments are in HTMLContainer inside popup-list divs

    # First, find all HTMLContainers
    all_containers = article_div.find_all('div', class_='HTMLContainer')

    # Filter out containers that are inside popup-list
    html_container = None
    for container in all_containers:
        # Check if this container is inside a popup-list
        parent_popup = container.find_parent('div', class_='popup-list')
        if parent_popup is None:
            # This container is NOT in popup - it's the original text
            html_container = container
            break

    if html_container:
        # Extract paragraphs with proper indentation from HTML structure
        # IMPORTANT: Do this FIRST before modifying html_container
        article['paragraphs'] = extract_paragraphs_from_html(html_container)

        # Also extract plain text for backward compatibility
        # Make a copy to avoid modifying the original
        html_copy = html_container.__copy__()

        # Replace <br> with newlines
        for br in html_copy.find_all('br'):
            br.replace_with('\n')

        # Replace </p> with newlines
        for p in html_copy.find_all('p'):
            p_text = p.get_text()
            p.replace_with(p_text + '\n')

        # Get ALL text content recursively
        text = html_copy.get_text(separator=' ', strip=False)

        # Clean up: remove excessive spaces but keep line breaks
        lines = []
        for line in text.split('\n'):
            cleaned = ' '.join(line.split())  # Remove extra spaces
            if cleaned:
                lines.append(cleaned)

        original_text = '\n'.join(lines)
        article['original_text'] = original_text

    # Extract amendments if article is amended
    if article['status'] == 'amended':
        article['amendments'] = extract_amendments(article_div, soup)
        # Apply amendments to get current valid text (النص الساري)
        article['text'] = apply_amendments(article['original_text'], article['amendments'])
        # Re-extract paragraphs from HTML if amendments changed structure
        # For now, fallback to text-based extraction for amended text
        article['paragraphs'] = extract_paragraphs(article['text'])
    else:
        # No amendments - current text is same as original
        article['text'] = article['original_text']

    return article if article['text'] else None

def extract_amendments(article_div, soup):
    """Extract amendment history for an article"""
    amendments = []

    # Find amendment button
    amend_link = article_div.find('a', class_='ancArticlePrevVersions')
    if not amend_link:
        return amendments

    # Get article ID from data attribute
    article_id = amend_link.get('data-articleid')
    if not article_id:
        return amendments

    # Find popup div with amendments
    popup_class = article_id
    popup_div = soup.find('div', class_=popup_class)

    if not popup_div:
        return amendments

    # Find all amendment items
    amend_items = popup_div.find_all('div', class_='article_item_popup')

    for item in amend_items:
        amendment = {}

        # Extract amendment description
        html_container = item.find('div', class_='HTMLContainer')
        if html_container:
            text = html_container.get_text(strip=True)
            amendment['description'] = text

            # Try to extract decree and date
            # Pattern: "عدلت ... بموجب الأمر الملكي رقم (X) وتاريخ DD/MM/YYYY"
            decree_match = re.search(r'الأمر\s+الملكي?\s+رقم\s+\(([^)]+)\)', text)
            if decree_match:
                amendment['decree'] = decree_match.group(1)

            date_match = re.search(r'تاريخ\s+([٠-٩\d]+\s*/\s*[٠-٩\d]+\s*/\s*[٠-٩\d]+)', text)
            if date_match:
                amendment['date'] = date_match.group(1)

            # Try to extract which paragraph was amended
            # Pattern: "عدلت الفقرة ( ب )" or "عدلت الفقرة الأولى"
            para_match = re.search(r'الفقرة\s+(?:\(\s*([^)]+)\s*\)|([أ-ي]))', text)
            if para_match:
                amendment['paragraph'] = para_match.group(1) or para_match.group(2)

            # Try to extract new text
            # The new text is usually after "لتكون بالنص الآتي :" and may be in parentheses or quotes
            if 'لتكون' in text:
                # Extract everything after "لتكون"
                parts = text.split('لتكون', 1)
                if len(parts) > 1:
                    potential_new_text = parts[1].strip()

                    # Remove prefixes like "بالنص الآتي :" or "بالنص الآتى :"
                    potential_new_text = re.sub(r'^بالنص الآت[يى]\s*:?\s*', '', potential_new_text)

                    # Extract content between delimiters: (...) or "..." or just the text
                    # Try parentheses first
                    paren_match = re.search(r'\(\s*([^)]+)\s*\)', potential_new_text)
                    if paren_match:
                        amendment['new_text'] = paren_match.group(1).strip()
                    else:
                        # Try quotes
                        quote_match = re.search(r'[\"\']\s*([^\"\']+)\s*["\']', potential_new_text)
                        if quote_match:
                            amendment['new_text'] = quote_match.group(1).strip()
                        else:
                            # No delimiters - take the whole text but clean it up
                            new_text = potential_new_text.strip()
                            # Remove trailing periods, commas, parentheses
                            new_text = re.sub(r'[.،؛\)]$', '', new_text)
                            amendment['new_text'] = new_text.strip()

        if amendment:
            amendments.append(amendment)

    return amendments

def extract_paragraphs_from_html(html_container):
    """
    Extract paragraphs with proper indentation from HTML structure.

    BOE uses this structure:
    - <p>: Simple paragraphs (level 0)
    - <ol><li>: Numbered items (level 1) - browser renders numbers
    - Inside <li>: Arabic letters (أ، ب، ج) with <br> tags (level 2)

    Returns list of paragraphs with markers, text, and indentation levels.
    """
    paragraphs = []

    # Process direct children of HTMLContainer
    for element in html_container.children:
        if isinstance(element, str):
            # Direct text node
            text = element.strip()
            if text and len(text) > 10:
                paragraphs.append({
                    "marker": "",
                    "text": text,
                    "level": 0
                })
            continue

        if element.name == 'p':
            # Paragraph - check if it contains definitions or regular text
            # Replace <br> with newlines for processing
            p_copy = element.__copy__()
            for br in p_copy.find_all('br'):
                br.replace_with('\n')

            text = p_copy.get_text(separator=' ', strip=False)

            # Check if this paragraph has definition structure (bold term followed by text)
            # Pattern: "term: definition\nterm: definition"
            lines = [line.strip() for line in text.split('\n') if line.strip()]

            # Check if multiple lines with pattern "word:" exist (definitions)
            definition_count = sum(1 for line in lines if ':' in line and len(line.split(':')[0].split()) <= 3)

            # Check if lines have numbered markers (1 -, 2 -, أ -, etc.)
            numbered_pattern = r'^([0-9]+|[٠-٩]+|[أ-ي]|جـ)\s*[-:]\s*(.+)$'
            numbered_lines = [line for line in lines if re.match(numbered_pattern, line)]

            if definition_count > 2 and len(lines) > 3:
                # This is a definitions paragraph - split by lines
                for i, line in enumerate(lines):
                    if ':' in line:
                        parts = line.split(':', 1)
                        if len(parts) == 2 and len(parts[0].strip().split()) <= 3:
                            # Definition term
                            paragraphs.append({
                                "marker": parts[0].strip() + ':',
                                "text": parts[1].strip(),
                                "level": 0
                            })
                        else:
                            # Regular line with colon
                            paragraphs.append({
                                "marker": "",
                                "text": line,
                                "level": 0
                            })
                    elif line and i > 0:  # Skip if first line and no colon
                        paragraphs.append({
                            "marker": "",
                            "text": line,
                            "level": 0
                        })
            elif len(numbered_lines) >= 2:
                # This paragraph contains numbered items
                # First, add any intro text before first numbered item
                intro_text = []
                for line in lines:
                    if not re.match(numbered_pattern, line):
                        intro_text.append(line)
                    else:
                        break

                if intro_text:
                    paragraphs.append({
                        "marker": "",
                        "text": ' '.join(intro_text),
                        "level": 0
                    })

                # Now process numbered items
                for line in lines:
                    match = re.match(numbered_pattern, line)
                    if match:
                        marker_text = match.group(1)
                        content = match.group(2).strip()

                        # Determine level: numbers are level 1, letters are level 2
                        if marker_text in ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي', 'ك', 'ل', 'م', 'ن', 'س', 'ع', 'ف', 'ص', 'ق', 'ر', 'ش', 'ت', 'ث', 'خ', 'ذ', 'ض', 'ظ', 'غ', 'جـ']:
                            level = 2
                        else:
                            level = 1

                        paragraphs.append({
                            "marker": marker_text + ' -',
                            "text": content,
                            "level": level
                        })
            else:
                # Regular paragraph - add as single item
                full_text = ' '.join(text.split())  # Normalize spaces
                if full_text:
                    paragraphs.append({
                        "marker": "",
                        "text": full_text,
                        "level": 0
                    })

        elif element.name == 'ol':
            # Ordered list - each <li> is a numbered item (level 1)
            for li_index, li in enumerate(element.find_all('li', recursive=False)):
                # Process content of <li>
                # First, extract any content before sub-items
                li_copy = li.__copy__()

                # Replace <br> with special marker for splitting
                for br in li_copy.find_all('br'):
                    br.replace_with('<<<BR>>>')

                # Get text
                li_text = li_copy.get_text(separator=' ', strip=False)

                # Split by <<<BR>>> to get individual lines
                lines = [line.strip() for line in li_text.split('<<<BR>>>') if line.strip()]

                if not lines:
                    continue

                # Pattern to detect Arabic letter markers: أ- ب- ج- etc.
                letter_pattern = r'^([أ-ي]|جـ)\s*-\s*(.+)$'

                # First line is the main item text (level 1)
                main_text = lines[0]

                # Check if main text ends with colon (indicates sub-items follow)
                if main_text.endswith(':') or (len(lines) > 1 and re.match(letter_pattern, lines[1])):
                    # Remove trailing colon and any markers from main text
                    main_text = main_text.rstrip(':').strip()

                paragraphs.append({
                    "marker": f"{li_index + 1} -",  # Use actual number
                    "text": main_text,
                    "level": 1
                })

                # Process remaining lines as sub-items (level 2)
                for line in lines[1:]:
                    match = re.match(letter_pattern, line)
                    if match:
                        # This is a sub-item with Arabic letter marker
                        marker = match.group(1) + ' -'
                        content = match.group(2).strip()
                        paragraphs.append({
                            "marker": marker,
                            "text": content,
                            "level": 2
                        })
                    else:
                        # Continuation of previous item or unmarked sub-item
                        if line and len(line) > 5:
                            paragraphs.append({
                                "marker": "",
                                "text": line,
                                "level": 2
                            })

    # If no paragraphs extracted, fall back to text extraction
    if not paragraphs:
        text = html_container.get_text(separator='\n', strip=True)
        return extract_paragraphs(text)

    return paragraphs

def extract_paragraphs(text):
    """
    Extract structured paragraphs from article text

    Returns list of paragraphs with markers like:
    [
        {"marker": "أ -", "text": "...", "level": 0},
        {"marker": "ب -", "text": "...", "level": 0}
    ]

    Also handles definitions in format "المصطلح:\nالتعريف"

    NOTE: This function is a fallback when HTML structure is not available.
    It makes assumptions about indentation levels based on marker types,
    which may not be accurate. Prefer extract_paragraphs_from_html when possible.
    """
    if not text:
        return []

    paragraphs = []

    # Split text by lines
    lines = text.split('\n')

    # Pattern to detect paragraph markers: "أ -" or "١-" or "1-" or "أولاً :" etc.
    # Supports both Arabic-Indic numerals (٠-٩) and Western numerals (0-9)
    para_pattern = r'^([أ-ي]|جـ|[٠-٩]+|[0-9]+|أولاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً|سابعاً|ثامناً|تاسعاً|عاشراً)\s*[-:]\s*(.+)$'

    # Pattern to detect definitions: "المصطلح:" or "المصطلح :" (term followed by colon)
    definition_pattern = r'^([^:]+):$'

    # Check if text has paragraph markers
    has_markers = any(re.match(para_pattern, line.strip()) for line in lines if line.strip())

    # Check if text has definitions (multiple lines ending with colons)
    definition_lines = [line for line in lines if re.match(definition_pattern, line.strip())]
    has_definitions = len(definition_lines) > 2  # More than 2 definitions

    if has_definitions:
        # This is a definitions article - pair each term with its definition
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if not line:
                i += 1
                continue

            # Check if this is a definition term (ends with colon)
            term_match = re.match(definition_pattern, line)
            if term_match:
                term = term_match.group(1).strip()
                # Get the next non-empty line as the definition
                definition_text = ""
                i += 1
                while i < len(lines):
                    next_line = lines[i].strip()
                    if not next_line:
                        i += 1
                        continue
                    # Check if next line is another term
                    if re.match(definition_pattern, next_line):
                        break
                    definition_text = next_line
                    break

                paragraphs.append({
                    "marker": term + ":",
                    "text": definition_text,
                    "level": 0
                })
            else:
                # Not a definition line - add as intro text if substantial
                if len(line.split()) > 3:
                    paragraphs.append({
                        "marker": "",
                        "text": line,
                        "level": 0
                    })
                i += 1

        return paragraphs

    if not has_markers:
        # No paragraph markers and no definitions - split by line breaks to preserve formatting
        # Each non-empty line becomes a separate paragraph
        non_empty_lines = [line.strip() for line in lines if line.strip()]
        if len(non_empty_lines) == 1:
            # Single paragraph - keep as is
            return [{
                "marker": "",
                "text": non_empty_lines[0],
                "level": 0
            }]
        else:
            # Multiple lines - keep them separate to preserve formatting
            return [{
                "marker": "",
                "text": line,
                "level": 0
            } for line in non_empty_lines]

    # Text has paragraph markers - extract them with proper indentation levels
    # Level 0: Numbers (1, 2, 3, ١, ٢, ٣) or words (أولاً, ثانياً)
    # Level 1: Arabic letters (أ، ب، ج)
    # Level 2: Sub-numbers or other nested markers

    for line in lines:
        line = line.strip()
        if not line:
            continue

        match = re.match(para_pattern, line)
        if match:
            marker_text = match.group(1)
            marker = marker_text + ' -'
            text_content = match.group(2).strip()

            # Determine indentation level based on marker type
            level = 1
            if marker_text in ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي', 'ك', 'ل', 'م', 'ن', 'س', 'ع', 'ف', 'ص', 'ق', 'ر', 'ش', 'ت', 'ث', 'خ', 'ذ', 'ض', 'ظ', 'غ', 'جـ']:
                # Arabic letters are sub-items (level 2)
                level = 2
            elif marker_text in ['أولاً', 'ثانياً', 'ثالثاً', 'رابعاً', 'خامساً', 'سادساً', 'سابعاً', 'ثامناً', 'تاسعاً', 'عاشراً']:
                # Main ordinal words (level 0)
                level = 1
            else:
                # Numbers (both Arabic-Indic and Western) are main items (level 1)
                level = 1

            paragraphs.append({
                "marker": marker,
                "text": text_content,
                "level": level
            })
        else:
            # Non-marker lines (intro text, continuations)
            if len(line.split()) > 2:
                paragraphs.append({
                    "marker": "",
                    "text": line,
                    "level": 0
                })

    return paragraphs

def apply_amendments(original_text, amendments):
    """
    Apply amendments to original text to get current valid text

    Args:
        original_text: النص الأصلي
        amendments: قائمة التعديلات

    Returns:
        النص الساري (بعد تطبيق التعديلات)
    """
    if not original_text or not amendments:
        return original_text

    current_text = original_text

    for amendment in amendments:
        if 'paragraph' not in amendment or 'new_text' not in amendment:
            continue

        para = amendment['paragraph'].strip()
        new_text = amendment['new_text'].strip()

        # Check if new_text already starts with the paragraph marker (e.g., "جـ -")
        # If so, don't add it again
        starts_with_para = new_text.startswith(f'{para} -') or new_text.startswith(f'{para}-')

        # Try to find and replace the paragraph
        # Pattern: "أ -" or "ب -" or "جـ -" etc.
        # Match from paragraph marker to end of line (or until next paragraph)
        para_pattern = rf'{re.escape(para)}\s*-\s*([^\n]+(?:\n(?![\u0623-\u064a]+\s*-)[^\n]+)*)'

        match = re.search(para_pattern, current_text, re.MULTILINE)
        if match:
            # Replace the old paragraph text with new text
            old_para_full = match.group(0)

            if starts_with_para:
                # New text already has paragraph marker, use as-is
                new_para_full = new_text
            else:
                # Add paragraph marker to new text
                new_para_full = f'{para} - {new_text}'

            current_text = current_text.replace(old_para_full, new_para_full, 1)

    return current_text

def extract_article_number(text):
    """Extract article number from Arabic text"""

    # Arabic number words - IMPORTANT: Order matters! Check longer numbers first
    arabic_numbers = [
        ('الحادية عشرة', 11),
        ('الثانية عشرة', 12),
        ('الثالثة عشرة', 13),
        ('الرابعة عشرة', 14),
        ('الخامسة عشرة', 15),
        ('السادسة عشرة', 16),
        ('السابعة عشرة', 17),
        ('الثامنة عشرة', 18),
        ('التاسعة عشرة', 19),
        ('العشرون', 20),
        ('الحادية والعشرون', 21),
        ('الثانية والعشرون', 22),
        ('الثالثة والعشرون', 23),
        ('الرابعة والعشرون', 24),
        ('الخامسة والعشرون', 25),
        ('السادسة والعشرون', 26),
        ('السابعة والعشرون', 27),
        ('الثامنة والعشرون', 28),
        ('التاسعة والعشرون', 29),
        ('الثلاثون', 30),
        ('الأولى', 1),
        ('الثانية', 2),
        ('الثالثة', 3),
        ('الرابعة', 4),
        ('الخامسة', 5),
        ('السادسة', 6),
        ('السابعة', 7),
        ('الثامنة', 8),
        ('التاسعة', 9),
        ('العاشرة', 10),
    ]

    # Check longer patterns first to avoid false matches
    for word, num in arabic_numbers:
        if word in text:
            return num

    # Try to find numeric representation
    number_match = re.search(r'[٠-٩\d]+', text)
    if number_match:
        # Convert Arabic-Indic digits to Western
        arabic_digits = '٠١٢٣٤٥٦٧٨٩'
        western_digits = '0123456789'
        trans = str.maketrans(arabic_digits, western_digits)
        return int(number_match.group().translate(trans))

    return None

def main():
    """Test parser on sample law"""
    import sys
    import io

    # Fix Windows console encoding
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

    if len(sys.argv) < 2:
        print("Usage: python boe_parser.py <html_file>")
        sys.exit(1)

    html_file = sys.argv[1]

    with open(html_file, 'r', encoding='utf-8') as f:
        html_content = f.read()

    law_data = parse_law_html(html_content)

    print(json.dumps(law_data, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
