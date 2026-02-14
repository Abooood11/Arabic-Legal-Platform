const Database = require('better-sqlite3');
const db = new Database(__dirname + '/../data.db');

console.log('=== TAMEEMS DATA QUALITY CHECK ===\n');

// Total count
const total = db.prepare('SELECT COUNT(*) as cnt FROM moj_tameems').get();
console.log('Total tameems: ' + total.cnt);

// Duplicate serials
const dupes = db.prepare('SELECT serial, COUNT(*) as cnt FROM moj_tameems GROUP BY serial HAVING cnt > 1').all();
console.log('Duplicate serials: ' + (dupes.length > 0 ? JSON.stringify(dupes) : 'NONE - OK'));

// Empty fields
const emptySubject = db.prepare("SELECT COUNT(*) as cnt FROM moj_tameems WHERE subject IS NULL OR subject = ''").get();
const emptyDate = db.prepare("SELECT COUNT(*) as cnt FROM moj_tameems WHERE tameem_date IS NULL OR tameem_date = ''").get();
const emptyNum = db.prepare("SELECT COUNT(*) as cnt FROM moj_tameems WHERE tameem_number IS NULL OR tameem_number = ''").get();
const emptyText = db.prepare("SELECT COUNT(*) as cnt FROM moj_tameems WHERE text IS NULL OR text = ''").get();
console.log('Empty subjects: ' + emptySubject.cnt);
console.log('Empty dates: ' + emptyDate.cnt);
console.log('Empty numbers: ' + emptyNum.cnt);
console.log('Empty text: ' + emptyText.cnt);

// Year vs date consistency
const yearMismatch = db.prepare("SELECT id, serial, tameem_date, year_hijri FROM moj_tameems WHERE CAST(substr(tameem_date, 1, 4) AS INTEGER) != year_hijri").all();
console.log('\nYear vs date mismatches: ' + yearMismatch.length);
if (yearMismatch.length > 0) {
  yearMismatch.forEach(r => console.log('  ID:' + r.id + ' serial:' + r.serial + ' date:' + r.tameem_date + ' year:' + r.year_hijri));
}

// Very short texts (possible truncation)
const shortTexts = db.prepare('SELECT id, serial, subject, length(text) as len FROM moj_tameems WHERE length(text) < 100 ORDER BY len').all();
console.log('\nTameems with text < 100 chars (' + shortTexts.length + '):');
shortTexts.forEach(r => console.log('  ID:' + r.id + ' serial:' + r.serial + ' subject:' + r.subject + ' len:' + r.len));

// Check for date format consistency (some use leading zeros, some don't)
const dateWithZeros = db.prepare("SELECT COUNT(*) as cnt FROM moj_tameems WHERE tameem_date LIKE '%/0%'").get();
const dateWithoutZeros = db.prepare("SELECT COUNT(*) as cnt FROM moj_tameems WHERE tameem_date NOT LIKE '%/0%'").get();
console.log('\nDate format: ' + dateWithZeros.cnt + ' with leading zeros, ' + dateWithoutZeros.cnt + ' without');

// Check for unusual characters in subjects
const rows = db.prepare('SELECT id, serial, subject FROM moj_tameems').all();
const unusual = rows.filter(r => /[a-zA-Z0-9]/.test(r.subject));
console.log('\nSubjects with English/numbers: ' + unusual.length);
unusual.forEach(r => console.log('  ID:' + r.id + ' serial:' + r.serial + ' subject:' + r.subject));

// Check for tameems with special diacritics in subject (tilde ~ etc)
const withDiacritics = rows.filter(r => /[ـ]/.test(r.subject));
console.log('\nSubjects with tatweel (ـ): ' + withDiacritics.length);
withDiacritics.slice(0, 10).forEach(r => console.log('  ID:' + r.id + ' subject: "' + r.subject + '"'));

console.log('\n=== DONE ===');
