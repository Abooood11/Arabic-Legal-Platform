#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, sys, io
from pathlib import Path

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

LAWS_DIR = Path(__file__).parent.parent / "client" / "public" / "data" / "laws"

for f in sorted(LAWS_DIR.glob("*_boe.json")):
    with open(f, 'r', encoding='utf-8') as fh:
        d = json.load(fh)
    title = (d.get('title') or d.get('law_name', ''))[:45]
    has_rd = bool(d.get('royal_decree', {}).get('text'))
    has_cd = bool(d.get('cabinet_decision_text'))
    issuing = (d.get('issuing_authority') or '')[:90]
    print(f"{title:<45} | RD={has_rd} | CD={has_cd} | {issuing}")
