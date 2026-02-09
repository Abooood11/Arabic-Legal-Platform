const Database = require('better-sqlite3');
const db = new Database('data.db');

console.log('🔄 Rebuilding FTS index with improved settings...\n');

// Drop old FTS table
db.exec('DROP TABLE IF EXISTS judgments_fts;');
console.log('✅ Old FTS table dropped');

// Create new FTS5 table with better tokenization
db.exec(`
    CREATE VIRTUAL TABLE judgments_fts USING fts5(
        text,
        court_body,
        content='judgments',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
    );
`);
console.log('✅ New FTS table created with unicode61 tokenizer + diacritics removal');

// Populate FTS index
console.log('📊 Populating FTS index (this may take a minute)...');
db.exec('INSERT INTO judgments_fts(rowid, text, court_body) SELECT id, text, court_body FROM judgments;');

const count = db.prepare('SELECT COUNT(*) as count FROM judgments_fts').get();
console.log(`✅ FTS index populated with ${count.count.toLocaleString()} judgments\n`);

console.log('🎉 Done! Search is now faster and more accurate.');
