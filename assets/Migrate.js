// ============================================================
//  ONE-TIME MOVE: "Present Assets List" (sites stacked in rows) -> three tabs with
//  every site in its own columns: Owned By Us / Contractor Vehicles / For Forms.
//  Run migrateToSiteColumns() once from the editor, then dropOldPresentList().
// ============================================================

var OLD_PRESENT_TAB = 'Present Assets List';
var OLD_BLOCKS = { 'TONK': [4, 21], 'SANWARIYA': [25, 39], 'KHAKHUNDA': [43, 58], 'NEWAI': [63, 78], 'AMARGARH': [83, 98], 'KACHOLA FACTORY': [103, 118] };
var OWN_HEADS = ALL_CATS.concat(['Asset In Transfer', 'Transferred Location']);
var FORM_CATS = ALL_CATS;     // For Forms: own + contractor per category, MISC. typed by hand

function colLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

/** First column (1-based) of a site's band in a tab whose bands are `width` columns + 1 spacer. */
function bandStart_(siteIndex, width) { return 1 + siteIndex * (width + 1); }

function migrateToSiteColumns() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The sheet is busy (a sync is running). Run again in a minute.');
  var log = [];
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var old = ss.getSheetByName(OLD_PRESENT_TAB);
    if (!old) throw new Error('No "' + OLD_PRESENT_TAB + '" tab to move from.');
    [OWN_TAB, CON_TAB, FORMS_TAB].forEach(function (n) { if (ss.getSheetByName(n)) throw new Error('"' + n + '" already exists - nothing changed.'); });

    var rowsN = old.getLastRow();
    var g = old.getRange(1, 1, rowsN, 28).getValues();                  // A..AB
    var miscF = old.getRange(1, 28, rowsN, 1).getFormulas();            // AB: MISC. for forms
    var clean = function (v) { return String(v == null ? '' : v).trim(); };

    // ---- read every site's block ----
    var data = {};
    LOCATION_BLOCKS.forEach(function (b) {
      var span = OLD_BLOCKS[b.name], d = { own: {}, con: {}, moving: [], going: [], misc: [], miscFormula: false, forms: {} };
      ALL_CATS.forEach(function (c) { d.own[c] = []; d.forms[c] = []; });
      CON_CATS.forEach(function (c) { d.con[c] = []; });
      for (var r = span[0] - 1; r <= span[1] - 1 && r < g.length; r++) {
        var row = g[r];
        ALL_CATS.forEach(function (c, i) { var v = clean(row[2 + i]); if (v) d.own[c].push(v); });          // C..I
        if (clean(row[10])) { d.moving.push(clean(row[10])); d.going.push(clean(row[11])); }                // K, L
        CON_CATS.forEach(function (c, i) { var v = clean(row[14 + i]); if (v) d.con[c].push(v); });        // O..T
        FORM_CATS.forEach(function (c, i) { var v = clean(row[21 + i]); if (v && v !== '#N/A') d.forms[c].push(v); }); // V..AB
        if (miscF[r][0]) d.miscFormula = true;
        else if (clean(row[27])) d.misc.push(clean(row[27]));
      }
      data[b.name] = d;
    });

    // ---- build the three tabs ----
    var own = makeSiteTab_(ss, OWN_TAB, 'OWNED BY US', OWN_HEADS, null);
    var con = makeSiteTab_(ss, CON_TAB, 'CONTRACTOR VEHICLES', CON_CATS, null);
    var frm = makeSiteTab_(ss, FORMS_TAB, 'FOR FORMS  (own + contractor, filled automatically - MISC. is typed by hand)', FORM_CATS, 'MISC.');
    var ownW = OWN_HEADS.length, conW = CON_CATS.length, frmW = FORM_CATS.length;

    LOCATION_BLOCKS.forEach(function (b, si) {
      var d = data[b.name], o0 = bandStart_(si, ownW), c0 = bandStart_(si, conW), f0 = bandStart_(si, frmW);
      var ownCols = ALL_CATS.map(function (c) { return d.own[c]; }).concat([d.moving, d.going]);
      ownCols.forEach(function (list, i) { writeColumn_(own, o0 + i, list); });
      CON_CATS.forEach(function (c, i) { writeColumn_(con, c0 + i, d.con[c]); });

      FORM_CATS.forEach(function (c, i) {
        var cell = frm.getRange(DATA_ROW, f0 + i);
        var oL = colLetter_(o0 + ALL_CATS.indexOf(c));
        if (c === 'MISC.') {
          if (d.miscFormula) cell.setFormula('=IFERROR(FILTER(\'' + OWN_TAB + '\'!' + oL + DATA_ROW + ':' + oL + ',\'' + OWN_TAB + '\'!' + oL + DATA_ROW + ':' + oL + '<>""),"")');
          else writeColumn_(frm, f0 + i, d.misc);
          return;
        }
        var cL = colLetter_(c0 + CON_CATS.indexOf(c));
        var both = '{\'' + OWN_TAB + '\'!' + oL + DATA_ROW + ':' + oL + ';\'' + CON_TAB + '\'!' + cL + DATA_ROW + ':' + cL + '}';
        cell.setFormula('=IFERROR(UNIQUE(FILTER(' + both + ',' + both + '<>"")),"")');
      });
    });
    SpreadsheetApp.flush();

    // ---- check: every name landed in the right place ----
    var ownT = readSiteTab_(ss, OWN_TAB), conT = readSiteTab_(ss, CON_TAB), frmT = readSiteTab_(ss, FORMS_TAB);
    var bad = 0, total = 0;
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    var filled = function (l) { return l.filter(function (x) { return x !== ''; }); };
    LOCATION_BLOCKS.forEach(function (b) {
      var d = data[b.name];
      ALL_CATS.forEach(function (c) { total += d.own[c].length; if (!same(filled(siteList_(ownT, b.name, c)), d.own[c])) { bad++; log.push('MISMATCH own ' + b.name + ' ' + c); } });
      CON_CATS.forEach(function (c) { total += d.con[c].length; if (!same(filled(siteList_(conT, b.name, c)), d.con[c])) { bad++; log.push('MISMATCH contractor ' + b.name + ' ' + c); } });
      total += d.moving.length;
      if (!same(filled(siteList_(ownT, b.name, IN_TRANSFER)), d.moving)) { bad++; log.push('MISMATCH in transfer ' + b.name); }
      FORM_CATS.forEach(function (c) {
        var now = filled(siteList_(frmT, b.name, c)).filter(function (x) { return x !== '#N/A'; });
        if (!same(now.slice().sort(), d.forms[c].slice().sort())) log.push('NOTE For Forms ' + b.name + ' ' + c + ': old ' + d.forms[c].length + ' -> new ' + now.length + ' [' + now.filter(function (x) { return d.forms[c].indexOf(x) < 0; }).join(' | ') + '] missing [' + d.forms[c].filter(function (x) { return now.indexOf(x) < 0; }).join(' | ') + ']');
      });
    });
    log.unshift('Moved ' + total + ' names, ' + bad + ' mismatches.');

    // ---- point the report tabs' formulas at For Forms ----
    log = log.concat(repointFormulas_(ss, frmT));
  } finally { lock.releaseLock(); }
  Logger.log(log.join('\n'));
  return log.join('\n');
}

