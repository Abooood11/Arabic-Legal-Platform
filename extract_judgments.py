import json
import re
import argparse
from pathlib import Path

def clean_html(raw_html):
    """
    Remove HTML tags and entities from text.
    """
    if not raw_html:
        return ""
    # Remove HTML tags
    cleanr = re.compile('<.*?>')
    cleantext = re.sub(cleanr, '', raw_html)
    # Replace common HTML entities
    cleantext = cleantext.replace('&nbsp;', ' ').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&quot;', '"').replace('&hellip;', '...')
    # Normalize whitespace
    cleantext = re.sub(r'\s+', ' ', cleantext).strip()
    return cleantext

def extract_info(data):
    """
    Extracts structured data from the specific JSON format provided.
    Expects 'basic' and 'details' keys.
    """
    basic = data.get('basic', {})
    details = data.get('details', {})

    if not basic and not details:
        return None

    # Extract text from details
    raw_text = details.get('judgmentTextofRulling', '') or ''
    cleaned_text = clean_html(raw_text)

    # If no text, skip
    if not cleaned_text:
        return None

    info = {
        "case_id": basic.get('caseNumber'),
        "year_hijri": basic.get('hijriYear'),
        "city": basic.get('city'),
        "court_body": basic.get('courtName'),
        "circuit_type": basic.get('courtType'), # This seems to be an int in source, schema expects varchar? Checking schema... schema says varchar.
        "judgment_number": basic.get('judgementNumber'),
        "judgment_date": basic.get('judgementDate'),
        "text": cleaned_text,
        # mapping circuit_type to string if it's an int
        "circuit_type": str(basic.get('courtType')) if basic.get('courtType') is not None else None
    }

    return info

def main():
    parser = argparse.ArgumentParser(description='Extract structured data from legal judgment JSON files.')
    parser.add_argument('--input_dir', default=r'C:\Users\Alemr\Desktop\judicial_decisions\details', help='Directory containing JSON files')
    parser.add_argument('--output_file', default='extracted_judgments.json', help='Output JSON file path')

    args = parser.parse_args()

    input_path = Path(args.input_dir)
    output_file = args.output_file

    if not input_path.exists():
        print(f"Error: Input directory {input_path} does not exist.")
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
