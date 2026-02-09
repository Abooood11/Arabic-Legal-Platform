import requests, urllib3, json, re
from bs4 import BeautifulSoup

urllib3.disable_warnings()
session = requests.Session()
session.verify = False

# Fetch law
response = session.get('https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/ff94406f-9cba-4e01-bc22-a9a700f27d2b/1', timeout=30)
soup = BeautifulSoup(response.content, 'html.parser')

# Parse article 2
articles = soup.find_all('div', class_=lambda x: x and 'article_item' in ' '.join(x))

for article_div in articles:
    h3 = article_div.find('h3')
    if h3 and 'الثانية' in h3.text:
        container = article_div.find('div', class_='HTMLContainer')
        
        # Extract text
        html_copy = container.__copy__()
        for br in html_copy.find_all('br'):
            br.replace_with('\n')
        for p in html_copy.find_all('p'):
            p_text = p.get_text()
            p.replace_with(p_text + '\n')
        
        text = html_copy.get_text(separator=' ', strip=False)
        lines = [' '.join(line.split()) for line in text.split('\n') if line.strip()]
        
        # Extract paragraphs
        para_pattern = r'^([أ-ي]|جـ|[٠-٩]+|[0-9]+)\s*[-:]\s*(.+)$'
        
        paragraphs = []
        for line in lines:
            match = re.match(para_pattern, line)
            if match:
                marker_text = match.group(1)
                content = match.group(2).strip()
                
                # Determine level
                if marker_text in ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي']:
                    level = 2
                else:
                    level = 1
                
                paragraphs.append({
                    "marker": marker_text + ' -',
                    "text": content,
                    "level": level
                })
            else:
                paragraphs.append({
                    "marker": "",
                    "text": line,
                    "level": 0
                })
        
        print('المادة الثانية:')
        print(f'عدد الفقرات: {len(paragraphs)}\n')
        for i, p in enumerate(paragraphs):
            print(f'{i+1}. المستوى {p["level"]} | العلامة: [{p["marker"]:10s}] | {p["text"][:60]}...')
        break
