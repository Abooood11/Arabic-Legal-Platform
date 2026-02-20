"""
استخراج الأحكام القضائية من مجلدات وزارة العدل السعودية (مركز البحوث) لعام 1435هـ
=================================================================================

المصدر: https://faculty.ksu.edu.sa/ar/drmoemen/blog/244410
المجلدات: 13 مجلد أحكام + مجلد 14 (فهرس)

البنية:
- كل مجلد PDF يحتوي على عدة أحكام
- كل حكم يبدأ بصفحة ملخص تحتوي على:
  * الرقم التسلسلي
  * محكمة الدرجة الأولى + تاريخها + رقم القضية
  * محكمة الاستئناف + تاريخه + رقم القرار
  * الكلمات المفتاحية (بيع - عقار - إثبات ملكية...)
  * السندات النظامية (المواد والأنظمة)
  * ملخص الحكم
- يتبعه نص الحكم الكامل

الهدف: استخراج كل حكم مع بياناته الوصفية + أرقام الصفحات لإنشاء رابط PDF مباشر
"""

import fitz  # PyMuPDF
import re
import json
import os
import sys
import unicodedata
from pathlib import Path
from typing import Optional

# =============================================================================
# ثوابت
# =============================================================================

# الروابط الأصلية لملفات PDF
PDF_URLS = {
    1: "https://faculty.ksu.edu.sa/sites/default/files/01_2_0.pdf",
    2: "https://faculty.ksu.edu.sa/sites/default/files/2_47_0.pdf",
    3: "https://faculty.ksu.edu.sa/sites/default/files/3_41_0.pdf",
    4: "https://faculty.ksu.edu.sa/sites/default/files/4_40_0.pdf",
    5: "https://faculty.ksu.edu.sa/sites/default/files/5_36_0.pdf",
    6: "https://faculty.ksu.edu.sa/sites/default/files/6_33_0.pdf",
    7: "https://faculty.ksu.edu.sa/sites/default/files/7_32_0.pdf",
    8: "https://faculty.ksu.edu.sa/sites/default/files/8_22_0.pdf",
    9: "https://faculty.ksu.edu.sa/sites/default/files/9_26_0.pdf",
    10: "https://faculty.ksu.edu.sa/sites/default/files/10_24_0.pdf",
    11: "https://faculty.ksu.edu.sa/sites/default/files/11_21_0.pdf",
    12: "https://faculty.ksu.edu.sa/sites/default/files/12_18_0.pdf",
    13: "https://faculty.ksu.edu.sa/sites/default/files/13_12_0.pdf",
}

# أنماط اكتشاف بداية حكم جديد (صفحة الملخص)
# الرقم التسلسلي يظهر في أعلى صفحة الملخص
SERIAL_PATTERN = re.compile(
    r'(?:الرقم\s*التسلسلي|يلسلستلا\s*مقرلا)',
    re.MULTILINE
)

# نمط محكمة الدرجة الأولى
# الشكل: "حمكمة الدرجة األوىل: املحكمة العامة بضمد"
FIRST_INSTANCE_COURT = re.compile(
    r'(?:حمكمة|محكمة)\s*(?:الدرجة|الدرج[ةه])\s*(?:األوىل|الأوىل|الأولى|األولى)\s*[:\s]*(.+?)(?:\n|$)',
    re.MULTILINE
)

# نمط رقم القضية
CASE_NUMBER_PATTERN = re.compile(
    r'رقم\s*القضية\s*[:\s]*([٠-٩\d/\-\s]+)',
    re.MULTILINE
)

# نمط تاريخ المحكمة
COURT_DATE_PATTERN = re.compile(
    r'تارخيها?\s*[:\s]*([٠-٩\d/\-\s]+)',
    re.MULTILINE
)

