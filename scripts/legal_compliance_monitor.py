#!/usr/bin/env python3
"""Read-only legal/system compliance monitor for law JSON corpus.

Scans `client/public/data/laws/*.json` and produces JSON + Markdown reports
without modifying source legal text.
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import re
from collections import Counter
from dataclasses import dataclass, asdict
from typing import Any

MANDATORY_FIELDS = [
    "law_id",
    "law_name",
    "title",
    "issuing_authority",
    "issue_date_hijri",
    "publish_date_hijri",
    "articles",
]

ALLOWED_ARTICLE_STATUSES = {"active", "amended", "repealed", "", None}
PLACEHOLDER_PATTERNS = [
    r"\bTODO\b",
    r"\bFIXME\b",
    r"\.{3,}",
    r"غير\s+متوفر",
    r"يُضاف\s+لاحقًا",
]


@dataclass
class Finding:
    severity: str
    code: str
    law_id: str
    law_name: str
    message: str
    location: str


ARABIC_TO_WESTERN = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def normalize_digits(value: str) -> str:
    return value.translate(ARABIC_TO_WESTERN)


def parse_article_number(number_value: Any) -> int | None:
    if isinstance(number_value, int):
        return number_value
    if isinstance(number_value, str):
        candidate = normalize_digits(number_value).strip()
        if candidate.isdigit():
            return int(candidate)
    return None


def scan_file(path: str) -> list[Finding]:
    findings: list[Finding] = []

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    law_id = str(data.get("law_id", os.path.basename(path)))
    law_name = str(data.get("law_name", "(unknown)"))

    for field in MANDATORY_FIELDS:
        value = data.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            findings.append(
                Finding(
                    severity="high",
                    code="MISSING_MANDATORY_FIELD",
                    law_id=law_id,
                    law_name=law_name,
                    message=f"الحقل الإلزامي `{field}` مفقود أو فارغ.",
                    location=f"$.{field}",
                )
            )

    articles = data.get("articles") if isinstance(data.get("articles"), list) else []

    total_articles = data.get("total_articles")
    if isinstance(total_articles, int) and total_articles != len(articles):
        findings.append(
            Finding(
                severity="medium",
                code="TOTAL_ARTICLES_MISMATCH",
                law_id=law_id,
                law_name=law_name,
                message=(
                    "قيمة `total_articles` لا تطابق عدد المواد الفعلي "
                    f"({total_articles} != {len(articles)})."
                ),
                location="$.total_articles",
            )
        )

    numbers: list[int] = []
    for idx, article in enumerate(articles):
        location = f"$.articles[{idx}]"
        number = parse_article_number(article.get("number"))
        if number is None:
            findings.append(
                Finding(
                    severity="medium",
                    code="INVALID_ARTICLE_NUMBER",
                    law_id=law_id,
                    law_name=law_name,
                    message="رقم المادة غير قابل للتحليل كرقم صحيح.",
                    location=f"{location}.number",
                )
            )
        else:
            numbers.append(number)

        text = article.get("text")
        if not isinstance(text, str) or not text.strip():
            findings.append(
                Finding(
                    severity="high",
                    code="EMPTY_ARTICLE_TEXT",
                    law_id=law_id,
                    law_name=law_name,
                    message="نص المادة فارغ أو مفقود.",
                    location=f"{location}.text",
                )
            )
        else:
            normalized_text = normalize_digits(text)
            for pattern in PLACEHOLDER_PATTERNS:
                if re.search(pattern, normalized_text, flags=re.IGNORECASE):
                    findings.append(
                        Finding(
                            severity="low",
                            code="PLACEHOLDER_TEXT",
                            law_id=law_id,
                            law_name=law_name,
                            message="تم اكتشاف مؤشر نص تجريبي/غير نهائي داخل المادة.",
                            location=f"{location}.text",
                        )
                    )
                    break

        status = article.get("status")
        if status not in ALLOWED_ARTICLE_STATUSES:
            findings.append(
                Finding(
                    severity="low",
                    code="UNKNOWN_ARTICLE_STATUS",
                    law_id=law_id,
                    law_name=law_name,
                    message=f"حالة المادة غير معروفة: `{status}`.",
                    location=f"{location}.status",
                )
            )

    if numbers:
        counter = Counter(numbers)
        duplicate_numbers = [n for n, c in counter.items() if c > 1]
        for n in sorted(duplicate_numbers):
            findings.append(
                Finding(
                    severity="high",
                    code="DUPLICATE_ARTICLE_NUMBER",
                    law_id=law_id,
                    law_name=law_name,
                    message=f"رقم المادة `{n}` مكرر أكثر من مرة.",
                    location="$.articles[*].number",
                )
            )

        max_num = max(numbers)
        expected = set(range(1, max_num + 1))
        actual = set(numbers)
        missing = sorted(expected - actual)
        if missing:
            preview = ", ".join(map(str, missing[:10]))
            suffix = " ..." if len(missing) > 10 else ""
            findings.append(
                Finding(
                    severity="medium",
                    code="ARTICLE_NUMBER_GAPS",
                    law_id=law_id,
                    law_name=law_name,
                    message=f"توجد فجوات في ترقيم المواد: {preview}{suffix}",
                    location="$.articles[*].number",
                )
            )

    return findings


def write_reports(findings: list[Finding], output_dir: str) -> tuple[str, str]:
    os.makedirs(output_dir, exist_ok=True)

    now = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    summary = {
        "generated_at": now,
        "counts": {
            "total": len(findings),
            "high": sum(1 for f in findings if f.severity == "high"),
            "medium": sum(1 for f in findings if f.severity == "medium"),
            "low": sum(1 for f in findings if f.severity == "low"),
        },
        "findings": [asdict(f) for f in findings],
    }

    json_path = os.path.join(output_dir, "legal-compliance-report.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    md_path = os.path.join(output_dir, "legal-compliance-report.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# تقرير رصد الأخطاء القانونية والنظامية (قراءة فقط)\n\n")
        f.write(f"- وقت التوليد: `{now}`\n")
        f.write(f"- إجمالي الملاحظات: **{summary['counts']['total']}**\n")
        f.write(
            f"- التوزيع: High={summary['counts']['high']}, "
            f"Medium={summary['counts']['medium']}, Low={summary['counts']['low']}\n\n"
        )

        if not findings:
            f.write("لا توجد ملاحظات حسب القواعد الحالية.\n")
        else:
            f.write("## التفاصيل\n\n")
            for idx, finding in enumerate(findings, start=1):
                f.write(f"{idx}. **[{finding.severity.upper()}] {finding.code}**\n")
                f.write(f"   - النظام: `{finding.law_name}` (`{finding.law_id}`)\n")
                f.write(f"   - الموقع: `{finding.location}`\n")
                f.write(f"   - الوصف: {finding.message}\n\n")

    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run continuous legal compliance scan")
    parser.add_argument(
        "--laws-glob",
        default="client/public/data/laws/*.json",
        help="Glob pattern for law JSON files",
    )
    parser.add_argument(
        "--output-dir",
        default="reports/legal-monitoring",
        help="Directory to write generated reports",
    )
    args = parser.parse_args()

    law_paths = sorted(glob.glob(args.laws_glob))
    if not law_paths:
        print("No law files matched the provided glob.")
        return 1

    all_findings: list[Finding] = []
    for path in law_paths:
        all_findings.extend(scan_file(path))

    json_path, md_path = write_reports(all_findings, args.output_dir)
    print(f"Generated report files:\n- {json_path}\n- {md_path}")
    print(f"Total findings: {len(all_findings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
