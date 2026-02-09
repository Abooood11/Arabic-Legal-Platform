#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convert BOE laws to platform JSON format with full amendment support
"""

import json
import sys
import io
from pathlib import Path

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def convert_boe_to_platform(boe_law):
    """
    Convert BOE format to platform format with amendments, preamble, and proper formatting
    """

    # Generate law ID from title
    law_id = boe_law['law_id'].split('-')[0]  # First part of UUID

    platform_law = {
        "law_id": law_id,
        "law_name": boe_law['title'],
        "jurisdiction_ar": "السعودية",
        "doc_type": "official_text",
        "category": "law",
        "primary_source_id": "boe",
        "links": [
            {
                "source_id": "boe",
                "url": boe_law.get('url', ''),
                "label_ar": "هيئة الخبراء بمجلس الوزراء"
            }
        ],
        "total_articles": len(boe_law['articles']),
        "articles": []
    }

    # Add royal decree/preamble if present
    if boe_law.get('royal_decree') and boe_law['royal_decree'].get('text'):
        platform_law['royal_decree'] = boe_law['royal_decree']

    # Convert articles
    for article in boe_law['articles']:
        platform_article = {
            "number": article['number'] or 0,
            "text": article['text'],
            "number_text": article.get('number_text', ''),
        }

        # Add status metadata
        if article['status'] == 'amended':
            platform_article['tags'] = ['معدلة']
            platform_article['keywords'] = ['تعديل']

            # Store amendments as structured data
            if article.get('amendments'):
                platform_article['amendments'] = []
                for amendment in article['amendments']:
                    amendment_data = {
                        'description': amendment.get('description', ''),
                    }
                    if amendment.get('decree'):
                        amendment_data['decree'] = amendment['decree']
                    if amendment.get('date'):
                        amendment_data['date'] = amendment['date']
                    if amendment.get('new_text'):
                        amendment_data['new_text'] = amendment['new_text']

                    platform_article['amendments'].append(amendment_data)

        elif article['status'] == 'canceled':
            platform_article['tags'] = ['ملغاة']
            platform_article['keywords'] = ['ملغاة']
            platform_article['heading'] = 'مادة ملغاة'

        platform_law['articles'].append(platform_article)

    return platform_law

def main():
    if len(sys.argv) < 2:
        print("Usage: python boe_to_platform.py <boe_law.json>")
        sys.exit(1)

    input_file = Path(sys.argv[1])

    # Read BOE law
    with open(input_file, 'r', encoding='utf-8') as f:
        boe_law = json.load(f)

    # Convert to platform format
    platform_law = convert_boe_to_platform(boe_law)

    # Output
    print(json.dumps(platform_law, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