# نمط محكمة الاستئناف
# الشكل: "حمكمة الاستئناف: حمكمة الاستئناف بمنطقة عسير" أو "حمكمة االستئناف:"
APPEAL_COURT_PATTERN = re.compile(
    r'(?:حمكمة|محكمة)\s*(?:الا?ستئناف|االستئناف)\s*[:\s]*(?:حمكمة|محكمة)?\s*(?:الا?ستئناف|االستئناف)?\s*(.+?)(?:\n|$)',
    re.MULTILINE
)

# نمط رقم قرار الاستئناف
APPEAL_DECISION_PATTERN = re.compile(
    r'رقم\s*القرار\s*[:\s]*([٠-٩\d/\-\s]+)',
    re.MULTILINE
)

# نمط تاريخ الاستئناف
APPEAL_DATE_PATTERN = re.compile(
    r'تارخيه\s*[:\s]*([٠-٩\d/\-\s]+)',
    re.MULTILINE
)

# أنماط التصنيف (بين الأقواس أو بعد الشرطة في صفحة الملخص)
# الكلمات المفتاحية المفصولة بـ " - "
KEYWORDS_PATTERN = re.compile(
    r'^[\s\-–—]*(?:بيع|إيجار|عقار|رشاكة|شراكة|قرض|ضامن|ضمان|وكالة|كفالة|رهن|حضانة|نفقة|طالق|زواج|ميراث|وصية|حدود|تعزير|قصاص|سرقة|نقل|حيازة|إتلاف|غصب|شفعة|وقف|هبة|صلح|مخدرات|تزوير|قتل|اعتداء|إرث|والية|نسب|عقوق).+$',
    re.MULTILINE
)

# =============================================================================
# دوال التنظيف
# =============================================================================

def normalize_arabic(text: str) -> str:
    """تنظيف وتطبيع النص العربي"""
    if not text:
        return ""

    # إزالة أحرف التحكم وأحرف الاستبدال
    text = text.replace('\ufffd', '')
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)

    # تطبيع الهمزات
    text = text.replace('أ', 'أ').replace('إ', 'إ').replace('آ', 'آ')

    # إزالة التشكيل (اختياري - نبقيه لأن النصوص القانونية قد تحتاجه)
    # text = re.sub(r'[\u064B-\u065F\u0670]', '', text)

    # تنظيف المسافات المتعددة
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)

    # تنظيف الأسطر الفارغة في البداية والنهاية
    text = text.strip()

    return text


def convert_arabic_numerals(text: str) -> str:
    """تحويل الأرقام العربية-الهندية إلى أرقام عادية"""
    arabic_digits = '٠١٢٣٤٥٦٧٨٩'
    for i, d in enumerate(arabic_digits):
        text = text.replace(d, str(i))
    return text


def clean_ocr_artifacts(text: str) -> str:
    """إزالة عناصر PDF الهيكلية والتنسيقية"""
    if not text:
        return ""

    # إزالة رقم الصفحة في بداية النص (سطر يحتوي رقم فقط)
    text = re.sub(r'^(\d+)\s*\n', '', text)

    # إزالة الرموز الغريبة من InDesign
    text = text.replace('S������', '')
    text = re.sub(r'[�]+', '', text)
    text = re.sub(r'[\uf000-\uf8ff]', '', text)  # Private Use Area

    # إزالة علامات التنسيق المكررة
    text = re.sub(r'[6869~Gzz{}|](?=[أ-ي])', '', text)

    # تنظيف أنماط OCR الفاسدة في أسماء الأشخاص
    # مثل "8صالح" -> "صالح"، "9ضيلة" -> "فضيلة"
    text = re.sub(r'(\b)([0-9])([أ-ي])', r'\1\3', text)

    return text


