#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto-add BOE laws to platform as they are extracted
Monitors boe_laws/ directory and converts new laws automatically
"""

import json
import sys
import io
import time
from pathlib import Path
from boe_to_platform import convert_boe_to_platform

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def load_library():
    """Load current library.json"""
    library_path = Path("client/public/data/library.json")
    try:
        with open(library_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {"laws": []}

def save_library(library_data):
    """Save library.json"""
    library_path = Path("client/public/data/library.json")
    with open(library_path, 'w', encoding='utf-8') as f:
        json.dump(library_data, f, ensure_ascii=False, indent=2)

def get_processed_laws():
    """Get set of already processed law IDs"""
    library = load_library()
    return set(law.get('law_id') for law in library.get('laws', []))

def add_law_to_platform(boe_law_file):
    """Convert and add a single BOE law to the platform"""
    try:
        # Read BOE law
        with open(boe_law_file, 'r', encoding='utf-8') as f:
            boe_law = json.load(f)

        # Skip if no title or articles
        if not boe_law.get('title') or not boe_law.get('articles'):
            return False

        # Convert to platform format
        platform_law = convert_boe_to_platform(boe_law)
        law_id = platform_law['law_id']

        # Save to client/public/data/laws/
        output_dir = Path("client/public/data/laws")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / f"{law_id}_boe.json"

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(platform_law, f, ensure_ascii=False, indent=2)

        # Add to library.json
        library = load_library()

        # Check if already exists
        existing = [l for l in library['laws'] if l.get('law_id') == law_id]
        if not existing:
            library['laws'].append({
                "law_id": law_id,
                "title_ar": platform_law['law_name'],
                "jurisdiction": "sa",
                "category": "law",
                "source": "boe",
                "file_path": f"laws/{law_id}_boe.json"
            })
            save_library(library)

        return True
    except Exception as e:
        print(f"خطأ في معالجة {boe_law_file.name}: {e}")
        return False

def monitor_and_add():
    """Monitor boe_laws/ and add new laws to platform"""
    boe_dir = Path("boe_laws")
    processed = get_processed_laws()

    print(f"مراقبة المجلد: {boe_dir}")
    print(f"الأنظمة المعالجة مسبقاً: {len(processed)}")

    check_count = 0
    added_count = 0

    while True:
        check_count += 1

        # Get all law_*.json files
        law_files = list(boe_dir.glob("law_*.json"))

        # Find new laws
        new_laws = []
        for law_file in law_files:
            try:
                with open(law_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                law_id = data.get('law_id', '').split('-')[0]
                if law_id and law_id not in processed:
                    new_laws.append(law_file)
            except:
                continue

        # Add new laws
        for law_file in new_laws:
            print(f"\nإضافة نظام جديد: {law_file.name}")
            if add_law_to_platform(law_file):
                with open(law_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                law_id = data.get('law_id', '').split('-')[0]
                processed.add(law_id)
                added_count += 1
                print(f"✓ تمت الإضافة ({added_count} نظام)")

        # Status update every 10 checks (20 seconds)
        if check_count % 10 == 0:
            print(f"\n[{check_count}] الحالة: {len(law_files)} نظام مستخرج، {added_count} نظام أضيف للمنصة")

        # Check for completion
        if boe_dir.joinpath("all_laws_complete.json").exists():
            print(f"\n✓ اكتمل الاستخراج!")
            print(f"المجموع: {added_count} نظام أضيف للمنصة")
            break

        # Wait 2 seconds before next check
        time.sleep(2)

if __name__ == "__main__":
    print("=== إضافة تلقائية لأنظمة BOE ===\n")
    monitor_and_add()
