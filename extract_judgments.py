import json
import os
import re
import argparse
from pathlib import Path
from datetime import datetime

def clean_text(text):
    if not text:
        return ""
    # Remove "بيانات الحكم" and website navigation junk if present
    text = re.sub(r'بيانات الحكم', '', text)
    # Remove multiple spaces/newlines
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def extract_section(text, start_pattern, end_patterns):
    """
    Extracts text between a start pattern and one of the end patterns.
    """
    start_match = re.search(start_pattern, text, re.DOTALL)
    if not start_match:
        return None
    
    start_idx = start_match.end()
    remaining_text = text[start_idx:]
    
    best_end_idx = len(remaining_text)
    found_end = False
    
    for end_pat in end_patterns:
        end_match = re.search(end_pat, remaining_text, re.DOTALL)
        if end_match:
            if end_match.start() < best_end_idx:
                best_end_idx = end_match.start()
                found_end = True
                
    extracted = remaining_text[:best_end_idx].strip()
    return extracted if extracted else None

def extract_info(data):
    # Prefer 'text' content, fallback to 'content'
    raw_text = data.get('text', '') or data.get('content', '')
    if not raw_text:
        return None

    info = {
        # Meta from source file
        "url": data.get('url'),
        "slug": data.get('slug'),
        "scraped_at": data.get('scraped_at'),
        
        # extracted fields
        "case_number": None,
        "year_hijri": None,
        "court_type": None,
        "court_circuit": None,
        "city": None,
        "judgment_number": None,
        "judgment_date": None,
        "plaintiff": None,
        "defendant": None,
        "facts": None,
        "reasons": None,
        "ruling": None,
        "judge_name": None
    }
    
    # Normalized text for regex searching of short fields
    normalized_text = clean_text(raw_text)
    
    # --- Basic Info ---
    
    # Case Number
    case_num_match = re.search(r'(?:رقم القضية|القضية رقم)\s*[:\-]?\s*(\d+)', normalized_text)
    if case_num_match:
        info['case_number'] = case_num_match.group(1)

    # Year Hijri
    year_match = re.search(r'(?:لعام|عام)\s*(\d{4})', normalized_text)
    if year_match:
        info['year_hijri'] = year_match.group(1)

    # Court Type
    court_match = re.search(r'(المحكمة\s+(?:التجارية|الجزائية|الأحوال الشخصية|العامة|العمالية|الإدارية\s+العليا|الإدارية))', normalized_text)
    if court_match:
        info['court_type'] = court_match.group(1)
        
    # Court Circuit (الدائرة)
    circuit_match = re.search(r'(الدائرة\s+(?:الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|الجزائية|التجارية|الحقوقية|المرورية|[^:،\n\.]+))', normalized_text)
    if circuit_match:
        info['court_circuit'] = circuit_match.group(1).strip()

    # City
    cities = [
        "الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الأحساء", "الطائف", 
        "بريدة", "تبوك", "القطيف", "خميس مشيط", "الخبر", "حفر الباطن", "الجبيل", "الخرج", 
        "أبها", "حائل", "نجران", "ينبع", "صبيا", "الدوادمي", "بيشة", "أبو عريش", 
        "سراة عبيدة", "القنفذة", "محايل", "عنيزة", "الرس", "عرعر", "سكاكا", "الباحة", "جازان"
    ]
    for city in cities:
        if city in normalized_text[:1000]: # Search start of text usually
            info['city'] = city
            break

    # Judgment Number
    judgment_num_match = re.search(r'(?:رقم الحكم|الحكم رقم|الصك رقم|رقم الصك)\s*[:\-]?\s*(\d+)', normalized_text)
    if judgment_num_match:
        info['judgment_number'] = judgment_num_match.group(1)

    # Judgment Date
    date_match = re.search(r'(?:التاريخ|تاريخ|بتاريخ)\s*[:\-]?\s*(\d{1,4}[/\-]\d{1,2}[/\-]\d{1,4})', normalized_text)
    if date_match:
        info['judgment_date'] = date_match.group(1)

    # --- Parties ---
    
    # Plaintiff (المدعي)
    # Looking for "المدعي:" until "المدعى" or "ضد"
    plaintiff_match = re.search(r'(?:المدعي|المدعية)\s*[:\-]?\s*(.*?)(?:المدعى|ضد|السجل)', normalized_text)
    if plaintiff_match:
        info['plaintiff'] = plaintiff_match.group(1).strip()

    # Defendant (المدعى عليه)
    # Looking for "المدعى عليه:" until "الوقائع" or "الموضوع" or end of line/segment
    defendant_match = re.search(r'(?:المدعى عليه|المدعى عليها)\s*[:\-]?\s*(.*?)(?:الوقائع|وقائع|الدعوى|الموضوع|الحمد)', normalized_text)
    if defendant_match:
        info['defendant'] = defendant_match.group(1).strip()

    # --- Sections (Use raw text or normalized depending on formatting, normalized is safer for OCR inconsistencies) ---
    
    # 1. Facts (الوقائع)
    # From "الوقائع" to "الأسباب"
    info['facts'] = extract_section(normalized_text, r'(?:الوقائع|وقائع الدعوى)\s*[:\.]?', [r'الأسباب', r'أسباب الحكم'])
    
    # 2. Reasons (الأسباب)
    # From "الأسباب" to "الحكم"
    info['reasons'] = extract_section(normalized_text, r'(?:الأسباب|أسباب الحكم|تسبيب)\s*[:\.]?', [r'نص الحكم', r'منطوق الحكم', r'^الحكم\s*[:\.]'])
    
    # 3. Ruling (منطوق الحكم)
    # From "نص الحكم" or "الحكم" to end or Judge name
    info['ruling'] = extract_section(normalized_text, r'(?:نص الحكم|منطوق الحكم|حكمت الدائرة|انتهت الدائرة)\s*[:\.]?', [r'رئيس الدائرة', r'القاضي', r'عضو الدائرة', r'صلى الله وسلم'])

    # Judge Name
    judge_match = re.search(r'(?:رئيس الدائرة|القاضي|رئيس الجلسة)\s*[:\-]?\s*([^:،\.\n]+)', normalized_text)
    if judge_match:
        info['judge_name'] = judge_match.group(1).strip()
        
    return info

