#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch cabinet decision from BOE Viewer page"""

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

# Cabinet decision viewer URL
viewer_url = f"{BASE_URL}/BoeLaws/Laws/Viewer/1de38443-93ea-4540-9be9-40e8c35d7ae7?lawId=bdf15375-52e6-4c94-9153-a9a700f16cc3"

print(f"[*] Fetching viewer page...")
response = session.get(viewer_url, timeout=30)
response.encoding = 'utf-8'
html = response.text

print(f"[*] Page size: {len(html)} bytes")

soup = BeautifulSoup(html, 'html.parser')

# Find HTMLContainer
containers = soup.find_all('div', class_='HTMLContainer')
print(f"[*] Found {len(containers)} HTMLContainer divs\n")

for idx, container in enumerate(containers):
    container_copy = BeautifulSoup(str(container), 'html.parser')
    for br in container_copy.find_all('br'):
        br.replace_with('\n')

    text = container_copy.get_text(separator=' ', strip=False)
    lines = [' '.join(line.split()) for line in text.split('\n') if line.strip()]
    text = '\n'.join(lines)

    print(f"=== Container {idx+1} (length={len(text)}) ===")
    print(text[:500])
    if len(text) > 500:
        print(f"\n... ({len(text) - 500} more chars)")
    print()

# Also check for any text directly in the page body
print("=== Full page text (first 1000 chars) ===")
body = soup.find('body')
if body:
    text = body.get_text(strip=True)
    print(text[:1000])