def clean_page_header(text: str) -> str:
    """إزالة ترويسات الصفحات المتكررة"""
    # أنماط الترويسة: "رقم الصفحة" + "عنوان القسم"
    # مثل: "16\n" أو "بيع ـ إثبات بيع"
    lines = text.split('\n')
    cleaned_lines = []

    for i, line in enumerate(lines):
        stripped = line.strip()

        # تخطي سطر رقم الصفحة المنفرد
        if re.match(r'^\d{1,3}$', stripped):
            continue

        # تخطي عنوان القسم في الترويسة (سطر قصير جداً في أعلى الصفحة)
        if i < 2 and len(stripped) < 50 and re.match(r'^[أ-ي\s\-ـ]+$', stripped):
            # لكن لا نحذف إذا كان جزءاً من نص الحكم
            if not any(keyword in stripped for keyword in ['الحمد', 'وبعد', 'حكمت', 'فلدي']):
                continue

        # تخطي أنماط ترويسة التصنيف المتكررة مثل "بيع ـ Gإثبات بيع"
        if re.match(r'^[أ-ي\s\-ـG]+$', stripped) and len(stripped) < 60 and i < 3:
            if '�' in stripped or 'G' in stripped:
                continue

        cleaned_lines.append(line)

    return '\n'.join(cleaned_lines)


# =============================================================================
# استخراج البيانات الوصفية
# =============================================================================