def main():
    parser = argparse.ArgumentParser(description='Extract structured data from legal judgment JSON files.')
    parser.add_argument('--input_dir', default='/home/user/moj_judgments/json/', help='Directory containing JSON files')
    parser.add_argument('--output_file', default='extracted_judgments.json', help='Output JSON file path')
    
    args = parser.parse_args()
    
    input_path = Path(args.input_dir)
    output_file = args.output_file
    
    if not input_path.exists():
        print(f"Error: Input directory {input_path} does not exist.")
        local_try = Path('json')
        if local_try.exists():
             print(f"Found 'json' directory locally, using that instead.")
             input_path = local_try
        else:
             print("Please provide a valid directory using --input_dir")
             return

    json_files = list(input_path.glob('*.json'))
    total_files = len(json_files)
    
    print(f"Found {total_files} JSON files in {input_path}")
    
    results = []
    processed_count = 0
    success_count = 0
    
    for file_path in json_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            info = extract_info(data)
            
            if info:
                # Add filename reference
                info['source_filename'] = file_path.name
                results.append(info)
                success_count += 1
            
        except Exception as e:
            print(f"Error processing {file_path.name}: {e}")
            
        processed_count += 1
        
        if processed_count % 100 == 0:
            print(f"Processed {processed_count}/{total_files} files...")

    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"\nExtraction complete.")
        print(f"Successfully processed: {success_count}/{total_files}")
        print(f"Results saved to: {output_file}")
        
    except Exception as e:
        print(f"Error saving output file: {e}")

if __name__ == "__main__":
    main()
