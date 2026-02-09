#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BOE (Bureau of Experts) Laws Scraper
استخراج جميع الأنظمة من موقع هيئة الخبراء
"""

import requests
import json
import time
from pathlib import Path
import urllib3

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://laws.boe.gov.sa"
OUTPUT_DIR = Path("boe_laws")
OUTPUT_DIR.mkdir(exist_ok=True)

session = requests.Session()
session.verify = False
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'ar,en;q=0.9',
    'Referer': 'https://laws.boe.gov.sa/BoeLaws/Laws/Folders'
})

def get_folders():
    """Get all law folders/categories"""
    print("📂 Fetching folders...")
    try:
        url = f"{BASE_URL}/BoeLaws/Laws/GetFolders"
        response = session.get(url, timeout=30)
        response.raise_for_status()

        data = response.json()
        if data.get('success'):
            folders = data.get('value', [])
            print(f"✅ Found {len(folders)} folders:")
            for folder in folders:
                print(f"   - {folder['text']} ({folder['value']})")
            return folders
        else:
            print(f"❌ Failed to get folders: {data.get('errorMessage')}")
            return []
    except Exception as e:
        print(f"❌ Error fetching folders: {e}")
        return []

def get_laws_in_folder(folder_id, folder_name):
    """Get all laws in a specific folder"""
    print(f"\n📚 Fetching laws in: {folder_name}")

    # Try different possible endpoints
    endpoints = [
        f"/BoeLaws/Laws/GetLawsByFolderId?folderId={folder_id}",
        f"/BoeLaws/Laws/LawsByFolder/{folder_id}",
        f"/BoeLaws/Laws/GetLaws?folderId={folder_id}",
    ]

    for endpoint in endpoints:
        try:
            url = BASE_URL + endpoint
            print(f"  Trying: {endpoint[:50]}...")
            response = session.get(url, timeout=30)

            if response.status_code == 200:
                # Try to parse as JSON
                try:
                    data = response.json()
                    if isinstance(data, dict):
                        laws = data.get('value') or data.get('data') or data.get('laws', [])
                    elif isinstance(data, list):
                        laws = data
                    else:
                        continue

                    if laws:
                        print(f"✅ Found {len(laws)} laws via {endpoint}")
                        return laws
                except:
                    # Maybe HTML response, try to extract data
                    pass

        except Exception as e:
            print(f"  ❌ {endpoint}: {e}")
            continue

    print(f"⚠️  Could not fetch laws for {folder_name}")
    return []

def get_law_details(law_id, law_name):
    """Get full details of a law including articles and amendments"""
    print(f"  📄 Fetching: {law_name[:50]}...")

    try:
        # Try to get law details
        url = f"{BASE_URL}/BoeLaws/Laws/LawDetails/{law_id}"
        response = session.get(url, timeout=30)

        if response.status_code == 200:
            # Save raw HTML for now
            output_file = OUTPUT_DIR / f"{law_id}.html"
            output_file.write_text(response.text, encoding='utf-8')
            print(f"    ✅ Saved HTML")
            return True
        else:
            print(f"    ❌ Status {response.status_code}")
            return False

    except Exception as e:
        print(f"    ❌ Error: {e}")
        return False

def main():
    print("=" * 60)
    print("BOE Laws Scraper")
    print("=" * 60)

    # Step 1: Get all folders
    folders = get_folders()

    if not folders:
        print("\n❌ No folders found. Exiting.")
        return

    # Save folders info
    folders_file = OUTPUT_DIR / "folders.json"
    folders_file.write_text(json.dumps(folders, ensure_ascii=False, indent=2), encoding='utf-8')

    # Step 2: Get laws from each folder
    all_laws = []

    for folder in folders:
        folder_id = folder['value']
        folder_name = folder['text']

        laws = get_laws_in_folder(folder_id, folder_name)

        for law in laws:
            law['folder'] = folder_name
            all_laws.append(law)

        time.sleep(1)  # Rate limiting

    # Save all laws list
    laws_file = OUTPUT_DIR / "all_laws.json"
    laws_file.write_text(json.dumps(all_laws, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f"\n📊 Total laws found: {len(all_laws)}")

    # Step 3: Download details for each law (optional - can be slow)
    if all_laws:
        print("\n⏳ Downloading law details... (this will take time)")

        for i, law in enumerate(all_laws, 1):
            law_id = law.get('value') or law.get('id') or law.get('lawId')
            law_name = law.get('text') or law.get('name') or law.get('title')

            if law_id:
                print(f"\n[{i}/{len(all_laws)}]")
                get_law_details(law_id, law_name)
                time.sleep(2)  # Be nice to the server

    print("\n" + "=" * 60)
    print("✅ Done!")
    print(f"📁 Output saved to: {OUTPUT_DIR}")
    print("=" * 60)

if __name__ == "__main__":
    main()
