# آلية مستمرة لرصد الأخطاء القانونية والنظامية (بدون تعديل المحتوى)

هذه الآلية تعمل بأسلوب **قراءة فقط** على ملفات الأنظمة، وتُخرج تقارير دورية دون المساس بالنصوص الأصلية.

## ما الذي تم توفيره

- سكربت رصد تلقائي: `scripts/legal_compliance_monitor.py`
- مخرجات تقرير بصيغتين:
  - JSON: `reports/legal-monitoring/legal-compliance-report.json`
  - Markdown: `reports/legal-monitoring/legal-compliance-report.md`

## القواعد الحالية للرصد

1. التحقق من الحقول الإلزامية للنظام (مثل: `law_id`, `law_name`, `articles`).
2. التحقق من تطابق `total_articles` مع العدد الفعلي للمواد.
3. اكتشاف أرقام المواد غير الصالحة أو المكررة أو التي فيها فجوات.
4. اكتشاف المواد ذات النص الفارغ.
5. اكتشاف مؤشرات نص غير نهائي (مثل `TODO`, `FIXME`, `...`, `غير متوفر`).
6. التنبيه على حالات مواد غير معروفة خارج القيم المتوقعة.

> ملاحظة: هذه القواعد **لا تُصدر حكمًا قانونيًا نهائيًا**؛ هي طبقة تدقيق جودة نظامية/بيانية تساعد فريق المراجعة القانونية.


## الدمج داخل المنصة (Admin)

- API لعرض آخر تقرير: `GET /api/legal-monitoring/report` (مشرف فقط).
- API لتشغيل الفحص فورًا: `POST /api/legal-monitoring/run` (مشرف فقط).
- تم ربط ذلك بواجهة صفحة الإدارة `/admin/reports` مع زر **تشغيل الرصد الآن** وعرض ملخص آخر النتائج.

## التشغيل اليدوي

```bash
python scripts/legal_compliance_monitor.py
```

## تشغيل دوري (Cron كل 6 ساعات)

```bash
0 */6 * * * cd /workspace/Arabic-Legal-Platform && /usr/bin/python3 scripts/legal_compliance_monitor.py >> /workspace/Arabic-Legal-Platform/reports/legal-monitoring/cron.log 2>&1
```

## التكامل مع CI (GitHub Actions مثال)

```yaml
name: legal-monitoring

on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Run legal monitoring (read-only)
        run: python scripts/legal_compliance_monitor.py
      - name: Upload report artifacts
        uses: actions/upload-artifact@v4
        with:
          name: legal-monitoring-report
          path: reports/legal-monitoring/*
```

## آلية الحوكمة المقترحة

- **يوميًا**: مراجعة تقرير Markdown من الفريق القانوني/الامتثال.
- **أسبوعيًا**: تحليل اتجاهات التكرار (عدد أخطاء high/medium).
- **شهريًا**: تحديث قواعد الرصد وإضافة قواعد domain-specific جديدة.

## لماذا هذا يحقق شرط "دون تعديل"؟

- السكربت لا يكتب داخل `client/public/data/laws/`.
- السكربت لا يرسل طلبات تحديث لأي API.
- كل الكتابة تكون في مسار تقارير منفصل `reports/legal-monitoring/` فقط.
