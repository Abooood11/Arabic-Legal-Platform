#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test article number extraction"""

import sys
import io

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Copy of the extract_article_number function
def extract_article_number(text):
    """Extract article number from Arabic text"""
    import re

    # Arabic number words - IMPORTANT: Order matters! Check longer numbers first
    arabic_numbers = [
        ('الحادية عشرة', 11),
        ('الثانية عشرة', 12),
        ('الثالثة عشرة', 13),
        ('الرابعة عشرة', 14),
        ('الخامسة عشرة', 15),
        ('السادسة عشرة', 16),
        ('السابعة عشرة', 17),
        ('الثامنة عشرة', 18),
        ('التاسعة عشرة', 19),
        ('العشرون', 20),
        ('الحادية والعشرون', 21),
        ('الثانية والعشرون', 22),
        ('الثالثة والعشرون', 23),
        ('الرابعة والعشرون', 24),
        ('الخامسة والعشرون', 25),
        ('السادسة والعشرون', 26),
        ('السابعة والعشرون', 27),
        ('الثامنة والعشرون', 28),
        ('التاسعة والعشرون', 29),
        ('الثلاثون', 30),
        ('الأولى', 1),
        ('الثانية', 2),
        ('الثالثة', 3),
        ('الرابعة', 4),
        ('الخامسة', 5),
        ('السادسة', 6),
        ('السابعة', 7),
        ('الثامنة', 8),
        ('التاسعة', 9),
        ('العاشرة', 10),
    ]

    # Check longer patterns first to avoid false matches
    for word, num in arabic_numbers:
        if word in text:
            print(f"Matched '{word}' -> {num}")
            return num

    # Try to find numeric representation
    number_match = re.search(r'[٠-٩\\d]+', text)
    if number_match:
        # Convert Arabic-Indic digits to Western
        arabic_digits = '٠١٢٣٤٥٦٧٨٩'
        western_digits = '0123456789'
        trans = str.maketrans(arabic_digits, western_digits)
        result = int(number_match.group().translate(trans))
        print(f"Matched numeric: {result}")
        return result

    print(f"NO MATCH for: {text}")
    return None

# Test cases
test_cases = [
    "المادة العاشرة",
    "المادة الحادية عشرة",
    "المادة الثانية عشرة",
    "المادة الثالثة عشرة",
]

for test in test_cases:
    print(f"\nTesting: {test}")
    result = extract_article_number(test)
    print(f"Result: {result}")
