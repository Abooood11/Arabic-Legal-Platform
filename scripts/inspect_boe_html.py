#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Inspect BOE HTML structure for preamble"""

import requests
from bs4 import BeautifulSoup
import sys
import io

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Disable SSL verification for BOE
import urllib3
urllib3.disable_warnings()

law_id = "16b97fcb-4833-4f66-8531-a9a700f161b6"
url = f"https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/{law_id}/1"

print(f"Fetching: {url}")
response = requests.get(url, verify=False)
soup = BeautifulSoup(response.content, 'html.parser')

# Save full HTML for manual inspection
with open('boe_laws/sample_law.html', 'w', encoding='utf-8') as f:
    f.write(soup.prettify())

print("\n=== Looking for preamble/royal decree ===")

# Check before first article
article_divs = soup.find_all('div', class_=lambda x: x and 'article_item' in x)
if article_divs:
    first_article = article_divs[0]
    # Find everything before first article
    preamble_content = []
    for elem in first_article.find_all_previous():
        if elem.name == 'div' and 'HTMLContainer' in elem.get('class', []):
            text = elem.get_text(strip=True)
            if text and len(text) > 20:
                preamble_content.append(text)

    if preamble_content:
        print(f"\nFound {len(preamble_content)} potential preamble sections:")
        for i, content in enumerate(preamble_content[:3]):
            print(f"\n--- Section {i+1} ---")
            print(content[:300])
    else:
        print("No preamble found before first article")

# Check for specific classes
print("\n=== Checking specific elements ===")
decree_div = soup.find('div', class_='royal-decree')
if decree_div:
    print("Found royal-decree div:", decree_div.get_text(strip=True)[:200])

law_header = soup.find('div', class_='law-header')
if law_header:
    print("Found law-header div:", law_header.get_text(strip=True)[:200])

print("\n=== All divs before first article (first 10) ===")
if article_divs:
    prev_divs = []
    for elem in first_article.find_all_previous('div'):
        prev_divs.append(elem)

    for i, div in enumerate(prev_divs[:10]):
        classes = div.get('class', [])
        text = div.get_text(strip=True)[:100]
        print(f"{i+1}. Classes: {classes}")
        if text:
            print(f"   Text: {text}")

print("\nSample HTML saved to: boe_laws/sample_law.html")
