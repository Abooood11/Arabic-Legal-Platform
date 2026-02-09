#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Find cabinet decision tab/link in BOE page"""

import requests
from bs4 import BeautifulSoup
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

law_id = "bdf15375-52e6-4c94-9153-a9a700f16cc3"
url = f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1"
response = session.get(url, timeout=30)
response.encoding = 'utf-8'
html = response.text

soup = BeautifulSoup(html, 'html.parser')

# 1. Find tabs
print("=== TABS/NAV ===")
tabs = soup.find_all(['a', 'li', 'button'], class_=re.compile(r'tab|nav|pill', re.I))
for t in tabs:
    text = t.get_text(strip=True)[:100]
    href = t.get('href', '')
    onclick = t.get('onclick', '')
    print(f"  [{t.name}] text='{text}' href='{href}' onclick='{onclick[:80]}'")

# 2. Find links containing "قرار" or "cabinet" or "وزراء"
print("\n=== LINKS with قرار/وزراء ===")
all_links = soup.find_all('a')
for link in all_links:
    text = link.get_text(strip=True)
    href = link.get('href', '')
    if 'قرار' in text or 'وزراء' in text or 'cabinet' in href.lower():
        print(f"  text='{text[:80]}' href='{href}'")

# 3. Find text mentions of قرار مجلس الوزراء anywhere
print("\n=== ALL mentions of 'قرار مجلس الوزراء' ===")
full_text = soup.get_text()
for match in re.finditer(r'قرار مجلس الوزراء[^\.]{0,100}', full_text):
    print(f"  ...{match.group()[:120]}...")

# 4. Find any div/section with data attributes or IDs related to decree/cabinet
print("\n=== Divs with relevant IDs/classes ===")
for div in soup.find_all('div'):
    div_id = div.get('id', '')
    div_class = ' '.join(div.get('class', []))
    if any(k in (div_id + div_class).lower() for k in ['decree', 'cabinet', 'decision', 'preamble', 'royal', 'tool', 'instrument']):
        text = div.get_text(strip=True)[:60]
        print(f"  id='{div_id}' class='{div_class}' text='{text}'")

# 5. Check page /2 (second page) for royal decree tools
print("\n=== Checking page 2 ===")
url2 = f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/2"
try:
    r2 = session.get(url2, timeout=30)
    r2.encoding = 'utf-8'
    soup2 = BeautifulSoup(r2.text, 'html.parser')
    containers2 = soup2.find_all('div', class_='HTMLContainer')
    print(f"  Page 2 has {len(containers2)} HTMLContainer divs")
    for idx, c in enumerate(containers2[:5]):
        text = c.get_text(strip=True)[:150]
        print(f"  Container {idx}: {text}")
except Exception as e:
    print(f"  Error: {e}")

# 6. Look for issuing tools section
print("\n=== Issuing Authority / Tools Section ===")
for elem in soup.find_all(['div', 'span', 'td', 'th', 'label']):
    text = elem.get_text(strip=True)
    if any(k in text for k in ['أداة الإصدار', 'الأداة النظامية', 'جهة الإصدار', 'صدر بموجب']):
        parent_text = elem.parent.get_text(strip=True)[:200] if elem.parent else ''
        print(f"  [{elem.name}] '{text[:80]}' -> parent: '{parent_text[:120]}'")
