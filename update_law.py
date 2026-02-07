import json

with open('client/public/data/laws/civil_transactions_sa.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

with open('attached_assets/Pasted--820-1444-11-24--1769725957404_1769725957405.txt', 'r', encoding='utf-8') as f:
    decision_text = f.read()

data['cabinet_decision_text'] = decision_text

with open('client/public/data/laws/civil_transactions_sa.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
