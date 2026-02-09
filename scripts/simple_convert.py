import json
from pathlib import Path

# Simple converter without encoding issues
def convert_boe_to_platform(boe_law, law_id):
    return {
        "law_id": law_id,
        "law_name": boe_law['title'],
        "jurisdiction_ar": "السعودية",
        "doc_type": "official_text",
        "category": "law",
        "primary_source_id": "boe",
        "royal_decree": boe_law.get('royal_decree', {}),
        "total_articles": len(boe_law['articles']),
        "articles": [
            {
                "number": a['number'] or 0,
                "number_text": a.get('number_text', ''),
                "text": a['text'],
                "status": a['status'],
                "amendments": a.get('amendments', []),
                "paragraphs": a.get('paragraphs', []),
                "tags": []
            }
            for a in boe_law['articles']
        ]
    }

boe_dir = Path("boe_laws")
output_dir = Path("client/public/data/laws")
output_dir.mkdir(parents=True, exist_ok=True)

law_files = list(boe_dir.glob("law_*.json"))
converted = 0

for law_file in law_files:
    try:
        with open(law_file, 'r', encoding='utf-8') as f:
            boe_law = json.load(f)

        if not boe_law.get('title') or not boe_law.get('articles'):
            continue

        # Extract law_id from filename (law_<uuid>.json -> <uuid>)
        law_id = law_file.stem.replace('law_', '')

        platform_law = convert_boe_to_platform(boe_law, law_id)
        output_file = output_dir / f"{law_id}_boe.json"

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(platform_law, f, ensure_ascii=False, indent=2)

        converted += 1
    except Exception as e:
        print(f"Error {law_file.name}: {e}")

with open(output_dir / "_conversion_summary.txt", "w") as f:
    f.write(f"Converted {converted} laws from BOE\n")

print(f"OK: Converted {converted} laws")
