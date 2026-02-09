#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extract Cabinet Decisions (قرار مجلس الوزراء) from BOE and add to existing JSON files.
Does NOT modify any existing data - only adds cabinet_decision_text field.

BOE page structure before first article:
  <h3> Title
  <h3> Year
  <p>  بسم الله الرحمن الرحيم
  <h4> مرسوم ملكي رقم ...
  <div class="HTMLContainer"> Royal Decree text
  <p>  بسم الله الرحمن الرحيم
  <h4> قرار مجلس الوزراء رقم ...
  <p>  إن مجلس الوزراء ...
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

# Fix Windows encoding
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://laws.boe.gov.sa"
LAWS_DIR = Path(__file__).parent.parent / "client" / "public" / "data" / "laws"

session = requests.Session()
session.verify = False
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'ar',
})


def fetch_law_page(law_id):
    """Fetch the law detail page from BOE"""
    url = f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1"
    try:
        response = session.get(url, timeout=30)
        response.encoding = 'utf-8'
        return response.text
    except Exception as e:
        print(f"  [!] Failed to fetch: {e}")
        return None


def clean_text(elem):
    """Extract clean text from an element, preserving line breaks"""
    elem_copy = BeautifulSoup(str(elem), 'html.parser')
    for br in elem_copy.find_all('br'):
        br.replace_with('\n')
    text = elem_copy.get_text(separator=' ', strip=False)
    lines = [' '.join(line.split()) for line in text.split('\n') if line.strip()]
    return '\n'.join(lines)


def extract_cabinet_decision(html_content):
    """
    Extract cabinet decision text from BOE law page HTML.

    Walks through all elements before the first article_item div.
    Looks for the pattern:
      <h4> قرار مجلس الوزراء رقم ...
      <p>  إن مجلس الوزراء ...

    Returns: (header_text, body_text) or (None, None)
    """
    soup = BeautifulSoup(html_content, 'html.parser')

    # Find first article div
    article_divs = soup.find_all('div', class_=re.compile(r'article_item'))
    if not article_divs:
        return None, None

    first_article = article_divs[0]
    parent = first_article.parent
    if not parent:
        return None, None

    # Walk through siblings before first article
    cabinet_header = None
    cabinet_body_parts = []
    in_cabinet_section = False

    for child in parent.children:
        if child == first_article:
            break

        if not hasattr(child, 'get_text'):
            continue

        text = child.get_text(strip=True)
        if not text:
            continue

        tag = child.name or ''

        # Detect cabinet decision header
        if tag in ('h4', 'h3', 'h2') and 'قرار' in text and 'مجلس الوزراء' in text:
            cabinet_header = text
            in_cabinet_section = True
            cabinet_body_parts = []
            continue

        # If we're in cabinet section, collect body text
        if in_cabinet_section:
            # Stop if we hit another section header (but not بسم الله)
            if tag in ('h3', 'h4', 'h2') and 'بسم الله' not in text:
                break

            # Stop at non-text divs (like the law title div before articles)
            if tag == 'div' and 'HTMLContainer' not in (child.get('class') or []):
                break

            # Skip "بسم الله الرحمن الرحيم" between sections
            if 'بسم الله الرحمن الرحيم' in text and len(text) < 30:
                continue

            body_text = clean_text(child)
            if body_text:
                cabinet_body_parts.append(body_text)

    if cabinet_header and cabinet_body_parts:
        full_text = cabinet_header + '\n' + '\n'.join(cabinet_body_parts)
        return cabinet_header, full_text
    elif cabinet_header:
        return cabinet_header, cabinet_header

    return None, None


def main():
    print("=" * 60)
    print("Extract Cabinet Decisions from BOE")
    print("=" * 60 + "\n")

    # Find all BOE law files
    boe_files = sorted(LAWS_DIR.glob("*_boe.json"))
    print(f"[*] Found {len(boe_files)} BOE law files\n")

    results = {'success': [], 'already': [], 'no_decision': [], 'error': []}

    for i, filepath in enumerate(boe_files, 1):
        # Load existing JSON
        with open(filepath, 'r', encoding='utf-8') as f:
            law_data = json.load(f)

        law_id = law_data.get('law_id', filepath.stem.replace('_boe', ''))
        title = law_data.get('title', law_data.get('law_name', 'Unknown'))

        # Skip if already has cabinet_decision_text
        if law_data.get('cabinet_decision_text'):
            print(f"[{i}/{len(boe_files)}] SKIP (already exists): {title[:50]}")
            results['already'].append(law_id)
            continue

        print(f"[{i}/{len(boe_files)}] {title[:60]}...")

        # Fetch page from BOE
        html = fetch_law_page(law_id)
        if not html:
            results['error'].append(law_id)
            time.sleep(2)
            continue

        # Extract cabinet decision
        header, full_text = extract_cabinet_decision(html)

        if full_text:
            # Add to existing data WITHOUT modifying anything else
            law_data['cabinet_decision_text'] = full_text

            # Save back
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(law_data, f, ensure_ascii=False, indent=2)

            preview = full_text[:80].replace('\n', ' ')
            print(f"  [+] Found: {preview}...")
            results['success'].append(law_id)
        else:
            print(f"  [-] No cabinet decision found")
            results['no_decision'].append(law_id)

        # Be nice to the server
        time.sleep(2)

    # Summary
    print(f"\n{'=' * 60}")
    print(f"Results:")
    print(f"  Extracted:  {len(results['success'])}")
    print(f"  Already OK: {len(results['already'])}")
    print(f"  Not found:  {len(results['no_decision'])}")
    print(f"  Errors:     {len(results['error'])}")
    print(f"{'=' * 60}")

    if results['no_decision']:
        print(f"\nLaws without cabinet decision:")
        for lid in results['no_decision']:
            print(f"  - {lid}")


if __name__ == "__main__":
    main()
