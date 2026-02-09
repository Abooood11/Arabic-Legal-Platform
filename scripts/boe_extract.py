#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BOE Laws Scraper - Extract all laws from laws.boe.gov.sa"""

import requests
import json
import time
import sys
import io
from pathlib import Path
import urllib3

# Fix Windows console encoding
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
    'Accept': 'application/json',
    'Accept-Language': 'ar',
})

def get_folders():
    """Get all law folders"""
    print("[*] Fetching folders...")
    url = f"{BASE_URL}/BoeLaws/Laws/GetFolders"
    r = session.get(url, timeout=30)
    data = r.json()

    if data.get('success'):
        folders = data.get('value', [])
        print(f"[+] Found {len(folders)} folders")
        for f in folders:
            print(f"    - {f['text']}")
        return folders
    return []

def save_json(filename, data):
    """Save data as JSON"""
    (OUTPUT_DIR / filename).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

def main():
    print("="*60)
    print("BOE Laws Scraper - laws.boe.gov.sa")
    print("="*60 + "\n")

    # Get folders
    folders = get_folders()
    save_json("folders.json", folders)

    print(f"\n[+] Saved to {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