/** A fresh tab: row 1 title, row 2 site names (merged over each band), row 3 headings. */
function makeSiteTab_(ss, name, title, heads, orangeHead) {
  var sh = ss.insertSheet(name, ss.getSheets().length);
  var w = heads.length, needCols = LOCATION_BLOCKS.length * (w + 1);
  if (sh.getMaxColumns() < needCols) sh.insertColumnsAfter(sh.getMaxColumns(), needCols - sh.getMaxColumns());
  if (sh.getMaxRows() < 300) sh.insertRowsAfter(sh.getMaxRows(), 300 - sh.getMaxRows());
  sh.getRange(1, 1).setValue(title).setFontWeight('bold').setFontSize(12);
  LOCATION_BLOCKS.forEach(function (b, si) {
    var c0 = bandStart_(si, w);
    sh.getRange(2, c0, 1, w).merge().setValue(b.name).setBackground('#ffff00').setFontWeight('bold').setFontSize(12)
      .setHorizontalAlignment('center').setBorder(true, true, true, true, null, null);
    sh.getRange(3, c0, 1, w).setValues([heads]).setFontWeight('bold').setHorizontalAlignment('center')
      .setBackground('#f3f3f3').setBorder(true, true, true, true, true, true);
    sh.getRange(DATA_ROW, c0, sh.getMaxRows() - DATA_ROW + 1, w).setHorizontalAlignment('center').setFontSize(10)
      .setBorder(null, true, null, true, true, null);
    sh.setColumnWidths(c0, w, 190);
    sh.setColumnWidth(c0 + w, 24);                                  // spacer
    if (orangeHead) {
      var oc = c0 + heads.indexOf(orangeHead);
      sh.getRange(2, oc, sh.getMaxRows() - 1, 1).setBackground('#ff9900');
      sh.getRange(2, c0, 1, w).setBackground('#ffff00');
    }
  });
  sh.setFrozenRows(3);
  return sh;
}

