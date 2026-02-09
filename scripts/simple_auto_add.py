import json
from pathlib import Path
import time
from simple_convert import convert_boe_to_platform

def add_to_library(law_id, title):
    lib_path = Path("client/public/data/library.json")
    try:
        with open(lib_path, 'r', encoding='utf-8') as f:
            lib = json.load(f)
    except:
        lib = {"laws": []}

    # Check if exists
    if any(l.get('law_id') == law_id for l in lib['laws']):
        return False

    lib['laws'].append({
        "law_id": law_id,
        "title_ar": title,
        "jurisdiction": "sa",
        "category": "law",
        "source": "boe",
        "file_path": f"laws/{law_id}_boe.json"
    })

    with open(lib_path, 'w', encoding='utf-8') as f:
        json.dump(lib, f, ensure_ascii=False, indent=2)

    return True

boe_dir = Path("boe_laws")
output_dir = Path("client/public/data/laws")
output_dir.mkdir(parents=True, exist_ok=True)

processed = set()
count = 0

while True:
    law_files = list(boe_dir.glob("law_*.json"))

    for law_file in law_files:
        if law_file.name in processed:
            continue

        try:
            with open(law_file, 'r', encoding='utf-8') as f:
                boe_law = json.load(f)

            if not boe_law.get('title') or not boe_law.get('articles'):
                processed.add(law_file.name)
                continue

            platform_law = convert_boe_to_platform(boe_law)
            law_id = platform_law['law_id']

            # Save law file
            out_file = output_dir / f"{law_id}_boe.json"
            with open(out_file, 'w', encoding='utf-8') as f:
                json.dump(platform_law, f, ensure_ascii=False, indent=2)

            # Add to library
            if add_to_library(law_id, platform_law['law_name']):
                count += 1
                print(f"Added {count}: {law_id}")

            processed.add(law_file.name)
        except Exception as e:
            print(f"Error {law_file.name}: {e}")
            processed.add(law_file.name)

    # Check completion
    if boe_dir.joinpath("all_laws_complete.json").exists():
        print(f"DONE: {count} laws added")
        break

    print(f"Status: {len(law_files)} extracted, {count} added")
    time.sleep(5)
