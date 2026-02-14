const Database = require('better-sqlite3');
const db = new Database(__dirname + '/../data.db');

// Fix dates that are in DD/MM/YYYY format instead of YYYY/MM/DD
// These 6 records have dates like 03/01/1436 where the year is at the end
const reversed = db.prepare(`
  SELECT id, serial, tameem_date, year_hijri
  FROM moj_tameems
  WHERE CAST(substr(tameem_date, 1, 4) AS INTEGER) != year_hijri
`).all();

console.log('Found ' + reversed.length + ' dates to fix:');

const update = db.prepare('UPDATE moj_tameems SET tameem_date = ? WHERE id = ?');
const txn = db.transaction(() => {
  reversed.forEach(r => {
    // Date is in DD/MM/YYYY format - reverse to YYYY/MM/DD
    const parts = r.tameem_date.split('/');
    if (parts.length === 3) {
      const year = parts[2]; // Last part should be the year
      const month = parts[1];
      const day = parts[0];

      // Verify the year matches year_hijri
      if (parseInt(year) === r.year_hijri) {
        const newDate = year + '/' + month + '/' + day;
        console.log('  ID:' + r.id + ' serial:' + r.serial + ' "' + r.tameem_date + '" -> "' + newDate + '"');
        update.run(newDate, r.id);
      } else {
        console.log('  ID:' + r.id + ' SKIPPED - year mismatch: ' + year + ' vs ' + r.year_hijri);
      }
    }
  });
});
txn();

// Verify
const check = db.prepare(`
  SELECT id, tameem_date, year_hijri
  FROM moj_tameems
  WHERE CAST(substr(tameem_date, 1, 4) AS INTEGER) != year_hijri
`).all();
console.log('\nRemaining mismatches after fix: ' + check.length);
if (check.length > 0) check.forEach(r => console.log('  ' + JSON.stringify(r)));

console.log('Done.');
