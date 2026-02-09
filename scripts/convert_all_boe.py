#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convert all extracted BOE laws to platform format
"""

import json
import sys
import io
from pathlib import Path
from boe_to_platform import convert_boe_to_platform

def main():
    # Fix Windows console encoding
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    boe_dir = Path("boe_laws")
    output_dir = Path("client/public/data/laws")
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find all law files
    law_files = list(boe_dir.glob("law_*.json"))

    print(f"[*] Found {len(law_files)} BOE laws")
    print(f"[*] Converting to platform format...")

    converted = 0
    skipped = 0

    for law_file in law_files:
        try:
            # Read BOE law
            with open(law_file, 'r', encoding='utf-8') as f:
                boe_law = json.load(f)

            # Skip if no title or no articles
            if not boe_law.get('title') or not boe_law.get('articles'):
                skipped += 1
                continue

            # Convert
            platform_law = convert_boe_to_platform(boe_law)

            # Save to platform directory
            law_id = platform_law['law_id']
            output_file = output_dir / f"{law_id}_boe.json"

            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(platform_law, f, ensure_ascii=False, indent=2)

            converted += 1

            if converted % 10 == 0:
                print(f"  [{converted}/{len(law_files)}] {platform_law['law_name'][:40]}...")

        except Exception as e:
            print(f"  [!] Error with {law_file.name}: {e}")
            skipped += 1

    print(f"\n[+] Conversion complete!")
    print(f"  Converted: {converted}")
    print(f"  Skipped: {skipped}")
    print(f"  Output: {output_dir}")

if __name__ == "__main__":
    main()
