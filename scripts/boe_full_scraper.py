#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Complete BOE Laws Scraper
Extracts all laws from laws.boe.gov.sa with amendments tracking
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
from urllib.parse import urljoin

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
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar,en;q=0.9',
})

def save_json(filename, data):
    """Save data as JSON"""
    (OUTPUT_DIR / filename).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

def extract_law_ids_from_page():
    """Extract all law IDs from the folders page"""
    print("[*] Extracting law IDs from folders page...")

    url = f"{BASE_URL}/BoeLaws/Laws/Folders"
    response = session.get(url, timeout=30)
    html = response.text

    # Find all LawDetails links
    pattern = r'/BoeLaws/Laws/LawDetails/([a-f0-9\-]+)/\d+'
    law_ids = list(set(re.findall(pattern, html)))

    print(f"[+] Found {len(law_ids)} unique law IDs")
    return law_ids

def extract_law_details(law_id):
    """Extract full details of a law"""
    print(f"[*] Extracting law: {law_id}")

    url = f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1"

    try:
        response = session.get(url, timeout=30)
        soup = BeautifulSoup(response.text, 'html.parser')

        law_data = {
            'law_id': law_id,
            'url': url,
            'title': None,
            'royal_decree': {},
            'articles': [],
            'amendments': [],
            'html': response.text  # Keep original HTML for reference
        }

        # Extract title
        title_tag = soup.find('title')
        if title_tag:
            law_data['title'] = title_tag.text.strip()

        # Extract royal decree info
        # This needs inspection of actual HTML structure
        # TODO: Fill in based on actual page structure

        # Extract articles
        # TODO: Find article containers in HTML

        # Extract amendments
        # TODO: Find amendment indicators (strikethrough, highlights, etc.)

        print(f"    [+] Title: {law_data['title']}")

        return law_data

    except Exception as e:
        print(f"    [!] Error: {e}")
        return None

def main():
    print("="*60)
    print("Complete BOE Laws Scraper")
    print("="*60 + "\n")

    # Step 1: Extract all law IDs
    law_ids = extract_law_ids_from_page()
    save_json("law_ids.json", law_ids)

    # Step 2: Extract details for each law
    all_laws = []

    for i, law_id in enumerate(law_ids, 1):
        print(f"\n[{i}/{len(law_ids)}]")

        law_data = extract_law_details(law_id)

        if law_data:
            all_laws.append(law_data)
            # Save individual law
            save_json(f"law_{law_id}.json", law_data)

        # Be nice to the server
        time.sleep(2)

        # Save progress periodically
        if i % 10 == 0:
            save_json("all_laws_progress.json", all_laws)
            print(f"\n[+] Progress saved ({i}/{len(law_ids)})\n")

    # Final save
    save_json("all_laws.json", all_laws)

    print("\n" + "="*60)
    print(f"[+] Extraction complete!")
    print(f"[+] Total laws: {len(all_laws)}")
    print(f"[+] Output: {OUTPUT_DIR}")
    print("="*60)

if __name__ == "__main__":
    main()