def extract_metadata(summary_text: str, volume: int) -> dict:
    """استخراج البيانات الوصفية من صفحة ملخص الحكم"""

    metadata = {
        'volume': volume,
        'serial_number': None,
        'first_instance_court': None,
        'first_instance_date': None,
        'case_number': None,
        'appeal_court': None,
        'appeal_date': None,
        'appeal_decision_number': None,
        'keywords': None,
        'legal_basis': None,
        'summary': None,
    }

    # استخراج المحكمة الابتدائية
    m = FIRST_INSTANCE_COURT.search(summary_text)
    if m:
        court = m.group(1).strip()
        # تنظيف الأخطاء الشائعة في OCR
        court = court.replace('حمكمة', 'محكمة')
        court = court.replace('املحكمة', 'المحكمة')
        court = court.replace('العامّة', 'العامة')
        court = court.replace('اجلزائية', 'الجزائية')
        court = court.replace('التنفيذ', 'التنفيذ')
        court = court.replace('حمافظة', 'محافظة')
        court = court.replace('أهبا', 'أبها')
        court = court.replace('أيب', 'أبي')
        court = court.replace('مخيس', 'خميس')
        court = court.replace('اخلرب', 'الخبر')
        court = court.replace('اخلرج', 'الخرج')
        court = court.replace('االحساء', 'الأحساء')
        court = court.replace('األحساء', 'الأحساء')
        court = court.replace('عسري', 'عسير')
        court = court.replace('املدينة املنورة', 'المدينة المنورة')
        court = court.replace('صبياء', 'صبيا')
        metadata['first_instance_court'] = court

    # استخراج رقم القضية
    m = CASE_NUMBER_PATTERN.search(summary_text)
    if m:
        metadata['case_number'] = convert_arabic_numerals(m.group(1).strip())

    # استخراج تاريخ المحكمة الابتدائية
    m = COURT_DATE_PATTERN.search(summary_text)
    if m:
        metadata['first_instance_date'] = convert_arabic_numerals(m.group(1).strip())

    # استخراج محكمة الاستئناف
    m = APPEAL_COURT_PATTERN.search(summary_text)
    if m and m.group(1):
        court = m.group(1).strip()
        if court:
            court = court.replace('حمكمة', 'محكمة')
            court = court.replace('حمافظة', 'محافظة')
            metadata['appeal_court'] = court

    # استخراج رقم قرار الاستئناف
    m = APPEAL_DECISION_PATTERN.search(summary_text)
    if m:
        metadata['appeal_decision_number'] = convert_arabic_numerals(m.group(1).strip())

    # استخراج تاريخ الاستئناف
    m = APPEAL_DATE_PATTERN.search(summary_text)
    if m:
        metadata['appeal_date'] = convert_arabic_numerals(m.group(1).strip())

    # استخراج الكلمات المفتاحية
    # البحث عن السطر الذي يبدأ بكلمة مفتاحية مثل "بيع - عقار - إثبات"
    # عادة يكون بين معلومات المحكمة والسندات
    keyword_lines = []
    lines = summary_text.split('\n')
    in_keywords = False
    for line in lines:
        stripped = line.strip()
        # الكلمات المفتاحية تبدأ بشرطة وتحتوي مصطلحات قانونية
        if re.match(r'^\s*[\-–—]?\s*(بيع|إيجار|شراكة|رشاكة|قرض|ضامن|ضمان|وكالة|كفالة|رهن|حضانة|نفقة|طالق|زواج|ميراث|وصية|حدود|تعزير|قصاص|سرقة|نقل|حيازة|إتلاف|غصب|شفعة|وقف|هبة|صلح|مخدرات|تزوير|قتل|اعتداء|إرث|والية|وال[ي]ة|نسب|عقوق)', stripped):
            in_keywords = True

        if in_keywords:
            if stripped.startswith(('المواد', 'املواد', 'قول', 'من نظام', 'تعميم', '-1', '-2', '1 ', '2 ')):
                # وصلنا للسندات النظامية - نتوقف
                break
            if stripped:
                keyword_lines.append(stripped)

    if keyword_lines:
        keywords_text = ' '.join(keyword_lines)
        # تنظيف الشرطات المكررة
        keywords_text = re.sub(r'\s*[\-–—]\s*', ' - ', keywords_text)
        keywords_text = re.sub(r'^[\s\-–—]+', '', keywords_text)
        metadata['keywords'] = keywords_text.strip()

    # استخراج السندات النظامية
    legal_lines = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if re.match(r'^[\-–—]?\s*[12]\s*[\-–—]?\s*$', stripped):
            # ترقيم السندات
            continue
        if re.match(r'^\s*[\-–—]?[12][\-–—]?\s+(المواد|املواد|قول|من نظام|تعميم|نص)', stripped) or \
           re.match(r'^\s*(المواد|املواد|المادة|املادة|قول|تعميم)\s', stripped):
            legal_lines.append(stripped)

    if legal_lines:
        metadata['legal_basis'] = '\n'.join(legal_lines)

    # استخراج الملخص (الفقرة الأخيرة قبل بداية نص الحكم)
    # الملخص عادة بعد السندات وقبل "الحمد لله وحده"
    summary_parts = []
    found_keywords_or_basis = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # تخطي ترويسة الصفحة
        if re.match(r'^\d{1,3}$', stripped):
            continue
        if SERIAL_PATTERN.search(stripped):
            continue
        if any(x in stripped for x in ['حمكمة الدرجة', 'محكمة الدرجة', 'حمكمة الاستئناف', 'محكمة الاستئناف',
                                        'تارخيها', 'تارخيه', 'رقم القضية', 'رقم القرار']):
            continue

        # بعد السندات النظامية نبدأ جمع الملخص
        if any(x in stripped for x in ['المواد', 'املواد', 'المادة', 'املادة', 'قول ابن', 'من نظام', 'تعميم']):
            found_keywords_or_basis = True
            continue

        if found_keywords_or_basis and stripped:
            # تجاهل إذا كان ترقيم
            if re.match(r'^[12]\s*$', stripped):
                continue
            summary_parts.append(stripped)

    if summary_parts:
        metadata['summary'] = ' '.join(summary_parts)

    return metadata


