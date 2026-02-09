import json
from pathlib import Path

# Load library (it's an array)
laws_dir = Path("client/public/data/laws")
library_path = Path("client/public/data/library.json")

with open(library_path, 'r', encoding='utf-8') as f:
    library = json.load(f)  # This is an array

# Get existing IDs
existing = {l.get('id') for l in library}

# Find all BOE laws
boe_files = list(laws_dir.glob("*_boe.json"))
added = 0

for boe_file in boe_files:
    try:
        with open(boe_file, 'r', encoding='utf-8') as f:
            law = json.load(f)

        law_id = law.get('law_id')
        if law_id and law_id not in existing:
            library.append({
                "id": law_id,
                "title_ar": law.get('law_name'),
                "jurisdiction_ar": "السعودية",
                "doc_type": "official_text",
                "category": "law",
                "primary_source_id": "boe",
                "links": law.get('links', [])
            })
            existing.add(law_id)
            added += 1
            print(f"Added: {law.get('law_name')[:50]}")
    except Exception as e:
        print(f"Error: {e}")

# Save library
with open(library_path, 'w', encoding='utf-8') as f:
    json.dump(library, f, ensure_ascii=False, indent=2)

print(f"\nTotal: Added {added} BOE laws to library")
