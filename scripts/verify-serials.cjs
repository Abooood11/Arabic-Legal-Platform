const Database = require('better-sqlite3');
const db = new Database(__dirname + '/../data.db');

// Serials from MOJ page 1 visible on screen
const checks = [
  {serial: '28127', expected_subject: 'المستعجلات', expected_date: '1404/7/3'},
  {serial: '26672', expected_subject: 'بلديات', expected_date: '1406/6/15'},
  {serial: '26944', expected_subject: 'تعزير', expected_date: '1404/7/10'},
  {serial: '26340', expected_subject: 'استحكام', expected_date: '1406/7/30'},
  {serial: '27131', expected_subject: 'حوادث السيارات', expected_date: '1392/7/3'},
  {serial: '27624', expected_subject: 'قتل الخطأ', expected_date: '1392/7/3'},
  {serial: '27133', expected_subject: 'حوادث السيارات', expected_date: '1398/6/21'},
  {serial: '26946', expected_subject: 'تعزير', expected_date: '1406/6/6'},
];

let ok = 0;
let issues = 0;

checks.forEach(c => {
  const row = db.prepare('SELECT serial, tameem_number, tameem_date, subject FROM moj_tameems WHERE serial = ?').get(c.serial);
  if (!row) {
    console.log('MISSING: Serial ' + c.serial);
    issues++;
    return;
  }
  const subjMatch = row.subject === c.expected_subject;
  const dateMatch = row.tameem_date === c.expected_date;

  if (subjMatch && dateMatch) {
    console.log('OK: Serial ' + c.serial + ' | ' + row.subject + ' | ' + row.tameem_date + ' | ' + row.tameem_number);
    ok++;
  } else {
    if (!subjMatch) console.log('SUBJECT MISMATCH Serial ' + c.serial + ': ours="' + row.subject + '" expected="' + c.expected_subject + '"');
    if (!dateMatch) console.log('DATE MISMATCH Serial ' + c.serial + ': ours="' + row.tameem_date + '" expected="' + c.expected_date + '"');
    issues++;
  }
});

console.log('\nResult: ' + ok + ' OK, ' + issues + ' issues out of ' + checks.length + ' checked');

// Also check total count
const total = db.prepare('SELECT COUNT(*) as cnt FROM moj_tameems').get();
console.log('Total tameems in DB: ' + total.cnt + ' (MOJ shows 339)');

// Check for any date format inconsistencies
const dateFormats = db.prepare("SELECT tameem_date, COUNT(*) as cnt FROM moj_tameems GROUP BY length(tameem_date) ORDER BY cnt DESC").all();
console.log('\nDate length distribution:');
dateFormats.forEach(d => console.log('  Length ' + d.tameem_date.length + ': ' + d.cnt + ' tameems (example: ' + d.tameem_date + ')'));

// Check for various date formats
const samples = db.prepare("SELECT tameem_date FROM moj_tameems ORDER BY RANDOM() LIMIT 20").all();
console.log('\nRandom date samples:');
samples.forEach(s => console.log('  ' + s.tameem_date));