def detect_judgment_category(keywords: str, court: str, text: str) -> str:
    """تحديد تصنيف الحكم (حقوقي، أحوال شخصية، جنائي، شروط الدعوى)"""

    if not keywords and not court:
        return 'حقوقي'

    kw = (keywords or '').lower()
    txt = (text or '')[:500].lower()

    # جنائي
    criminal_keywords = ['حدود', 'تعزير', 'قصاص', 'سرقة', 'مخدرات', 'تزوير', 'قتل',
                         'اعتداء', 'سحر', 'ردة', 'إزعاج', 'مظاهرات', 'اتجار', 'جنائ']
    for ck in criminal_keywords:
        if ck in kw or ck in txt:
            return 'جنائي'

    # أحوال شخصية
    personal_keywords = ['حضانة', 'نفقة', 'طالق', 'زواج', 'ميراث', 'وصية', 'إرث',
                         'والية', 'نسب', 'عقوق', 'فسخ نكاح', 'خلع', 'رضاع']
    for pk in personal_keywords:
        if pk in kw or pk in txt:
            return 'أحوال شخصية'

    # شروط الدعوى والاختصاص
    procedure_keywords = ['اختصاص', 'دفع شكلي', 'عدم قبول', 'تقادم', 'مرور الزمن']
    for prk in procedure_keywords:
        if prk in kw or prk in txt:
            return 'شروط الدعوى'

    return 'حقوقي'


# =============================================================================
# استخراج الأحكام
# =============================================================================

def is_judgment_header_page(text: str) -> bool:
    """هل هذه صفحة ملخص/عنوان حكم جديد؟"""
    if not text or len(text.strip()) < 50:
        return False

    # يجب أن تحتوي على نمط الرقم التسلسلي
    has_serial = bool(SERIAL_PATTERN.search(text))

    # ويجب أن تحتوي على بيانات المحكمة
    has_court = 'محكمة' in text or 'حمكمة' in text
    has_case = 'رقم القضية' in text or 'القضية' in text

    return has_serial and has_court and has_case


def find_section_title_pages(doc) -> set:
    """إيجاد صفحات عناوين الأبواب/الأقسام (ليست أحكاماً)"""
    title_pages = set()

    for i in range(doc.page_count):
        text = doc[i].get_text('text').strip()

        # صفحات العناوين عادة قصيرة جداً وتحتوي فقط على اسم القسم
        if len(text) < 100:
            # أنماط عناوين الأقسام
            section_patterns = [
                r'^\s*(بيع|إيجار|قرض|ضامن|رهن|شفعة|وقف|هبة|صلح|وكالة|كفالة|نكاح|طالق|حضانة|نفقة|إرث|وصية|حدود|تعزير|قصاص|سرقة)',
                r'^\s*(الحقوقي|احلقوقي|الأحوال|اجلنائي|الجنائي|شروط)',
                r'فهر[سSص]',
                r'فريق\s*(العمل|املراجعة)',
                r'مقدم[ةه]',
            ]
            for pat in section_patterns:
                if re.search(pat, text):
                    title_pages.add(i)
                    break

    return title_pages