function writeColumn_(sh, col, list) {
  if (!list.length) return;
  if (sh.getMaxRows() < DATA_ROW + list.length - 1) sh.insertRowsAfter(sh.getMaxRows(), list.length + 50);
  sh.getRange(DATA_ROW, col, list.length, 1).setValues(list.map(function (v) { return [v]; }));
}

/** Formulas anywhere that read 'Present Assets List'!V..AB rows: re-point them at the same
 *  category in For Forms, for the site the tab is about (its name, else its C1). */
function repointFormulas_(ss, frmT) {
  var log = [], OLDCOL = { V: 'EXCAVATOR', W: 'TRACTORS', X: 'VAN & TANKERS', Y: 'JCB', Z: 'DUMPERS', AA: 'CRAWLER/ COMP.', AB: 'MISC.' };
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name === OLD_PRESENT_TAB || sh.getLastRow() < 1 || sh.getLastColumn() < 1) return;
    var rng = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()), f = rng.getFormulas();
    for (var r = 0; r < f.length; r++) for (var c = 0; c < f[r].length; c++) {
      var t = f[r][c];
      if (!t || t.indexOf(OLD_PRESENT_TAB) < 0) continue;
      var site = String(name).toUpperCase();
      if (!frmT.cols[site]) site = String(sh.getRange(1, 3).getDisplayValue()).trim().toUpperCase();
      if (!frmT.cols[site]) { log.push('LEFT ALONE (no site): ' + name + '!' + colLetter_(c + 1) + (r + 1)); continue; }
      var n = t.replace(/'Present Assets List'!([A-Z]+)(\d+):([A-Z]+)(\d+)/g, function (m, a, r1, b) {
        if (a !== b || !OLDCOL[a]) return m;
        var L = colLetter_(frmT.cols[site][OLDCOL[a]] + 1);
        return "'" + FORMS_TAB + "'!" + L + DATA_ROW + ':' + L;
      });
      if (n.indexOf(OLD_PRESENT_TAB) > -1) { log.push('STILL READS OLD TAB: ' + name + '!' + colLetter_(c + 1) + (r + 1)); continue; }
      sh.getRange(r + 1, c + 1).setFormula(n);
      log.push('Re-pointed ' + name + '!' + colLetter_(c + 1) + (r + 1) + ' to ' + site + ' in For Forms');
    }
  });
  return log;
}

/** Long names wrap inside their cell (instead of being cut off) on the three tabs, and a
 *  last check that every name on the old tab is still somewhere in the new ones. */
function tidySiteTabs() {
  var ss = SpreadsheetApp.openById(SHEET_ID), log = [];
  [OWN_TAB, CON_TAB, FORMS_TAB].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    sh.getRange(3, 1, sh.getMaxRows() - 2, sh.getMaxColumns()).setWrap(true).setVerticalAlignment('middle');
  });
  var old = ss.getSheetByName(OLD_PRESENT_TAB);
  if (old) {
    var have = {};
    [OWN_TAB, CON_TAB].forEach(function (n) {
      var t = readSiteTab_(ss, n);
      t.rows.forEach(function (r) { r.forEach(function (v) { if (String(v).trim()) have[String(v).trim()] = 1; }); });
    });
    var g = old.getRange(1, 1, old.getLastRow(), 20).getValues(), missing = [];
    LOCATION_BLOCKS.forEach(function (b) {
      var span = OLD_BLOCKS[b.name];
      for (var r = span[0] - 1; r <= span[1] - 1 && r < g.length; r++) [2, 3, 4, 5, 6, 7, 8, 10, 14, 15, 16, 17, 18, 19].forEach(function (c) {
        var v = String(g[r][c]).trim();
        if (v && !IGNORE_WORDS.includes(v.toUpperCase()) && !have[v]) missing.push(b.name + ': ' + v);
      });
    });
    log.push(missing.length ? 'ON OLD TAB BUT NOT IN NEW: ' + missing.join(' | ') : 'Old tab fully covered by the new tabs.');
  }
  Logger.log(log.join('\n'));
  return log.join('\n');
}

/** One-time: own vehicles parked in a site's MISC. column only because a form spelled their
 *  category differently ("TRACTOR") move to the category their latest form entry names. */
