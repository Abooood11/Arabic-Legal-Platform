const Database = require('better-sqlite3');
const db = new Database(__dirname + '/../data.db');

const rows = db.prepare('SELECT id, text FROM moj_tameems').all();
let cleaned = 0;

const cleanText = db.prepare('UPDATE moj_tameems SET text = ? WHERE id = ?');
const txn = db.transaction(() => {
  rows.forEach(r => {
    let text = r.text;
    const original = text;

    // Remove trailing source markers on each line: / و, / ك, / ن (with various spacing)
    text = text.replace(/\s*[\/]\s*[وكن]\s*\.?\s*$/gm, '');

    // Clean up trailing whitespace on each line
    text = text.split('\n').map(line => line.trimEnd()).join('\n');

    // Remove trailing empty lines
    text = text.replace(/\n+$/, '');

    if (text !== original) {
      cleanText.run(text, r.id);
      cleaned++;
    }
  });
});
txn();
console.log('Cleaned ' + cleaned + ' tameems out of ' + rows.length);

// Verify
const sample = db.prepare("SELECT id, substr(text, -80) as ending FROM moj_tameems WHERE id IN (1, 5, 10, 331, 339)").all();
sample.forEach(s => console.log('ID: ' + s.id + ' | ' + s.ending));