def extract_judgments_from_volume(pdf_path: str, volume_num: int) -> list:
    """استخراج جميع الأحكام من مجلد واحد"""

    doc = fitz.open(pdf_path)
    total_pages = doc.page_count

    print(f"\n{'='*60}")
    print(f"  المجلد {volume_num} — {total_pages} صفحة — {os.path.basename(pdf_path)}")
    print(f"{'='*60}")

    # الخطوة 1: استخراج نص كل صفحة
    pages_text = []
    for i in range(total_pages):
        text = doc[i].get_text('text')
        text = clean_ocr_artifacts(text)
        pages_text.append(text)

    # الخطوة 2: تحديد صفحات عناوين الأقسام (نتجاهلها)
    title_pages = find_section_title_pages(doc)

    # الخطوة 3: إيجاد جميع صفحات بداية الأحكام (صفحات الملخص)
    judgment_starts = []
    for i in range(total_pages):
        if i in title_pages:
            continue
        if is_judgment_header_page(pages_text[i]):
            judgment_starts.append(i)

    print(f"  تم اكتشاف {len(judgment_starts)} حكم")

    if not judgment_starts:
        doc.close()
        return []

    # الخطوة 4: استخراج كل حكم
    judgments = []
    pdf_url = PDF_URLS.get(volume_num, '')

    for idx, start_page in enumerate(judgment_starts):
        # تحديد نهاية الحكم (بداية الحكم التالي أو نهاية المجلد)
        if idx + 1 < len(judgment_starts):
            end_page = judgment_starts[idx + 1] - 1
        else:
            # آخر حكم - نهايته آخر صفحة بنص
            end_page = total_pages - 1
            # لكن نتأكد أن الصفحات الأخيرة ليست فهارس
            for p in range(end_page, start_page, -1):
                if len(pages_text[p].strip()) > 100:
                    end_page = p
                    break

        # استخراج صفحة الملخص
        summary_text = pages_text[start_page]

        # استخراج نص الحكم الكامل (من الصفحة التالية للملخص حتى نهاية الحكم)
        body_pages = []
        body_start = start_page + 1  # نبدأ بعد صفحة الملخص

        # في بعض الحالات الملخص والنص في نفس الصفحة
        # نتحقق إذا كان النص يحتوي على "الحمد لله وحده وبعد"
        if 'احلمد هلل' in summary_text or 'الحمد لله' in summary_text:
            # نقسم الصفحة: الملخص أولاً ثم النص
            split_match = re.search(r'(احلمد هلل|الحمد لله)', summary_text)
            if split_match:
                body_text_start = summary_text[split_match.start():]
                summary_text = summary_text[:split_match.start()]
                body_pages.append(clean_page_header(body_text_start))

        for p in range(body_start, end_page + 1):
            if p < total_pages and p not in title_pages:
                page_text = clean_page_header(pages_text[p])
                if page_text.strip():
                    body_pages.append(page_text)

        full_text = '\n'.join(body_pages)
        full_text = normalize_arabic(full_text)

        # استخراج البيانات الوصفية
        metadata = extract_metadata(summary_text, volume_num)

        # تحديد التصنيف
        category = detect_judgment_category(
            metadata.get('keywords', ''),
            metadata.get('first_instance_court', ''),
            full_text
        )

        # تنظيف الملخص
        summary_clean = normalize_arabic(metadata.get('summary', '') or '')

        # بناء رابط PDF المباشر للحكم (الصفحة المحددة)
        # PDF viewers تدعم #page=N للفتح في صفحة محددة
        pdf_page_url = f"{pdf_url}#page={start_page + 1}"

        # استخراج اسم المحكمة للعرض
        court_name = metadata.get('first_instance_court') or ''
        if court_name:
            court_name = court_name.replace('حمكمة', 'محكمة')

        # إذا لم نستخرج المحكمة من الملخص، نحاول من نص الحكم
        if not court_name and full_text:
            court_match = re.search(
                r'(?:القايض|القاضي|رئيس)\s+(?:يف|في)\s+(?:املحكمة|المحكمة|حمكمة|محكمة)\s+(.+?)(?:[،,\n]|وبناء)',
                full_text[:500]
            )
            if court_match:
                court_name = court_match.group(0)
                court_name = re.sub(r'^(?:القايض|القاضي|رئيس)\s+(?:يف|في)\s+', '', court_name)
                court_name = re.sub(r'(?:[،,]|وبناء).*$', '', court_name)
                court_name = court_name.replace('حمكمة', 'محكمة')
                court_name = court_name.replace('املحكمة', 'المحكمة')
                court_name = court_name.strip()

        # استخراج المدينة من اسم المحكمة
        city = extract_city_from_court(court_name)

        # تحديد السنة الهجرية
        year_hijri = extract_hijri_year(metadata.get('first_instance_date', ''))

        judgment = {
            'volume': volume_num,
            'serial_in_volume': idx + 1,
            'case_id': f"MOJ-1435-V{volume_num}-{(metadata.get('case_number') or '').replace(' ', '') or str(idx+1)}",
            'case_number_raw': metadata.get('case_number') or '',
            'year_hijri': year_hijri or 1435,
            'city': city,
            'court_body': court_name or f'المحكمة العامة',
            'circuit_type': category,
            'judgment_number': metadata.get('appeal_decision_number', ''),
            'judgment_date': metadata.get('first_instance_date', ''),
            'appeal_court': metadata.get('appeal_court', ''),
            'appeal_date': metadata.get('appeal_date', ''),
            'appeal_decision_number': metadata.get('appeal_decision_number', ''),
            'text': full_text,
            'summary': summary_clean,
            'keywords': metadata.get('keywords', ''),
            'legal_basis': metadata.get('legal_basis', ''),
            'source': 'moj_research',
            'pdf_url': pdf_page_url,
            'pdf_start_page': start_page + 1,
            'pdf_end_page': end_page + 1,
            'page_count': end_page - start_page + 1,
        }

        judgments.append(judgment)

        # طباعة تقدم
        text_preview = full_text[:80].replace('\n', ' ') if full_text else '(فارغ)'
        court_display = (court_name or 'غير محدد')[:30]
        case_display = (metadata.get('case_number') or 'N/A')[:15]
        print(f"  [{idx+1}] p{start_page+1}-{end_page+1} | {court_display} | {case_display} | {text_preview}...")

    doc.close()
    return judgments


