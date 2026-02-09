#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Complete BOE Extractor - Extract all laws with amendments
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import sys
import io
import re
from pathlib import Path
import urllib3
from boe_parser import parse_law_html

# Fix Windows encoding
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://laws.boe.gov.sa"
OUTPUT_DIR = Path("boe_laws")
OUTPUT_DIR.mkdir(exist_ok=True)

session = requests.Session()
session.verify = False
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'ar',
})

def save_json(filename, data):
    (OUTPUT_DIR / filename).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

def extract_law_ids():
    """Extract all law IDs from folders page"""
    print("[1/3] Extracting law IDs...")

    url = f"{BASE_URL}/BoeLaws/Laws/Folders"
    response = session.get(url, timeout=30)

    pattern = r'/BoeLaws/Laws/LawDetails/([a-f0-9\-]+)/\d+'
    law_ids = list(set(re.findall(pattern, response.text)))

    print(f"[+] Found {len(law_ids)} laws\n")
    return law_ids

def download_law(law_id):
    """Download and parse a single law"""
    url = f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1"

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = session.get(url, timeout=15)
            if response.status_code == 200:
                law_data = parse_law_html(response.text)
                law_data['law_id'] = law_id
                law_data['url'] = url
                return law_data
            else:
                print(f"    [!] HTTP {response.status_code}")
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(0.5)
            else:
                print(f"    [!] Error: {e}")
    return None

def main():
    print("="*60)
    print("Complete BOE Laws Extractor")
    print("Extracting all laws with amendments and canceled articles")
    print("="*60 + "\n")

    # Step 1: Get law IDs
    law_ids = extract_law_ids()
    save_json("law_ids.json", law_ids)

    # Step 2: Download all laws
    print(f"[2/3] Downloading {len(law_ids)} laws...")
    print("Estimated time:", int(len(law_ids) * 0.5 / 60), "minutes\n")

    # Check for already extracted laws
    existing_files = set(OUTPUT_DIR.glob("law_*.json"))
    existing_ids = {f.stem.replace('law_', '') for f in existing_files}
    remaining_ids = [lid for lid in law_ids if lid not in existing_ids]

    if len(existing_ids) > 0:
        print(f"[+] Found {len(existing_ids)} already extracted laws")
        print(f"[+] Remaining: {len(remaining_ids)} laws\n")

    all_laws = []
    success_count = 0
    fail_count = 0

    for i, law_id in enumerate(remaining_ids, 1):
        print(f"[{len(existing_ids) + i}/{len(law_ids)}] {law_id[:8]}...", end=" ", flush=True)

        law_data = download_law(law_id)

        if law_data:
            print(f"✓ {law_data.get('title', 'Unknown')[:35]}")
            all_laws.append(law_data)
            success_count += 1

            # Save individual law
            save_json(f"law_{law_id}.json", law_data)
        else:
            print("✗ FAILED")
            fail_count += 1

        # Minimal rate limiting - 0.3s instead of 2s
        time.sleep(0.3)

        # Save progress every 50 laws and show stats
        if i % 50 == 0:
            save_json("all_laws_progress.json", all_laws)
            print(f"\n[Progress] Success: {success_count}, Failed: {fail_count}, Total: {len(existing_ids) + success_count}/{len(law_ids)}\n")

    # Step 3: Final save
    print(f"\n[3/3] Saving final output...")
    save_json("all_laws_complete.json", all_laws)

    # Generate summary
    summary = {
        'total_laws': len(all_laws),
        'with_amendments': len([l for l in all_laws if any(a.get('status') == 'amended' for a in l.get('articles', []))]),
        'with_canceled': len([l for l in all_laws if any(a.get('status') == 'canceled' for a in l.get('articles', []))]),
        'total_articles': sum(len(l.get('articles', [])) for l in all_laws),
    }

    save_json("extraction_summary.json", summary)

    print("\n" + "="*60)
    print("[+] Extraction Complete!")
    print(f"[+] Total laws: {summary['total_laws']}")
    print(f"[+] Laws with amendments: {summary['with_amendments']}")
    print(f"[+] Laws with canceled articles: {summary['with_canceled']}")
    print(f"[+] Total articles: {summary['total_articles']}")
    print(f"[+] Output directory: {OUTPUT_DIR}")
    print("="*60)

if __name__ == "__main__":
    main()
