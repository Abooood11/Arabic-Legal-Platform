#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test cabinet decision extraction on a single law"""

import requests
from bs4 import BeautifulSoup
import json
import sys
import io
import re
import urllib3

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://laws.boe.gov.sa"

session = requests.Session()
session.verify = False
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'ar',
})

# Test with: نظام المركز الوطني للوثائق والمحفوظات
law_id = "bdf15375-52e6-4c94-9153-a9a700f16cc3"

print(f"[*] Fetching law page: {law_id}")
url = f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1"
response = session.get(url, timeout=30)
response.encoding = 'utf-8'
html = response.text

print(f"[*] Page size: {len(html)} bytes")

soup = BeautifulSoup(html, 'html.parser')

# Find article divs
article_divs = soup.find_all('div', class_=re.compile(r'article_item'))
print(f"[*] Found {len(article_divs)} article divs")

if article_divs:
    first_article = article_divs[0]

    # Find all HTMLContainer divs before first article
    preamble_containers = []
    for elem in first_article.find_all_previous('div'):
        classes = elem.get('class') or []
        if 'HTMLContainer' in classes:
            preamble_containers.append(elem)

    preamble_containers.reverse()
    print(f"[*] Found {len(preamble_containers)} preamble containers\n")

    for idx, container in enumerate(preamble_containers):
        # Get text
        container_copy = BeautifulSoup(str(container), 'html.parser')
        for br in container_copy.find_all('br'):
            br.replace_with('\n')

        text = container_copy.get_text(separator=' ', strip=False)
        lines = [' '.join(line.split()) for line in text.split('\n') if line.strip()]
        text = '\n'.join(lines)

        print(f"--- Container {idx+1} (length={len(text)}) ---")
        print(text[:300])
        print("...")
        print()
else:
    # Try finding all HTMLContainer divs
    all_containers = soup.find_all('div', class_='HTMLContainer')
    print(f"[*] No article divs found. Total HTMLContainer divs: {len(all_containers)}")
    for idx, c in enumerate(all_containers[:5]):
        text = c.get_text(strip=True)[:200]
        print(f"  Container {idx}: {text[:100]}...")