def extract_city_from_court(court_name: str) -> str:
    """استخراج اسم المدينة من اسم المحكمة"""
    if not court_name:
        return ''

    # أنماط: "املحكمة العامة بضمد" أو "املحكمة العامة بمحافظة جدة" أو "بمنطقة عسري"
    # الباء قد تكون متصلة بالكلمة التالية
    city_match = re.search(
        r'ب(?:منطقة\s*|محافظة\s*|حمافظة\s*)?([أ-ي\u0600-\u06FF\s]+?)(?:\s*$|\s*[،,\n\t])',
        court_name
    )
    if city_match:
        city = city_match.group(1).strip()
        # تنظيف
        city = re.sub(r'\s+', ' ', city)

        # تصحيح أسماء المدن الشائعة من OCR
        city_fixes = {
            'الريا9ض': 'الرياض', 'الرياض': 'الرياض',
            'مكة املكرمة': 'مكة المكرمة', 'مكة المكرمة': 'مكة المكرمة',
            'املدينة املنورة': 'المدينة المنورة', 'المدينة المنورة': 'المدينة المنورة',
            'جدة': 'جدة', 'حمافظة جدة': 'جدة',
            'الدمام': 'الدمام', 'اخلرب': 'الخبر', 'الخبر': 'الخبر',
            'اخلرج': 'الخرج', 'الخرج': 'الخرج',
            'بريدة': 'بريدة', 'عنيزة': 'عنيزة',
            'أهبا': 'أبها', 'أبها': 'أبها',
            'مخيس مشيط': 'خميس مشيط', 'خميس مشيط': 'خميس مشيط',
            'جازان': 'جازان', 'صبيا': 'صبيا', 'صبياء': 'صبيا',
            'أيب عريش': 'أبي عريش', 'أبي عريش': 'أبي عريش',
            'حائل': 'حائل', 'تبوك': 'تبوك',
            'عرعر': 'عرعر', 'سكاكا': 'سكاكا',
            'الطائف': 'الطائف', 'الباحة': 'الباحة',
            'نجران': 'نجران', 'جيزان': 'جازان',
            'ضمد': 'ضمد', 'القطيف': 'القطيف',
            'االحساء': 'الأحساء', 'األحساء': 'الأحساء', 'الأحساء': 'الأحساء',
            'املزامحية': 'المزاحمية', 'المزاحمية': 'المزاحمية',
            'عيون اجلواء': 'عيون الجواء', 'عيون الجواء': 'عيون الجواء',
            'القصيم': 'القصيم', 'عسري': 'عسير', 'عسير': 'عسير',
        }
        for wrong, correct in city_fixes.items():
            if city == wrong or city.strip() == wrong:
                return correct

        return city

    return ''


