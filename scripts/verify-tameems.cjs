const path = require("path");
const Database = require("better-sqlite3");
const DB_PATH = path.join(__dirname, "..", "data.db");

function main() {
  console.log("=".repeat(80));
  console.log("  MOJ Tameems Data Verification Report");
  console.log("  Generated:", new Date().toISOString());
  console.log("=".repeat(80));
  console.log();
  const db = new Database(DB_PATH, { readonly: true });
  const allTameems = db.prepare("SELECT * FROM moj_tameems ORDER BY id").all();
  console.log("Total tameems in database: " + allTameems.length);
  console.log();
  const issues = [];

  // CHECK 1: Duplicate Serials
  console.log("-".repeat(80));
  console.log("CHECK 1: Duplicate Serials");
  console.log("-".repeat(80));
  const serialCounts = {};
  for (const t of allTameems) serialCounts[t.serial] = (serialCounts[t.serial] || 0) + 1;
  const duplicateSerials = Object.entries(serialCounts).filter(e => e[1] > 1).sort((a,b) => b[1]-a[1]);
  if (duplicateSerials.length === 0) console.log("  PASS: No duplicate serials found.");
  else {
    console.log("  FAIL: " + duplicateSerials.length + " serials appear more than once:");
    for (const [serial, count] of duplicateSerials) {
      const dupes = allTameems.filter(t => t.serial === serial);
      console.log("    Serial " + serial + " appears " + count + " times:");
      for (const d of dupes) console.log("      id=" + d.id + " num=" + d.tameem_number + " date=" + d.tameem_date + " subj=" + (d.subject||"").substring(0,50));
      issues.push({ check: "duplicate_serial", serial, count });
    }
  }
  console.log();
  // CHECK 2: Empty / Null Fields
  console.log("-".repeat(80));
  console.log("CHECK 2: Empty / Null Fields");
  console.log("-".repeat(80));
  const fieldsToCheck = ["serial","tameem_number","tameem_date","subject","text","year_hijri"];
  let allFieldsOk = true;
  for (const field of fieldsToCheck) {
    const empties = allTameems.filter(t => { const v = t[field]; return v===null||v===undefined||(typeof v==="string"&&v.trim()===""); });
    if (empties.length > 0) {
      allFieldsOk = false;
      console.log("  WARN: " + empties.length + " tameems have empty/null " + field + ":");
      for (const e of empties.slice(0,5)) console.log("    id=" + e.id + " serial=" + e.serial + " " + field + "=" + JSON.stringify(e[field]));
      if (empties.length > 5) console.log("    ... and " + (empties.length-5) + " more");
      issues.push({ check: "empty_field", field, count: empties.length });
    }
  }
  if (allFieldsOk) console.log("  PASS: All key fields populated.");
  console.log();

  // CHECK 3: Date Format
  console.log("-".repeat(80));
  console.log("CHECK 3: Date Format Consistency");
  console.log("-".repeat(80));
  const hijriRe = /^(1[3-4]d{2})/(1[0-2]|0?[1-9])/(3[0-1]|[12]d|0?[1-9])$/;
  const badDates = [];
  const dateFormats = {};
  for (const t of allTameems) {
    if (!t.tameem_date) { badDates.push({id:t.id,serial:t.serial,date:t.tameem_date,reason:"null/empty"}); continue; }
    if (!hijriRe.test(t.tameem_date)) badDates.push({id:t.id,serial:t.serial,date:t.tameem_date,reason:"no match YYYY/M/D"});
    const p = t.tameem_date.split("/");
    const fmt = p[0].length+"/"+(p[1]?p[1].length:"?")+"/"+(p[2]?p[2].length:"?");
    dateFormats[fmt] = (dateFormats[fmt]||0)+1;
  }
  console.log("  Date format distribution:");
  for (const [f,c] of Object.entries(dateFormats).sort((a,b)=>b[1]-a[1])) console.log("    "+f+": "+c);
  if (badDates.length===0) console.log("  PASS: All dates match Hijri format.");
  else {
    console.log("  FAIL: "+badDates.length+" malformed dates:");
    for (const bd of badDates.slice(0,10)) console.log("    id="+bd.id+" serial="+bd.serial+" date="+JSON.stringify(bd.date)+" -- "+bd.reason);
    if (badDates.length>10) console.log("    ... and "+(badDates.length-10)+" more");
    issues.push({check:"bad_date_format",count:badDates.length});
  }
  console.log();
  // CHECK 4: year_hijri vs date year
  console.log("-".repeat(80));
  console.log("CHECK 4: year_hijri vs tameem_date Year");
  console.log("-".repeat(80));
  const yearMis = [];
  for (const t of allTameems) {
    if (!t.tameem_date||t.year_hijri==null) continue;
    const dy = parseInt(t.tameem_date.split("/")[0],10);
    if (!isNaN(dy)&&dy!==t.year_hijri) yearMis.push({id:t.id,serial:t.serial,yh:t.year_hijri,dy,date:t.tameem_date});
  }
  if (yearMis.length===0) console.log("  PASS: year_hijri matches date year.");
  else {
    console.log("  FAIL: "+yearMis.length+" mismatches:");
    for (const m of yearMis.slice(0,10)) console.log("    id="+m.id+" serial="+m.serial+" year_hijri="+m.yh+" date_year="+m.dy+" date="+m.date);
    if (yearMis.length>10) console.log("    ... and "+(yearMis.length-10)+" more");
    issues.push({check:"year_mismatch",count:yearMis.length});
  }
  console.log();

  // CHECK 5: tameem_number Format
  console.log("-".repeat(80));
  console.log("CHECK 5: tameem_number Format");
  console.log("-".repeat(80));
  const numPat = {};
  const oddNums = [];
  for (const t of allTameems) {
    if (!t.tameem_number) continue;
    const pat = t.tameem_number.replace(/d+/g,"N").replace(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+/g,"AR");
    numPat[pat] = (numPat[pat]||0)+1;
    if (t.tameem_number.length>50) oddNums.push({id:t.id,serial:t.serial,num:t.tameem_number,reason:"too long"});
  }
  console.log("  Top patterns:");
  for (const [p,c] of Object.entries(numPat).sort((a,b)=>b[1]-a[1]).slice(0,15)) console.log("    "+JSON.stringify(p)+": "+c);
  if (Object.keys(numPat).length>15) console.log("    ... and "+(Object.keys(numPat).length-15)+" more");
  if (oddNums.length===0) console.log("  PASS: No suspicious tameem_number values.");
  else { console.log("  WARN: "+oddNums.length+" suspicious:"); for (const o of oddNums) console.log("    "+JSON.stringify(o)); issues.push({check:"odd_number",count:oddNums.length}); }
  console.log();