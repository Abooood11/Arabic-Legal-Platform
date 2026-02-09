#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BOE Folder-1 Extractor v2 — Full rewrite
=========================================
Extracts the first 30 laws from https://laws.boe.gov.sa/BoeLaws/Laws/Folders/1
and converts them to platform-ready JSON.

Fixes over v1:
  - Markers always include hyphen: "1-", "أ-" (not bare "1")
  - No span-fragment leakage: inner <span> text is merged into parent
  - Proper paragraph splitting from <br>, <ol>/<li>, and text patterns
  - Article text extracted via innerHTML→text (dual-path) to avoid truncation
  - Scramble detection: warns if article body contains unexpected headings
  - Completeness check: flags suspiciously short articles
"""

import sys, io, os, re, json, time
from pathlib import Path

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import requests, urllib3
    from bs4 import BeautifulSoup, NavigableString, Tag
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except ImportError:
    os.system("pip install requests beautifulsoup4 urllib3")
    import requests, urllib3
    from bs4 import BeautifulSoup, NavigableString, Tag
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Config ────────────────────────────────────────────────────────────
BASE_URL   = "https://laws.boe.gov.sa"
FOLDER_ID  = 1
MAX_LAWS   = 30

PROJECT    = Path(__file__).resolve().parent.parent
LAWS_DIR   = PROJECT / "client" / "public" / "data" / "laws"
PDF_DIR    = PROJECT / "client" / "public" / "data" / "amendments_pdf"
LIB_FILE   = PROJECT / "client" / "public" / "data" / "library.json"
IDX_FILE   = PROJECT / "client" / "public" / "data" / "boe_laws_index.json"

LAWS_DIR.mkdir(parents=True, exist_ok=True)
PDF_DIR.mkdir(parents=True, exist_ok=True)

sess = requests.Session()
sess.verify = False
sess.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html",
    "Accept-Language": "ar",
})

# ── Arabic helpers ────────────────────────────────────────────────────
_HINDI = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# Ordinals — longest first so الحادية عشرة matches before الأولى
_ORDINALS = []
_tens  = [("عشر", 20), ("ثلاث", 30), ("أربع", 40), ("خمس", 50),
          ("ست", 60), ("سبع", 70), ("ثمان", 80), ("تسع", 90), ("مائ", 100)]
_ones  = [("الحادية", 1), ("الثانية", 2), ("الثالثة", 3), ("الرابعة", 4),
          ("الخامسة", 5), ("السادسة", 6), ("السابعة", 7), ("الثامنة", 8),
          ("التاسعة", 9)]
_standalone = [("العشرون", 20), ("الثلاثون", 30), ("الأربعون", 40),
               ("الخمسون", 50), ("الستون", 60), ("السبعون", 70),
               ("الثمانون", 80), ("التسعون", 90), ("المائة", 100),
               ("العاشرة", 10)]

# Build compound: "الحادية والعشرون" = 21  etc.
for otext, oval in _ones:
    for ttext, tval in _tens:
        # e.g. الحادية عشرة (11-19)
        if tval == 20:
            _ORDINALS.append((f"{otext} عشرة", oval + 10))
        # e.g. الحادية والعشرون (21-29)
        for stext, sval in _standalone:
            if sval == tval:
                _ORDINALS.append((f"{otext} و{stext}", oval + tval))
                break

_ORDINALS += _standalone
_ORDINALS += [
    ("الأولى", 1), ("الثانية", 2), ("الثالثة", 3), ("الرابعة", 4),
    ("الخامسة", 5), ("السادسة", 6), ("السابعة", 7), ("الثامنة", 8),
    ("التاسعة", 9),
]
# Sort longest first
_ORDINALS.sort(key=lambda x: -len(x[0]))


def _arabic_num(text):
    """Convert Arabic ordinal / numeral text → int or None."""
    if not text:
        return None
    t = text.strip()
    for w, n in _ORDINALS:
        if w in t:
            return n
    m = re.search(r"[٠-٩\d]+", t)
    if m:
        return int(m.group().translate(_HINDI))
    return None


def _clean(text):
    """Remove tatweel, zero-width chars; normalise whitespace per line."""
    if not text:
        return ""
    text = text.replace("\u0640", "")                       # tatweel
    text = re.sub(r"[\u200b-\u200f\ufeff]", "", text)       # ZW chars
    lines = []
    for ln in text.split("\n"):
        ln = " ".join(ln.split())
        if ln:
            lines.append(ln)
    return "\n".join(lines)


# ── HTML → plain text (no span-fragment leakage) ─────────────────────

def _container_to_text(container, strip_tables=False):
    """
    Convert an HTMLContainer div to clean multi-line text.
    Uses innerHTML approach: replace <br> with \\n, strip tags,
    so inner <span> never creates fragment boundaries.
    If strip_tables=True, removes <table>...</table> from HTML before converting.
    """
    if container is None:
        return ""
    # Work on a string copy of innerHTML
    html = container.decode_contents()            # inner HTML string
    if strip_tables:
        # Remove <table>...</table> entirely (used when tables are extracted separately)
        html = re.sub(r"<table[\s\S]*?</table>", "\n", html, flags=re.I)
    # <br> / <br/> → newline
    html = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    # </p> → newline  (but keep <p> opening as nothing)
    html = re.sub(r"</p>", "\n", html, flags=re.I)
    html = re.sub(r"<p[^>]*>", "", html, flags=re.I)
    # </li> → newline
    html = re.sub(r"</li>", "\n", html, flags=re.I)
    # Table: each row → new line, cells separated naturally by spaces
    html = re.sub(r"</tr>", "\n", html, flags=re.I)
    html = re.sub(r"<t[dh][^>]*>", "  ", html, flags=re.I)
    # Strip all remaining tags
    html = re.sub(r"<[^>]+>", " ", html)
    # Decode HTML entities
    import html as html_mod
    html = html_mod.unescape(html)
    return _clean(html)


# ── Paragraph extraction ─────────────────────────────────────────────

# Patterns (anchored)
_RE_NUM   = re.compile(r"^[\(]?([0-9]+|[٠-٩]+)[\)]?\s*[-–—.]\s*(.+)$")
_RE_LET   = re.compile(r"^[\(]?([أ-ي]|جـ)[\)]?\s*[-–—.]\s*(.+)$")
_RE_ORD   = re.compile(
    r"^(أولاً?|ثانياً?|ثالثاً?|رابعاً?|خامساً?|سادساً?|سابعاً?|ثامناً?|تاسعاً?|عاشراً?)"
    r"\s*[:–—-]\s*(.+)$"
)


def _make_marker(raw, add_hyphen=True):
    """Ensure marker always ends with '-'."""
    raw = raw.strip()
    # Normalise dash variants inside marker
    raw = re.sub(r"[\s]*[–—−ـ\-][\s]*$", "", raw)
    if add_hyphen:
        return raw + "-"
    return raw


def _paras_from_text(text):
    """Split plain text into structured paragraphs with markers and levels."""
    if not text:
        return []
    paras = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue

        # 1) numbered: "1- …" / "(١) …"
        m = _RE_NUM.match(line)
        if m:
            paras.append({"marker": _make_marker(m.group(1)),
                          "text": m.group(2).strip(), "level": 1})
            continue
        # 2) lettered: "أ- …"
        m = _RE_LET.match(line)
        if m:
            paras.append({"marker": _make_marker(m.group(1)),
                          "text": m.group(2).strip(), "level": 2})
            continue
        # 3) ordinal: "أولاً: …"
        m = _RE_ORD.match(line)
        if m:
            paras.append({"marker": _make_marker(m.group(1), add_hyphen=False) + ":",
                          "text": m.group(2).strip(), "level": 1})
            continue
        # 4) plain
        paras.append({"marker": "", "text": line, "level": 0})
    return paras


def _paras_from_container(container):
    """
    Extract paragraphs from HTMLContainer.

    Strategy: ALWAYS use the full text (innerHTML→text) as the single
    source of truth for paragraph splitting.  This avoids span-fragment
    leakage entirely because inner <span> tags are stripped before we
    ever look at line boundaries.

    For <ol>/<li> we do a targeted DOM pass first so we can assign
    correct nesting levels; everything else goes through _paras_from_text.
    """
    if container is None:
        return []

    # ── Special handling for <ol> lists (need level info from DOM) ──
    ol_paras = []
    has_ol = False
    for child in container.children:
        if isinstance(child, Tag) and child.name == "ol":
            has_ol = True
            for idx, li in enumerate(child.find_all("li", recursive=False), 1):
                _parse_li(li, idx, ol_paras)
        elif isinstance(child, Tag) and child.name == "table":
            has_ol = True  # tables also need DOM
            # Extract table as structured data
            table_rows = []
            for tr in child.find_all("tr"):
                cells = [_clean(td.get_text(" ", strip=True))
                         for td in tr.find_all(["td", "th"])]
                cells = [c for c in cells if c]
                if cells:
                    table_rows.append(cells)
            if table_rows:
                ol_paras.append({
                    "marker": "",
                    "text": "",
                    "level": 0,
                    "type": "table",
                    "table_rows": table_rows
                })

    if has_ol and ol_paras:
        # Grab any intro text that appears BEFORE the first <ol>
        intro_parts = []
        for child in container.children:
            if isinstance(child, Tag) and child.name in ("ol", "table"):
                break
            if isinstance(child, Tag):
                t = _container_to_text(child)
            elif isinstance(child, NavigableString):
                t = _clean(str(child))
            else:
                continue
            if t and len(t.strip()) > 3:
                intro_parts.append(t.strip())

        result = []
        if intro_parts:
            result.extend(_paras_from_text("\n".join(intro_parts)))
        result.extend(ol_paras)

        # Grab any text AFTER the last <ol>/<table>
        after_parts = []
        past_last = False
        for child in reversed(list(container.children)):
            if isinstance(child, Tag) and child.name in ("ol", "table"):
                break
            if isinstance(child, Tag):
                t = _container_to_text(child)
            elif isinstance(child, NavigableString):
                t = _clean(str(child))
            else:
                continue
            if t and len(t.strip()) > 3:
                after_parts.insert(0, t.strip())

        if after_parts:
            result.extend(_paras_from_text("\n".join(after_parts)))

        return result

    # ── Default: text-based extraction (immune to span fragmentation) ──
    full_text = _container_to_text(container)
    return _paras_from_text(full_text)


def _parse_li(li, idx, paras):
    """Parse a single <li>, splitting sub-items on <br>.

    BOE uses <br> inside <li> to separate letter-keyed sub-items like:
       أ - text1 <br> ب - text2 <br> ج - text3
    We must split these into separate paragraphs at level 2.
    """
    import html as hmod
    # Convert to text via innerHTML to avoid span leaks
    raw_html = li.decode_contents()
    raw_html = re.sub(r"<br\s*/?>", "\n", raw_html, flags=re.I)
    raw_html = re.sub(r"<[^>]+>", " ", raw_html)
    text = _clean(hmod.unescape(raw_html))

    # Split on newlines
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return

    # Also try splitting the first "line" itself if it contains embedded
    # sub-items that weren't separated by <br> (e.g. "text أ - sub1 ب - sub2")
    all_lines = []
    for line in lines:
        # Split on letter-marker pattern mid-line
        parts = re.split(r"(?=(?:^|(?<=\s))[\(]?(?:[أ-ي]|جـ)[\)]?\s*[-–—.])", line)
        for p in parts:
            p = p.strip()
            if p:
                all_lines.append(p)

    if not all_lines:
        return

    # First segment: if it starts with a letter marker, the whole <li> is sub-items
    first = all_lines[0]
    first_is_letter = bool(_RE_LET.match(first))

    if first_is_letter:
        # All segments are sub-items under the <ol> parent numbering
        for line in all_lines:
            m = _RE_LET.match(line)
            if m:
                paras.append({"marker": _make_marker(m.group(1)),
                              "text": m.group(2).strip(), "level": 2})
            else:
                # Number sub-item or continuation
                mn = _RE_NUM.match(line)
                if mn:
                    paras.append({"marker": _make_marker(mn.group(1)),
                                  "text": mn.group(2).strip(), "level": 2})
                elif len(line) > 5:
                    paras.append({"marker": "", "text": line, "level": 2})
    else:
        # First line is the main numbered item
        main = first.rstrip(":").strip()
        paras.append({"marker": f"{idx}-", "text": main, "level": 1})

        # Rest are sub-items
        for line in all_lines[1:]:
            m = _RE_LET.match(line)
            if m:
                paras.append({"marker": _make_marker(m.group(1)),
                              "text": m.group(2).strip(), "level": 2})
            else:
                mn = _RE_NUM.match(line)
                if mn:
                    paras.append({"marker": _make_marker(mn.group(1)),
                                  "text": mn.group(2).strip(), "level": 2})
                elif len(line) > 5:
                    paras.append({"marker": "", "text": line, "level": 2})


# ── Metadata extraction ──────────────────────────────────────────────

def _extract_meta(soup):
    meta = {
        "name": "", "issue_date_hijri": "", "issue_date_gregorian": "",
        "publish_date_hijri": "", "publish_date_gregorian": "",
        "status": "ساري", "issuing_authority": "",
    }
    h1 = soup.find("h1")
    if h1:
        meta["name"] = _clean(h1.get_text(strip=True))

    for label in soup.find_all("label"):
        lt = label.get_text(strip=True)
        sib = label.find_next_sibling()
        if not sib:
            continue
        val = sib.get_text(strip=True)
        if "الاسم" in lt and not meta["name"]:
            meta["name"] = _clean(val)
        elif "تاريخ الإصدار" in lt:
            h = re.search(r"(\d{4}/\d{2}/\d{2})\s*هـ", val)
            g = re.search(r"(\d{2}/\d{2}/\d{4})\s*م", val)
            if h: meta["issue_date_hijri"] = h.group(1)
            if g: meta["issue_date_gregorian"] = g.group(1)
        elif "تاريخ النشر" in lt:
            h = re.search(r"(\d{4}/\d{2}/\d{2})\s*هـ", val)
            g = re.search(r"(\d{2}/\d{2}/\d{4})\s*م", val)
            if h: meta["publish_date_hijri"] = h.group(1)
            if g: meta["publish_date_gregorian"] = g.group(1)
        elif "الحالة" in lt:
            meta["status"] = _clean(val)
        elif "أدوات إصدار" in lt or "أداة الإصدار" in lt:
            meta["issuing_authority"] = _clean(val)
    return meta


# ── Structural headings ──────────────────────────────────────────────

_STRUCT_KW = ["الباب", "الفصل", "المبحث", "القسم", "الجزء", "الملحق"]
_STRUCT_ORDER = {"الباب": 0, "الجزء": 0, "القسم": 1, "الفصل": 1, "المبحث": 2, "الملحق": 0}


def _is_structural(text):
    for kw in _STRUCT_KW:
        if text.startswith(kw) or (":" in text and kw in text.split(":")[0]):
            return kw
    return None


# ── Amendment extraction ─────────────────────────────────────────────

def _extract_amendments(article_div, soup):
    amendments = []
    link = article_div.find("a", class_="ancArticlePrevVersions")
    if not link:
        return amendments
    aid = link.get("data-articleid")
    if not aid:
        return amendments
    popup = soup.find("div", class_=aid)
    if not popup:
        return amendments

    for item in popup.find_all("div", class_="article_item_popup"):
        amd = {}
        h3 = item.find("h3")
        if h3:
            amd["article_title"] = _clean(h3.get_text(strip=True))
        hc = item.find("div", class_="HTMLContainer")
        if hc:
            # Build content_parts: ordered list of {type:"text",text:...} and {type:"table",table_rows:...}
            # by walking direct children of the container in DOM order.
            # This preserves the original position of tables within the text.
            content_parts = []
            text_buffer = []

            def _flush_text():
                if text_buffer:
                    combined = "\n".join(text_buffer)
                    cleaned = _clean(combined)
                    if cleaned:
                        content_parts.append({"type": "text", "text": cleaned})
                    text_buffer.clear()

            # Walk the innerHTML in DOM order
            import html as _hmod
            raw_html = hc.decode_contents()
            # Split on <table...>...</table> boundaries while preserving order
            table_split = re.split(r"(<table[\s\S]*?</table>)", raw_html, flags=re.I)
            for part in table_split:
                part_stripped = part.strip()
                if not part_stripped:
                    continue
                if re.match(r"<table", part_stripped, re.I):
                    # This is a table segment — flush any pending text, then extract table rows
                    _flush_text()
                    tbl_soup = BeautifulSoup(part_stripped, "html.parser")
                    tbl_tag = tbl_soup.find("table")
                    if tbl_tag:
                        rows = []
                        for tr in tbl_tag.find_all("tr"):
                            cells = [_clean(td.get_text(" ", strip=True))
                                     for td in tr.find_all(["td", "th"])]
                            cells = [c for c in cells if c]
                            if cells:
                                rows.append(cells)
                        if rows:
                            content_parts.append({"type": "table", "table_rows": rows})
                else:
                    # This is a text segment — convert HTML to text
                    h = part_stripped
                    h = re.sub(r"<br\s*/?>", "\n", h, flags=re.I)
                    h = re.sub(r"</p>", "\n", h, flags=re.I)
                    h = re.sub(r"<p[^>]*>", "", h, flags=re.I)
                    h = re.sub(r"</li>", "\n", h, flags=re.I)
                    h = re.sub(r"<[^>]+>", " ", h)
                    h = _hmod.unescape(h)
                    text_buffer.append(h)
            _flush_text()

            amd["content_parts"] = content_parts

            # Also keep a flat description for metadata extraction (decree, date, etc.)
            t = _container_to_text(hc, strip_tables=True)
            amd["description"] = t
            # decree
            dm = re.search(r"(?:الأمر|المرسوم)\s+الملكي?\s+رقم\s+[\(]?([^\)]+)[\)]?", t)
            if dm:
                amd["decree"] = _clean(dm.group(1))
            # date
            dtm = re.search(r"تاريخ\s+([٠-٩\d]+\s*/\s*[٠-٩\d]+\s*/\s*[٠-٩\d]+)", t)
            if dtm:
                amd["date"] = dtm.group(1).translate(_HINDI).strip()
            # source
            if "مرسوم ملكي" in t or "أمر ملكي" in t:
                amd["source"] = "مرسوم ملكي"
            elif "قرار مجلس الوزراء" in t:
                amd["source"] = "قرار مجلس الوزراء"
            # affected paragraph
            pm = re.search(r"الفقرة\s+(?:\(\s*([^)]+)\s*\)|([أ-ي]|\d+))", t)
            if pm:
                amd["affected_paragraph"] = (pm.group(1) or pm.group(2)).strip()
            # new text
            if "لتكون" in t:
                parts = t.split("لتكون", 1)
                if len(parts) > 1:
                    nt = re.sub(r"^بالنص الآت[يى]\s*:?\s*", "", parts[1].strip())
                    qm = re.search(r'"([^"]+)"', nt)
                    amd["new_text"] = _clean(qm.group(1) if qm else nt[:500])

        # PDF
        pdf = item.find("a", href=re.compile(r"/Files/Download|\.pdf", re.I))
        if pdf:
            href = pdf["href"]
            amd["pdf_url"] = (BASE_URL + href) if href.startswith("/") else href
            amd["pdf_label"] = _clean(pdf.get_text(strip=True))

        if amd:
            amendments.append(amd)
    return amendments


# ── Single article parser ────────────────────────────────────────────

def _parse_article(adiv, soup):
    classes = " ".join(adiv.get("class", []))
    status = "active"
    if "canceled" in classes:
        status = "canceled"
    elif "changed-article" in classes:
        status = "amended"

    # Number
    h3 = adiv.find("h3")
    number_text = _clean(h3.get_text(strip=True)) if h3 else ""
    number = _arabic_num(number_text) if "المادة" in number_text else None

    # Find the main HTMLContainer (NOT inside popup-list)
    hc = None
    for c in adiv.find_all("div", class_="HTMLContainer"):
        if c.find_parent("div", class_="popup-list") is None:
            hc = c
            break

    if hc is None:
        return None

    # Extract text via dual-path
    text_path_a = _container_to_text(hc)             # innerHTML path (reliable)
    # paragraphs from DOM
    paragraphs = _paras_from_container(hc)

    # If DOM paragraphs seem incomplete, fall back to text-based
    dom_len = sum(len(p["text"]) for p in paragraphs)
    if text_path_a and dom_len < len(text_path_a) * 0.5:
        paragraphs = _paras_from_text(text_path_a)

    # Amendments
    amendments = _extract_amendments(adiv, soup) if status == "amended" else []

    art = {
        "number": number,
        "number_text": number_text,
        "text": text_path_a,
        "original_text": text_path_a,
        "status": status,
        "paragraphs": paragraphs,
        "amendments": amendments,
    }

    if status == "canceled":
        art["tags"] = ["ملغاة"]
    elif status == "amended":
        art["tags"] = ["معدلة"]
        if amendments:
            art["notes_ar"] = f"تم تعديل هذه المادة {len(amendments)} مرة"

    # ── Quality gates ──
    flags = []
    if text_path_a and len(text_path_a.strip()) < 20 and status != "canceled":
        flags.append("suspected_short")
    # Scramble: unexpected article heading inside body
    if text_path_a and number is not None:
        inner_heads = re.findall(r"المادة\s+(ال[أ-ي]+)", text_path_a)
        if len(inner_heads) > 1:
            flags.append("suspected_scramble")
    if flags:
        art["quality_flags"] = flags

    return art


# ── Full law page parser ─────────────────────────────────────────────

def _parse_law(html, law_id):
    soup = BeautifulSoup(html, "html.parser")

    meta = _extract_meta(soup)

    # Preamble / royal decree
    royal_decree = {}
    all_article_divs = [d for d in soup.find_all("div", class_=re.compile(r"^article_item"))
                        if "article_item_popup" not in d.get("class", [])]

    if all_article_divs:
        for elem in all_article_divs[0].find_all_previous("div", class_="HTMLContainer"):
            t = _container_to_text(elem)
            if t and ("بعون الله" in t or "بسم الله" in t or "مرسوم ملكي" in t or "أمر ملكي" in t):
                royal_decree["text"] = t
                dm = re.search(
                    r"(?:أمر|مرسوم)\s+ملكي\s+رقم\s+([^\s]+)\s+(?:بتاريخ|وتاريخ)\s+([٠-٩\d\s/]+)", t)
                if dm:
                    royal_decree["number"] = _clean(dm.group(1))
                    royal_decree["date_hijri"] = dm.group(2).translate(_HINDI).strip()
                break

    # Structural headings
    structures = []
    for h3 in soup.find_all("h3"):
        t = _clean(h3.get_text(strip=True))
        kw = _is_structural(t)
        if kw:
            structures.append({"type": kw, "text": t})

    # Articles
    heading_stack = []
    articles = []
    for adiv in all_article_divs:
        # Update heading context
        for prev_h3 in adiv.find_all_previous("h3"):
            t = _clean(prev_h3.get_text(strip=True))
            kw = _is_structural(t)
            if kw:
                lvl = _STRUCT_ORDER.get(kw, 0)
                heading_stack = heading_stack[:lvl]
                while len(heading_stack) <= lvl:
                    heading_stack.append(None)
                heading_stack[lvl] = t
                break

        art = _parse_article(adiv, soup)
        if art is None:
            continue
        art["heading_context"] = [h for h in heading_stack if h]
        articles.append(art)

    law = {
        "law_id": law_id,
        "law_name": meta["name"],
        "title": meta["name"],
        "jurisdiction_ar": "السعودية",
        "doc_type": "official_text",
        "category": "law",
        "primary_source_id": "boe",
        "status": meta["status"],
        "issue_date_hijri": meta["issue_date_hijri"],
        "issue_date_gregorian": meta["issue_date_gregorian"],
        "publish_date_hijri": meta["publish_date_hijri"],
        "publish_date_gregorian": meta["publish_date_gregorian"],
        "issuing_authority": meta["issuing_authority"],
        "links": [{
            "source_id": "boe",
            "url": f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1",
            "label_ar": "النص الرسمي - هيئة الخبراء"
        }],
        "total_articles": len(articles),
        "articles": articles,
    }
    if royal_decree:
        law["royal_decree"] = royal_decree
    if structures:
        law["structure"] = structures
    return law


# ── Network helpers ───────────────────────────────────────────────────

def _get_folder_laws(fid):
    r = sess.get(f"{BASE_URL}/BoeLaws/Laws/Folders/{fid}", timeout=30)
    soup = BeautifulSoup(r.text, "html.parser")
    seen, laws = set(), []
    for a in soup.find_all("a", href=re.compile(r"/BoeLaws/Laws/LawDetails/")):
        m = re.search(r"/LawDetails/([a-f0-9-]+)/", a["href"])
        if m and m.group(1) not in seen:
            seen.add(m.group(1))
            laws.append({"id": m.group(1), "name": _clean(a.get_text(strip=True))})
    return laws


def _extract_one(law_id, name, idx, total):
    print(f"  [{idx}/{total}] {name[:50]}...", end=" ", flush=True)
    try:
        r = sess.get(f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1", timeout=30)
        if r.status_code != 200:
            print(f"HTTP {r.status_code}")
            return None

        law = _parse_law(r.text, law_id)

        # Download amendment PDFs
        pdf_n = 0
        for art in law.get("articles", []):
            for amd in art.get("amendments", []):
                if "pdf_url" in amd:
                    try:
                        fn = f"{law_id}_art{art.get('number','x')}_{pdf_n}.pdf"
                        fp = PDF_DIR / fn
                        if not fp.exists():
                            pr = sess.get(amd["pdf_url"], timeout=30)
                            if pr.status_code == 200 and len(pr.content) > 100:
                                fp.write_bytes(pr.content)
                                amd["pdf_local_path"] = f"amendments_pdf/{fn}"
                                pdf_n += 1
                    except Exception:
                        pass

        # Save
        out = LAWS_DIR / f"{law_id}_boe.json"
        out.write_text(json.dumps(law, ensure_ascii=False, indent=2), encoding="utf-8")

        na = len(law["articles"])
        na_amd = sum(1 for a in law["articles"] if a["status"] == "amended")
        na_cnl = sum(1 for a in law["articles"] if a["status"] == "canceled")
        flags  = sum(1 for a in law["articles"] if a.get("quality_flags"))
        info = f"{na} art"
        if na_amd: info += f", {na_amd} amended"
        if na_cnl: info += f", {na_cnl} canceled"
        if pdf_n:  info += f", {pdf_n} PDFs"
        if flags:  info += f", {flags} flagged"
        print(f"OK ({info})")
        return law

    except Exception as e:
        print(f"ERROR: {e}")
        return None


# ── Index / library update ────────────────────────────────────────────

def _update_indexes(laws):
    # library.json
    lib = []
    if LIB_FILE.exists():
        lib = json.loads(LIB_FILE.read_text(encoding="utf-8"))
    lib = [e for e in lib if e.get("primary_source_id") != "boe"]   # remove old BOE

    # Also keep special manual entries
    for law in laws:
        lid = law["law_id"]
        amd_c = sum(1 for a in law["articles"] if a["status"] == "amended")
        entry = {
            "id": lid,
            "title_ar": law["law_name"],
            "jurisdiction_ar": "السعودية",
            "doc_type": "official_text",
            "category": "law",
            "primary_source_id": "boe",
            "links": [{"source_id": "boe",
                        "url": f"{BASE_URL}/BoeLaws/Laws/LawDetails/{lid}/1",
                        "label_ar": "النص الرسمي - هيئة الخبراء"}],
        }
        if amd_c:
            entry["notes_ar"] = f"يحتوي على {amd_c} تعديل"
        lib.append(entry)

    LIB_FILE.write_text(json.dumps(lib, ensure_ascii=False, indent=2), encoding="utf-8")

    # boe_laws_index.json
    idx = []
    for law in laws:
        lid = law["law_id"]
        idx.append({
            "id": lid,
            "title": law["law_name"],
            "source": "boe",
            "article_count": law["total_articles"],
            "has_amendments": any(a["status"] == "amended" for a in law["articles"]),
            "status": law.get("status", "ساري"),
            "issue_date_hijri": law.get("issue_date_hijri", ""),
            "url": f"{BASE_URL}/BoeLaws/Laws/LawDetails/{lid}/1",
        })
    IDX_FILE.write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8")

    return len(lib), len(idx)


# ── Main ─────────────────────────────────────────────────────────────

def main():
    print("=" * 65)
    print("  BOE Folder-1 Extractor v2")
    print(f"  Target: first {MAX_LAWS} laws")
    print("=" * 65)

    print("\n[1/4] Fetching law list from Folder 1...")
    all_laws = _get_folder_laws(FOLDER_ID)
    print(f"  Found {len(all_laws)} laws in Folder 1")

    target = all_laws[:MAX_LAWS]

    print(f"\n[2/4] Extracting {len(target)} laws...")
    extracted = []
    for i, law in enumerate(target, 1):
        d = _extract_one(law["id"], law["name"], i, len(target))
        if d:
            extracted.append(d)
        time.sleep(0.5)

    print(f"\n[3/4] Updating indexes...")
    nl, ni = _update_indexes(extracted)
    print(f"  library.json: {nl} entries")
    print(f"  boe_laws_index.json: {ni} entries")

    # Dist sync
    import shutil
    dist_laws = PROJECT / "dist" / "public" / "data" / "laws"
    dist_data = PROJECT / "dist" / "public" / "data"
    if dist_data.exists():
        # Remove old BOE from dist
        for f in dist_laws.glob("*_boe.json"):
            f.unlink()
        # Copy new
        for f in LAWS_DIR.glob("*_boe.json"):
            shutil.copy2(f, dist_laws / f.name)
        shutil.copy2(LIB_FILE, dist_data / "library.json")
        shutil.copy2(IDX_FILE, dist_data / "boe_laws_index.json")
        print("  Synced to dist/")

    # Summary
    ta = sum(len(l["articles"]) for l in extracted)
    tamd = sum(sum(1 for a in l["articles"] if a["status"] == "amended") for l in extracted)
    tcnl = sum(sum(1 for a in l["articles"] if a["status"] == "canceled") for l in extracted)
    tamds = sum(sum(len(a.get("amendments",[])) for a in l["articles"]) for l in extracted)
    tflags = sum(sum(1 for a in l["articles"] if a.get("quality_flags")) for l in extracted)

    print(f"\n[4/4] Summary:")
    print(f"  Laws extracted : {len(extracted)}")
    print(f"  Total articles : {ta}")
    print(f"  Amended        : {tamd}")
    print(f"  Canceled       : {tcnl}")
    print(f"  Amendments     : {tamds}")
    print(f"  Quality flags  : {tflags}")
    print("=" * 65)
    print("  Done!")
    print("=" * 65)


if __name__ == "__main__":
    main()
