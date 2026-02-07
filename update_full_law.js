const fs = require('fs');

const decisionText = fs.readFileSync('attached_assets/Pasted--820-1444-11-24--1769725957404_1769725957405.txt', 'utf8');
const lawData = JSON.parse(fs.readFileSync('attached_assets/saudi_civil_law_(2)_1769724919399.json', 'utf8'));

lawData.cabinet_decision_text = decisionText;
lawData.cabinet_decision = {
    "number": "820",
    "date_hijri": "1444/11/24"
};

let preamble = lawData.preamble_text || "";
if (!preamble.includes('قرار مجلس الوزراء رقم (820)')) {
    if (preamble.includes('يقرر ما يلي:')) {
        const parts = preamble.split('يقرر ما يلي:');
        lawData.preamble_text = parts[0] + "وبعد الاطلاع على قرار مجلس الوزراء رقم (820) وتاريخ 1444/11/24هـ.\n\nيقرر ما يلي:" + parts[1];
    }
}

fs.writeFileSync('client/public/data/laws/civil_transactions_sa.json', JSON.stringify(lawData, null, 2), 'utf8');
