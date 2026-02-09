#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BOE Full Extractor — All Folders
=================================
Extracts ALL laws from https://laws.boe.gov.sa across all 4 categories.
Integrates cabinet decision extraction and has resume capability.

Based on extract_folder1_laws.py (the proven 30-law pipeline) with:
  - All 4 BOE folder categories
  - Cabinet decision extraction inline (no separate pass)
  - Resume: skips laws that already have a _boe.json file
  - Progress tracking to a state file
  - Batch-friendly: can be interrupted and resumed

Usage:
  python scripts/extract_all_boe.py              # Extract all folders
  python scripts/extract_all_boe.py --folder 1   # Extract folder 1 only (أنظمة أساسية)
  python scripts/extract_all_boe.py --resume      # Only extract missing laws
"""

import sys, io, os, re, json, time, argparse
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
BASE_URL = "https://laws.boe.gov.sa"

# The 4 BOE categories with their folder page numbers
# Folder listing works with /BoeLaws/Laws/Folders/{N} where N = 1,2,3,4
BOE_FOLDERS = [
    {"id": 1, "name_ar": "أنظمة أساسية"},
    {"id": 2, "name_ar": "أنظمة عادية"},
    {"id": 3, "name_ar": "لوائح وما في حكمها"},
    {"id": 4, "name_ar": "تنظيمات، وترتيبات تنظيمية"},
]

PROJECT   = Path(__file__).resolve().parent.parent
LAWS_DIR  = PROJECT / "client" / "public" / "data" / "laws"
PDF_DIR   = PROJECT / "client" / "public" / "data" / "amendments_pdf"
LIB_FILE  = PROJECT / "client" / "public" / "data" / "library.json"
IDX_FILE  = PROJECT / "client" / "public" / "data" / "boe_laws_index.json"
STATE_FILE = PROJECT / "scripts" / "extraction_state.json"

LAWS_DIR.mkdir(parents=True, exist_ok=True)
PDF_DIR.mkdir(parents=True, exist_ok=True)

sess = requests.Session()
sess.verify = False
sess.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html",
    "Accept-Language": "ar",
})

# ── Arabic helpers (from extract_folder1_laws.py) ─────────────────────
_HINDI = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

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
for otext, oval in _ones:
    for ttext, tval in _tens:
        if tval == 20:
            _ORDINALS.append((f"{otext} عشرة", oval + 10))
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
_ORDINALS.sort(key=lambda x: -len(x[0]))


def _arabic_num(text):
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
    if not text:
        return ""
    text = text.replace("\u0640", "")
    text = re.sub(r"[\u200b-\u200f\ufeff]", "", text)
    lines = []
    for ln in text.split("\n"):
        ln = " ".join(ln.split())
        if ln:
            lines.append(ln)
    return "\n".join(lines)


# ── HTML → plain text ─────────────────────────────────────────────────
def _container_to_text(container, strip_tables=False):
    if container is None:
        return ""
    html = container.decode_contents()
    if strip_tables:
        html = re.sub(r"<table[\s\S]*?</table>", "\n", html, flags=re.I)
    html = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    html = re.sub(r"</p>", "\n", html, flags=re.I)
    html = re.sub(r"<p[^>]*>", "", html, flags=re.I)
    html = re.sub(r"</li>", "\n", html, flags=re.I)
    html = re.sub(r"</tr>", "\n", html, flags=re.I)
    html = re.sub(r"<t[dh][^>]*>", "  ", html, flags=re.I)
    html = re.sub(r"<[^>]+>", " ", html)
    import html as html_mod
    html = html_mod.unescape(html)
    return _clean(html)


# ── Paragraph extraction ─────────────────────────────────────────────
_RE_NUM = re.compile(r"^[\(]?([0-9]+|[٠-٩]+)[\)]?\s*[-–—.]\s*(.+)$")
_RE_LET = re.compile(r"^[\(]?([أ-ي]|جـ)[\)]?\s*[-–—.]\s*(.+)$")
_RE_ORD = re.compile(
    r"^(أولاً?|ثانياً?|ثالثاً?|رابعاً?|خامساً?|سادساً?|سابعاً?|ثامناً?|تاسعاً?|عاشراً?)"
    r"\s*[:–—-]\s*(.+)$"
)


def _make_marker(raw, add_hyphen=True):
    raw = raw.strip()
    raw = re.sub(r"[\s]*[–—−ـ\-][\s]*$", "", raw)
    if add_hyphen:
        return raw + "-"
    return raw


def _paras_from_text(text):
    if not text:
        return [{"marker": "", "text": "", "level": 0}]
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    paras = []
    for line in lines:
        m = _RE_ORD.match(line)
        if m:
            paras.append({"marker": m.group(1).strip() + ":", "text": m.group(2).strip(), "level": 0})
            continue
        m = _RE_NUM.match(line)
        if m:
            paras.append({"marker": _make_marker(m.group(1)), "text": m.group(2).strip(), "level": 1})
            continue
        m = _RE_LET.match(line)
        if m:
            paras.append({"marker": _make_marker(m.group(1)), "text": m.group(2).strip(), "level": 2})
            continue
        paras.append({"marker": "", "text": line, "level": 0})
    return paras if paras else [{"marker": "", "text": text, "level": 0}]


def _paras_from_container(container):
    ol_paras = []
    has_ol = False
    for child in container.children:
        if isinstance(child, Tag) and child.name in ("ol", "ul"):
            has_ol = True
            for idx, li in enumerate(child.find_all("li", recursive=False), 1):
                _parse_li(li, idx, ol_paras)
        elif isinstance(child, Tag) and child.name == "table":
            has_ol = True
            table_rows = []
            for tr in child.find_all("tr"):
                cells = [_clean(td.get_text(" ", strip=True)) for td in tr.find_all(["td", "th"])]
                cells = [c for c in cells if c]
                if cells:
                    table_rows.append(cells)
            if table_rows:
                ol_paras.append({"marker": "", "text": "", "level": 0, "type": "table", "table_rows": table_rows})

    if has_ol and ol_paras:
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
        after_parts = []
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
    full_text = _container_to_text(container)
    return _paras_from_text(full_text)


def _parse_li(li, idx, paras):
    import html as hmod
    raw_html = li.decode_contents()
    raw_html = re.sub(r"<br\s*/?>", "\n", raw_html, flags=re.I)
    raw_html = re.sub(r"<[^>]+>", " ", raw_html)
    text = _clean(hmod.unescape(raw_html))
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return
    all_lines = []
    for line in lines:
        parts = re.split(r"(?=(?:^|(?<=\s))[\(]?(?:[أ-ي]|جـ)[\)]?\s*[-–—.])", line)
        for p in parts:
            p = p.strip()
            if p:
                all_lines.append(p)
    if not all_lines:
        return
    first = all_lines[0]
    first_is_letter = bool(_RE_LET.match(first))
    if first_is_letter:
        for line in all_lines:
            m = _RE_LET.match(line)
            if m:
                paras.append({"marker": _make_marker(m.group(1)), "text": m.group(2).strip(), "level": 2})
            else:
                mn = _RE_NUM.match(line)
                if mn:
                    paras.append({"marker": _make_marker(mn.group(1)), "text": mn.group(2).strip(), "level": 2})
                elif len(line) > 5:
                    paras.append({"marker": "", "text": line, "level": 2})
    else:
        first_line = all_lines[0]
        mn = _RE_NUM.match(first_line)
        mo = _RE_ORD.match(first_line)
        if mo:
            paras.append({"marker": mo.group(1).strip() + ":", "text": mo.group(2).strip(), "level": 0})
        elif mn:
            paras.append({"marker": _make_marker(mn.group(1)), "text": mn.group(2).strip(), "level": 1})
        else:
            paras.append({"marker": _make_marker(str(idx)), "text": first_line, "level": 1})
        for line in all_lines[1:]:
            m = _RE_LET.match(line)
            if m:
                paras.append({"marker": _make_marker(m.group(1)), "text": m.group(2).strip(), "level": 2})
            else:
                mn2 = _RE_NUM.match(line)
                if mn2:
                    paras.append({"marker": _make_marker(mn2.group(1)), "text": mn2.group(2).strip(), "level": 2})
                elif len(line) > 5:
                    paras.append({"marker": "", "text": line, "level": 1})


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
            content_parts = []
            text_buffer = []
            def _flush_text():
                if text_buffer:
                    combined = "\n".join(text_buffer)
                    cleaned = _clean(combined)
                    if cleaned:
                        content_parts.append({"type": "text", "text": cleaned})
                    text_buffer.clear()
            import html as _hmod
            raw_html = hc.decode_contents()
            table_split = re.split(r"(<table[\s\S]*?</table>)", raw_html, flags=re.I)
            for part in table_split:
                part_stripped = part.strip()
                if not part_stripped:
                    continue
                if re.match(r"<table", part_stripped, re.I):
                    _flush_text()
                    tbl_soup = BeautifulSoup(part_stripped, "html.parser")
                    tbl_tag = tbl_soup.find("table")
                    if tbl_tag:
                        rows = []
                        for tr in tbl_tag.find_all("tr"):
                            cells = [_clean(td.get_text(" ", strip=True)) for td in tr.find_all(["td", "th"])]
                            cells = [c for c in cells if c]
                            if cells:
                                rows.append(cells)
                        if rows:
                            content_parts.append({"type": "table", "table_rows": rows})
                else:
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
            t = _container_to_text(hc, strip_tables=True)
            amd["description"] = t
            dm = re.search(r"(?:الأمر|المرسوم)\s+الملكي?\s+رقم\s+[\(]?([^\)]+)[\)]?", t)
            if dm:
                amd["decree"] = _clean(dm.group(1))
            dtm = re.search(r"تاريخ\s+([٠-٩\d]+\s*/\s*[٠-٩\d]+\s*/\s*[٠-٩\d]+)", t)
            if dtm:
                amd["date"] = dtm.group(1).translate(_HINDI).strip()
            if "مرسوم ملكي" in t or "أمر ملكي" in t:
                amd["source"] = "مرسوم ملكي"
            elif "قرار مجلس الوزراء" in t:
                amd["source"] = "قرار مجلس الوزراء"
            pm = re.search(r"الفقرة\s+(?:\(\s*([^)]+)\s*\)|([أ-ي]|\d+))", t)
            if pm:
                amd["affected_paragraph"] = (pm.group(1) or pm.group(2)).strip()
            if "لتكون" in t:
                parts = t.split("لتكون", 1)
                if len(parts) > 1:
                    nt = re.sub(r"^بالنص الآت[يى]\s*:?\s*", "", parts[1].strip())
                    qm = re.search(r'"([^"]+)"', nt)
                    amd["new_text"] = _clean(qm.group(1) if qm else nt[:500])
        pdf = item.find("a", href=re.compile(r"/Files/Download|\.pdf", re.I))
        if pdf:
            href = pdf["href"]
            amd["pdf_url"] = (BASE_URL + href) if href.startswith("/") else href
            amd["pdf_label"] = _clean(pdf.get_text(strip=True))
        if amd:
            amendments.append(amd)
    return amendments


# ── Article parser ───────────────────────────────────────────────────
def _parse_article(adiv, soup):
    classes = " ".join(adiv.get("class", []))
    status = "active"
    if "canceled" in classes:
        status = "canceled"
    elif "changed-article" in classes:
        status = "amended"

    h3 = adiv.find("h3")
    number_text = _clean(h3.get_text(strip=True)) if h3 else ""
    number = _arabic_num(number_text) if "المادة" in number_text else None

    hc = None
    for c in adiv.find_all("div", class_="HTMLContainer"):
        if c.find_parent("div", class_="popup-list") is None:
            hc = c
            break
    if hc is None:
        return None

    text_path_a = _container_to_text(hc)
    paragraphs = _paras_from_container(hc)

    dom_len = sum(len(p["text"]) for p in paragraphs)
    if text_path_a and dom_len < len(text_path_a) * 0.5:
        paragraphs = _paras_from_text(text_path_a)

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

    flags = []
    if text_path_a and len(text_path_a.strip()) < 20 and status != "canceled":
        flags.append("suspected_short")
    if text_path_a and number is not None:
        inner_heads = re.findall(r"المادة\s+(ال[أ-ي]+)", text_path_a)
        if len(inner_heads) > 1:
            flags.append("suspected_scramble")
    if flags:
        art["quality_flags"] = flags
    return art


# ── Cabinet decision extraction (integrated) ─────────────────────────
def _extract_cabinet_decision(soup):
    """Extract cabinet decision from the already-parsed soup.
    Returns the full text string, or None."""
    article_divs = [d for d in soup.find_all("div", class_=re.compile(r"^article_item"))
                    if "article_item_popup" not in d.get("class", [])]
    if not article_divs:
        return None

    first_article = article_divs[0]
    parent = first_article.parent
    if not parent:
        return None

    cabinet_header = None
    cabinet_body_parts = []
    in_cabinet_section = False

    for child in parent.children:
        if child == first_article:
            break
        if not hasattr(child, 'get_text'):
            continue
        text = child.get_text(strip=True)
        if not text:
            continue
        tag = child.name or ''

        if tag in ('h4', 'h3', 'h2') and 'قرار' in text and 'مجلس الوزراء' in text:
            cabinet_header = text
            in_cabinet_section = True
            cabinet_body_parts = []
            continue

        if in_cabinet_section:
            if tag in ('h3', 'h4', 'h2') and 'بسم الله' not in text:
                break
            if tag == 'div' and 'HTMLContainer' not in (child.get('class') or []):
                break
            if 'بسم الله الرحمن الرحيم' in text and len(text) < 30:
                continue
            # Extract clean text preserving line breaks
            elem_copy = BeautifulSoup(str(child), 'html.parser')
            for br in elem_copy.find_all('br'):
                br.replace_with('\n')
            body_text = elem_copy.get_text(separator=' ', strip=False)
            body_lines = [' '.join(line.split()) for line in body_text.split('\n') if line.strip()]
            body_text = '\n'.join(body_lines)
            if body_text:
                cabinet_body_parts.append(body_text)

    if cabinet_header and cabinet_body_parts:
        return cabinet_header + '\n' + '\n'.join(cabinet_body_parts)
    elif cabinet_header:
        return cabinet_header
    return None


# ── Full law page parser ─────────────────────────────────────────────
def _parse_law(html, law_id):
    soup = BeautifulSoup(html, "html.parser")
    meta = _extract_meta(soup)

    # Royal decree
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

    # Cabinet decision (integrated extraction)
    cabinet_text = _extract_cabinet_decision(soup)

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
        "links": [{"source_id": "boe",
                    "url": f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1",
                    "label_ar": "النص الرسمي - هيئة الخبراء"}],
        "total_articles": len(articles),
        "articles": articles,
    }
    if royal_decree:
        law["royal_decree"] = royal_decree
    if cabinet_text:
        law["cabinet_decision_text"] = cabinet_text
    if structures:
        law["structure"] = structures
    return law


# ── Network helpers ──────────────────────────────────────────────────
def _get_folder_laws(fid):
    """Fetch all law IDs from a BOE folder page."""
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
    """Extract a single law and save to JSON."""
    print(f"  [{idx}/{total}] {name[:55]}...", end=" ", flush=True)
    try:
        r = sess.get(f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1", timeout=30)
        if r.status_code != 200:
            print(f"HTTP {r.status_code}")
            return None
        r.encoding = 'utf-8'

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
        has_cd = bool(law.get("cabinet_decision_text"))
        info = f"{na} art"
        if na_amd: info += f", {na_amd} amd"
        if na_cnl: info += f", {na_cnl} cnl"
        if has_cd: info += ", +CD"
        print(f"OK ({info})")
        return law

    except Exception as e:
        print(f"ERROR: {e}")
        return None


# ── Index / library update ───────────────────────────────────────────
def _update_indexes():
    """Rebuild library.json and boe_laws_index.json from all _boe.json files."""
    boe_files = sorted(LAWS_DIR.glob("*_boe.json"))

    # Load existing library (keep non-BOE entries)
    lib = []
    if LIB_FILE.exists():
        lib = json.loads(LIB_FILE.read_text(encoding="utf-8"))
    lib = [e for e in lib if e.get("primary_source_id") != "boe"]

    idx = []
    for f in boe_files:
        law = json.loads(f.read_text(encoding="utf-8"))
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

    LIB_FILE.write_text(json.dumps(lib, ensure_ascii=False, indent=2), encoding="utf-8")
    IDX_FILE.write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8")

    # Dist sync
    import shutil
    dist_laws = PROJECT / "dist" / "public" / "data" / "laws"
    dist_data = PROJECT / "dist" / "public" / "data"
    if dist_data.exists():
        for f in dist_laws.glob("*_boe.json"):
            f.unlink()
        for f in LAWS_DIR.glob("*_boe.json"):
            shutil.copy2(f, dist_laws / f.name)
        shutil.copy2(LIB_FILE, dist_data / "library.json")
        shutil.copy2(IDX_FILE, dist_data / "boe_laws_index.json")
        print("  Synced to dist/")

    return len(lib), len(idx)


# ── State management ─────────────────────────────────────────────────
def _load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"extracted": [], "errors": [], "last_folder": None}

def _save_state(state):
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Main ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Extract all BOE laws")
    parser.add_argument("--folder", type=int, help="Extract specific folder only (1-4)")
    parser.add_argument("--resume", action="store_true", help="Skip already-extracted laws")
    parser.add_argument("--limit", type=int, default=0, help="Limit laws per folder (0=all)")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between requests (seconds)")
    args = parser.parse_args()

    # Always resume by default (skip existing files)
    resume = True

    folders = BOE_FOLDERS
    if args.folder:
        folders = [f for f in BOE_FOLDERS if f["id"] == args.folder]
        if not folders:
            print(f"ERROR: folder {args.folder} not found. Use 1-4.")
            return

    print("=" * 65)
    print("  BOE Full Extractor")
    print(f"  Folders: {', '.join(f['name_ar'] for f in folders)}")
    print(f"  Resume: {resume} | Limit: {args.limit or 'all'} | Delay: {args.delay}s")
    print("=" * 65)

    state = _load_state()
    existing_ids = set()
    if resume:
        for f in LAWS_DIR.glob("*_boe.json"):
            existing_ids.add(f.stem.replace("_boe", ""))
        print(f"\n  Already extracted: {len(existing_ids)} laws")

    total_extracted = 0
    total_errors = 0
    total_skipped = 0

    for folder in folders:
        fid = folder["id"]
        fname = folder["name_ar"]
        print(f"\n{'─' * 65}")
        print(f"  Folder {fid}: {fname}")
        print(f"{'─' * 65}")

        print(f"  Fetching law list...")
        try:
            all_laws = _get_folder_laws(fid)
        except Exception as e:
            print(f"  ERROR fetching folder: {e}")
            total_errors += 1
            continue
        print(f"  Found {len(all_laws)} laws in this folder")

        # Filter out already-extracted
        if resume:
            to_extract = [l for l in all_laws if l["id"] not in existing_ids]
            skipped = len(all_laws) - len(to_extract)
            total_skipped += skipped
            if skipped:
                print(f"  Skipping {skipped} already-extracted laws")
        else:
            to_extract = all_laws

        if args.limit:
            to_extract = to_extract[:args.limit]

        if not to_extract:
            print(f"  Nothing to extract in this folder")
            continue

        print(f"  Extracting {len(to_extract)} laws...\n")

        for i, law_info in enumerate(to_extract, 1):
            d = _extract_one(law_info["id"], law_info["name"], i, len(to_extract))
            if d:
                total_extracted += 1
                existing_ids.add(law_info["id"])
                state["extracted"].append(law_info["id"])
            else:
                total_errors += 1
                state["errors"].append(law_info["id"])

            # Save state periodically
            if i % 10 == 0:
                state["last_folder"] = fid
                _save_state(state)

            time.sleep(args.delay)

        state["last_folder"] = fid
        _save_state(state)

    # Update indexes with ALL extracted laws
    print(f"\n{'─' * 65}")
    print(f"  Updating indexes...")
    nl, ni = _update_indexes()
    print(f"  library.json: {nl} entries")
    print(f"  boe_laws_index.json: {ni} entries")

    # Final summary
    print(f"\n{'=' * 65}")
    print(f"  SUMMARY")
    print(f"  New extractions : {total_extracted}")
    print(f"  Skipped (exist) : {total_skipped}")
    print(f"  Errors          : {total_errors}")
    print(f"  Total in library: {nl}")
    print(f"{'=' * 65}")


if __name__ == "__main__":
    main()
