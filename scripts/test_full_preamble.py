#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Show full preamble text from BOE page"""

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

soup = BeautifulSoup(response.text, 'html.parser')
article_divs = soup.find_all('div', class_=re.compile(r'article_item'))

if article_divs:
    first_article = article_divs[0]
    preamble_containers = []
    for elem in first_article.find_all_previous('div'):
        if 'HTMLContainer' in (elem.get('class') or []):
            preamble_containers.append(elem)
    preamble_containers.reverse()

    for idx, container in enumerate(preamble_containers):
        container_copy = BeautifulSoup(str(container), 'html.parser')
        for br in container_copy.find_all('br'):
            br.replace_with('\n')
        text = container_copy.get_text(separator=' ', strip=False)
        lines = [' '.join(line.split()) for line in text.split('\n') if line.strip()]
        text = '\n'.join(lines)

        print(f"=== Container {idx+1} (FULL TEXT - {len(text)} chars) ===")
        print(text)
        print()

# Also check ALL divs between body start and first article
print("\n=== ALL elements before first article ===")
if article_divs:
    # Get parent/ancestors path of first article
    first = article_divs[0]
    parent = first.parent
    print(f"First article parent: tag={parent.name}, class={parent.get('class')}")

    # Find all siblings before first article
    prev_siblings = []
    for sib in parent.children:
        if sib == first:
            break
        if hasattr(sib, 'get_text'):
            text = sib.get_text(strip=True)
            if text:
                prev_siblings.append((sib.name, sib.get('class'), text[:200]))

    for tag, cls, text in prev_siblings:
        print(f"  [{tag}] class={cls} => {text[:150]}")