def extract_hijri_year(date_str: str) -> Optional[int]:
    """استخراج السنة الهجرية من النص"""
    if not date_str:
        return None

    clean = convert_arabic_numerals(date_str)

    # أنماط: 1434، 1435، إلخ
    m = re.search(r'(14\d{2})', clean)
    if m:
        return int(m.group(1))

    # 34، 35 -> 1434، 1435
    m = re.search(r'\b(3[3-6])\b', clean)
    if m:
        return 1400 + int(m.group(1))

    return None


# =============================================================================
# الدالة الرئيسية
# =============================================================================

def main():
    script_dir = Path(__file__).parent
    pdfs_dir = script_dir / 'pdfs'
    output_dir = script_dir / 'output'
    output_dir.mkdir(exist_ok=True)

    all_judgments = []
    stats = {
        'volumes_processed': 0,
        'total_judgments': 0,
        'by_volume': {},
        'by_category': {},
        'by_city': {},
        'errors': [],
    }

    # معالجة المجلدات من 1 إلى 13 (14 هو الفهرس)
    for vol in range(1, 14):
        pdf_file = pdfs_dir / f'vol_{vol:02d}.pdf'

        if not pdf_file.exists():
            print(f"\n⚠ المجلد {vol} غير موجود: {pdf_file}")
            stats['errors'].append(f"المجلد {vol} غير موجود")
            continue

        try:
            judgments = extract_judgments_from_volume(str(pdf_file), vol)
            all_judgments.extend(judgments)

            stats['volumes_processed'] += 1
            stats['total_judgments'] += len(judgments)
            stats['by_volume'][vol] = len(judgments)

            for j in judgments:
                cat = j.get('circuit_type', 'غير محدد')
                stats['by_category'][cat] = stats['by_category'].get(cat, 0) + 1
                city = j.get('city', 'غير محدد')
                stats['by_city'][city] = stats['by_city'].get(city, 0) + 1

            # حفظ مجلد فردي
            vol_output = output_dir / f'vol_{vol:02d}_judgments.json'
            with open(vol_output, 'w', encoding='utf-8') as f:
                json.dump(judgments, f, ensure_ascii=False, indent=2)
            print(f"  ✓ تم حفظ {len(judgments)} حكم في {vol_output.name}")

        except Exception as e:
            print(f"\n✗ خطأ في المجلد {vol}: {e}")
            import traceback
            traceback.print_exc()
            stats['errors'].append(f"المجلد {vol}: {str(e)}")

    # حفظ كل الأحكام في ملف واحد
    all_output = output_dir / 'all_moj_judgments.json'
    with open(all_output, 'w', encoding='utf-8') as f:
        json.dump(all_judgments, f, ensure_ascii=False, indent=2)

    # حفظ الإحصائيات
    stats_output = output_dir / 'extraction_stats.json'
    with open(stats_output, 'w', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    # طباعة الملخص
    print(f"\n{'='*60}")
    print(f"  الملخص النهائي")
    print(f"{'='*60}")
    print(f"  المجلدات المعالجة: {stats['volumes_processed']}/13")
    print(f"  إجمالي الأحكام: {stats['total_judgments']}")
    print(f"\n  التوزيع حسب المجلد:")
    for vol, count in sorted(stats['by_volume'].items()):
        print(f"    المجلد {vol}: {count} حكم")
    print(f"\n  التوزيع حسب التصنيف:")
    for cat, count in sorted(stats['by_category'].items(), key=lambda x: -x[1]):
        print(f"    {cat}: {count}")
    print(f"\n  أكثر 10 مدن:")
    for city, count in sorted(stats['by_city'].items(), key=lambda x: -x[1])[:10]:
        print(f"    {city}: {count}")

    if stats['errors']:
        print(f"\n  أخطاء:")
        for err in stats['errors']:
            print(f"    ✗ {err}")

    print(f"\n  الملفات:")
    print(f"    {all_output}")
    print(f"    {stats_output}")

    return all_judgments


if __name__ == '__main__':
    main()
