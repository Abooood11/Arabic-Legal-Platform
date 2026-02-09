#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test cabinet decision extraction on one law - standalone"""

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

def clean_text(elem):
    elem_copy = BeautifulSoup(str(elem), 'html.parser')
    for br in elem_copy.find_all('br'):
        br.replace_with('\n')
    text = elem_copy.get_text(separator=' ', strip=False)
    lines = [' '.join(line.split()) for line in text.split('\n') if line.strip()]
    return '\n'.join(lines)

def extract_cabinet_decision(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    article_divs = soup.find_all('div', class_=re.compile(r'article_item'))
    if not article_divs:
        return None, None

    first_article = article_divs[0]
    parent = first_article.parent
    if not parent:
        return None, None

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

        if tag in ('h4', 'h3', 'h2') and 'قرار' in text and 'مجلس الوزراء' in text:
            cabinet_header = text
            in_cabinet_section = True
            cabinet_body_parts = []
            continue

        if in_cabinet_section:
            if tag in ('h3', 'h4', 'h2') and 'بسم الله' not in text:
                break
            if tag == 'div' and 'HTMLContainer' not in (child.get('class') or []):
                break
            if 'بسم الله الرحمن الرحيم' in text and len(text) < 30:
                continue
            body_text = clean_text(child)
            if body_text:
                cabinet_body_parts.append(body_text)

    if cabinet_header and cabinet_body_parts:
        return cabinet_header, cabinet_header + '\n' + '\n'.join(cabinet_body_parts)
    elif cabinet_header:
        return cabinet_header, cabinet_header
    return None, None


law_id = "bdf15375-52e6-4c94-9153-a9a700f16cc3"
print(f"[*] Testing: {law_id}")
url = f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}/1"
r = session.get(url, timeout=30)
r.encoding = 'utf-8'

header, full_text = extract_cabinet_decision(r.text)

if full_text:
    print(f"\n[+] Header: {header}")
    print(f"\n[+] Full text ({len(full_text)} chars):")
    print(full_text)
else:
    print("\n[-] No cabinet decision found")
