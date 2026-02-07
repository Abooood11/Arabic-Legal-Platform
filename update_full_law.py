import json

# Read the decision text
with open('attached_assets/Pasted--820-1444-11-24--1769725957404_1769725957405.txt', 'r', encoding='utf-8') as f:
    decision_text = f.read()

# Read the full law data (with articles)
with open('attached_assets/saudi_civil_law_(2)_1769724919399.json', 'r', encoding='utf-8') as f:
    law_data = json.load(f)

# Update metadata in law_data
law_data['cabinet_decision_text'] = decision_text
law_data['cabinet_decision'] = {
    "number": "820",
    "date_hijri": "1444/11/24"
}
# Ensure preamble_text includes the reference to decision 820
if 'وبعد الاطلاع على قرار مجلس الوزراء رقم (820)' not in law_data.get('preamble_text', ''):
    # Try to insert it before "يقرر ما يلي"
    preamble = law_data.get('preamble_text', '')
    if 'يقرر ما يلي:' in preamble:
        parts = preamble.split('يقرر ما يلي:')
        new_preamble = parts[0] + "وبعد الاطلاع على قرار مجلس الوزراء رقم (820) وتاريخ 1444/11/24هـ.\n\nيقرر ما يلي:" + parts[1]
        law_data['preamble_text'] = new_preamble

# Save to public data
with open('client/public/data/laws/civil_transactions_sa.json', 'w', encoding='utf-8') as f:
    json.dump(law_data, f, ensure_ascii=False, indent=2)
