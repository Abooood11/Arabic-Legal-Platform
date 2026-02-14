const Database = require('better-sqlite3');
const db = new Database(__dirname + '/../data.db');

console.log('Rebuilding FTS index for moj_tameems...');

// Drop existing FTS table
try { db.exec('DROP TABLE IF EXISTS moj_tameems_fts'); } catch(e) {}

// Recreate FTS5 table with tatweel-stripped content
db.exec(`
  CREATE VIRTUAL TABLE moj_tameems_fts USING fts5(
    subject,
    tameem_number,
    text,
    content='moj_tameems',
    content_rowid='id'
  )
`);

// Populate with tatweel-stripped content for better search
const rows = db.prepare('SELECT id, subject, tameem_number, text FROM moj_tameems').all();
const insert = db.prepare('INSERT INTO moj_tameems_fts(rowid, subject, tameem_number, text) VALUES (?, ?, ?, ?)');

const stripTatweel = (s) => s ? s.replace(/\u0640/g, '') : s;

const txn = db.transaction(() => {
  rows.forEach(r => {
    insert.run(r.id, stripTatweel(r.subject), r.tameem_number, stripTatweel(r.text));
  });
});
txn();

console.log('Indexed ' + rows.length + ' tameems');

// Test search
const test = db.prepare(`
  SELECT COUNT(*) as cnt FROM moj_tameems t
  INNER JOIN moj_tameems_fts fts ON t.id = fts.rowid
  WHERE moj_tameems_fts MATCH 'دعوى'
`).get();
console.log('FTS search for "دعوى" (no tatweel): ' + test.cnt + ' results');

const test2 = db.prepare(`
  SELECT COUNT(*) as cnt FROM moj_tameems t
  INNER JOIN moj_tameems_fts fts ON t.id = fts.rowid
  WHERE moj_tameems_fts MATCH 'حوادث'
`).get();
console.log('FTS search for "حوادث": ' + test2.cnt + ' results');

console.log('Done.');