function fixMiscCategories() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The sheet is busy. Run again in a minute.');
  var log = [];
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID), formCat = {};
    var t = ss.getSheetByName('Asset Transfer Form').getDataRange().getValues();
    var r = ss.getSheetByName('Asset Receiving Form').getDataRange().getValues();
    var seen = [];
    t.slice(1).forEach(function (row) {
      var n = ''; for (var c = 4; c <= 11; c++) if (row[c]) { n = String(row[c]).trim(); break; }
      if (n) seen.push({ n: n, t: new Date(row[0]).getTime() || 0, cat: normCat_(row[3]) });
    });
    r.slice(1).forEach(function (row) { if (row[3]) seen.push({ n: String(row[3]).trim(), t: new Date(row[0]).getTime() || 0, cat: normCat_(row[7]) }); });
    seen.sort(function (a, b) { return a.t - b.t; }).forEach(function (e) { if (e.cat) formCat[e.n] = e.cat; });

    var own = readSiteTab_(ss, OWN_TAB);
    LOCATION_BLOCKS.forEach(function (b) {
      var misc = siteList_(own, b.name, 'MISC.');
      misc.forEach(function (name) {
        var cat = formCat[name];
        if (!name || !cat || cat === 'MISC.' || ALL_CATS.indexOf(cat) < 0) return;
        setSiteList_(own, b.name, 'MISC.', siteList_(own, b.name, 'MISC.').filter(function (x) { return x && x !== name; }));
        setSiteList_(own, b.name, cat, siteList_(own, b.name, cat).filter(String).concat([name]));
        log.push(b.name + ': ' + name + '  MISC. -> ' + cat);
      });
    });
    if (log.length) saveSiteTab_(own);
  } finally { lock.releaseLock(); }
  if (log.length) runMasterSync();     // re-sorts the columns
  Logger.log(log.length ? log.join('\n') : 'Nothing to move.');
  return log.join('\n');
}

/** One-time clean-up of the form records (30 Oct): category "TRACTOR" -> "TRACTORS", and the
 *  19 Aug entries' short name "RJ26GA4678" -> the full name every later entry uses. */
function fixFormHistory() {
  var FULL = 'RJ26GA4678 (MAHINDRA BLAZO 25 6X4 6C)';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The sheet is busy. Run again in a minute.');
  var log = [];
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var fix = function (tabName, catCol, nameCols) {           // 0-based columns
      var sh = ss.getSheetByName(tabName), v = sh.getDataRange().getValues();
      for (var r = 1; r < v.length; r++) {
        if (String(v[r][catCol]).trim() === 'TRACTOR') {
          sh.getRange(r + 1, catCol + 1).setValue('TRACTORS');
          log.push(tabName + ' row ' + (r + 1) + ': TRACTOR -> TRACTORS');
        }
        nameCols.forEach(function (c) {
          if (String(v[r][c]).trim() === 'RJ26GA4678') {
            sh.getRange(r + 1, c + 1).setValue(FULL);
            log.push(tabName + ' row ' + (r + 1) + ': RJ26GA4678 -> ' + FULL);
          }
        });
      }
    };
    fix('Asset Transfer Form', 3, [4, 5, 6, 7, 8, 9, 10, 11]);
    fix('Asset Receiving Form', 7, [3]);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  runMasterSync();
  Logger.log(log.length ? log.join('\n') : 'Nothing to change.');
  return log.join('\n');
}

/** After the move is checked: delete the old tab, but only when nothing reads it any more. */
function dropOldPresentList() {
  var ss = SpreadsheetApp.openById(SHEET_ID), old = ss.getSheetByName(OLD_PRESENT_TAB);
  if (!old) return 'already gone';
  var users = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getName() === OLD_PRESENT_TAB || sh.getLastRow() < 1) return;
    var rng = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn()));
    rng.getFormulas().forEach(function (row) {
      row.forEach(function (t) { if (t && t.indexOf(OLD_PRESENT_TAB) > -1) users.push(sh.getName() + ' (formula)'); });
    });
    rng.getDataValidations().forEach(function (row) {
      row.forEach(function (v) {
        if (!v) return;
        v.getCriteriaValues().forEach(function (x) {
          if (x && typeof x.getSheet === 'function' && x.getSheet().getName() === OLD_PRESENT_TAB) users.push(sh.getName() + ' (dropdown rule)');
        });
      });
    });
  });
  ss.getNamedRanges().forEach(function (n) { if (n.getRange().getSheet().getName() === OLD_PRESENT_TAB) users.push('named range ' + n.getName()); });
  if (users.length) { Logger.log('Kept: still read by ' + users.join(', ')); return 'kept'; }
  ss.deleteSheet(old);
  Logger.log('Old tab deleted.');
  return 'deleted';
}
