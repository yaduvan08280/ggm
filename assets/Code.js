// ============================================================
//  GGM ASSETS - 100% LIVE SYNC + SMART RESTORE + CLOUD UPLOAD
// ============================================================

var SHEET_ID = '1ZkXxIEP4mqUu4zF1WwVAMYHLzBG8gaGCLPxIB_kkXC8';
var VEHICLE_SHEET_ID = '194PebQBGqTmdrLgrPnpmne_kLCCyQdlKP1a1IzdG2Pw'; 
var DRIVE_FOLDER_ID = '1aG-yoGaFJDhK4AhBTfdTM_x6wWTYSFC3';

// The sites. Each one is its own band of columns in the three present-asset tabs below.
var LOCATION_BLOCKS = [
  { name: 'TONK' }, { name: 'SANWARIYA' }, { name: 'KHAKHUNDA' },
  { name: 'NEWAI' }, { name: 'AMARGARH' }, { name: 'KACHOLA FACTORY' }
];

// PRESENT ASSETS: three tabs, every site side by side in its own band of columns.
// Row 2 = site name (first column of its band), row 3 = category / heading,
// vehicles from row 4 down with no row limit (nothing sits under a site any more).
//   Owned By Us          own vehicles (7 categories) + Asset In Transfer / Transferred Location
//   Contractor Vehicles  contractor vehicles (6 categories)
//   For Forms            formulas: own + contractor per category (MISC. is typed by hand).
//                        The Google Forms' dropdowns read this tab.
var OWN_TAB = 'Owned By Us';
var CON_TAB = 'Contractor Vehicles';
var FORMS_TAB = 'For Forms';
var DATA_ROW = 4;
var IN_TRANSFER = 'ASSET IN TRANSFER';
var TRANSFER_DEST = 'TRANSFERRED LOCATION';

var ALL_CATS = ['EXCAVATOR', 'TRACTORS', 'VAN & TANKERS', 'JCB', 'DUMPERS', 'CRAWLER/ COMP.', 'MISC.'];

// Contractor vehicles have six categories (no MISC).
var CON_CATS = ['EXCAVATOR', 'TRACTORS', 'VAN & TANKERS', 'JCB', 'DUMPERS', 'CRAWLER/ COMP.'];
// Which vehicles are contractor-owned, so one that is in transit (in the shared
// "Asset In Transfer" box) still lands back in the Contractors section.
var OWNERS_TAB = 'Asset Owners';
// Every removal is recorded here (who, when, why). Transfers / receipts older than an
// asset's removal are ignored, so a vehicle added again later is not moved by its past.
var REMOVED_TAB = 'Removed Assets';

// History tab: 18 columns from B. Indexes in each history row the page gets:
//  0 sent on, 1 asset, 2 from, 3 to, 4 -, 5 received on, 6 asset, 7 received at, 8 -,
//  9 sent by, 10 driver, 11 photos, 12 remarks, 13 received by, 14 driver, 15 photos, 16 remarks,
//  17 cancelled ("when | who | reason")
var HIST_COLS = 18;
var HIST_DETAIL = ['Sent By', 'Driver (sent)', 'Photos (sent)', 'Remarks (sent)', 'Received By', 'Driver (received)', 'Photos (received)', 'Remarks (received)', 'Cancelled (when | who | reason)'];
// Every cancelled transfer, with the reason (14 Nov 2026).
var CANCELLED_TAB = 'Cancelled Transfers';
var CANCELLED_HEAD = ['Cancelled At', 'Cancelled By', 'Asset', 'Category', 'From', 'To', 'Driver', 'Sent At', 'Sent By', 'Photos', 'Remarks', 'Reason'];

var TRANSFER_CAT_COLS = { 'EXCAVATOR': 4, 'VAN & TANKER': 5, 'VAN & TANKERS': 5, 'TRACTORS': 6, 'JCB': 7, 'DUMPERS': 8, 'CRAWLER/ COMP.': 9, 'MISCELLANEUOS': 10, 'MISC.': 10 };

/** A category as the forms spell it -> the sheet's heading (TRACTOR -> TRACTORS, DUMPER -> DUMPERS ...). */
function normCat_(cat) {
  var c = String(cat || '').trim().toUpperCase();
  if (!c) return '';
  if (c === 'MISCELLANEUOS' || c === 'MISCELLANEOUS' || c === 'MISC') return 'MISC.';
  if (c.indexOf('CRAWLER') > -1) return 'CRAWLER/ COMP.';
  if (c === 'TRACTOR') return 'TRACTORS';
  if (c === 'DUMPER') return 'DUMPERS';
  if (c === 'VAN & TANKER') return 'VAN & TANKERS';
  if (c === 'EXCAVATORS') return 'EXCAVATOR';
  return c;
}

var IGNORE_WORDS = ['TONK', 'SANWARIYA', 'KHAKHUNDA', 'NEWAI', 'AMARGARH', 'KACHOLA FACTORY', 'EXCAVATOR', 'TRACTORS', 'VAN & TANKER', 'VAN & TANKERS', 'JCB', 'DUMPERS', 'CRAWLER/ COMP.', 'CRAWLER', 'MISC.', 'MISCELLANEUOS', 'NAN', 'NA', 'N/A'];

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ LIVE SYNC SYSTEM')
    .addItem('🟢 Activate Live Updates & Triggers', 'activateLiveSystem')
    .addItem('🔒 Apply Strict Sheet Lock', 'secureSystemSheets')
    .addItem('🔄 Run Manual Sync Now', 'runMasterSync')
    .addItem('🩺 Health Check (forms vs sheet)', 'runHealthCheck')
    .addToUi();
}

function activateLiveSystem() {
  portalAssertEditor_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) { ScriptApp.deleteTrigger(triggers[i]); }
  
  ScriptApp.newTrigger('handleSheetChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('runMasterSync').forSpreadsheet(ss).onFormSubmit().create();
  
  try { secureSystemSheets(); } catch(e) { console.error("Security Lock Error: " + e); }
  
  SpreadsheetApp.getUi().alert("✅ SYSTEM ACTIVATED & SECURED!\n\nBackend is synced. Forms and History sheets are STRICTLY locked. Auto-Regeneration is active.");
}

function secureSystemSheets() {
  portalAssertEditor_();
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheetsToProtect = ['History', 'Asset Transfer Form', 'Asset Receiving Form'];
  var adminEmail = 'mis@ggminerals.com';
  var scriptOwner = Session.getEffectiveUser().getEmail(); 
  
  sheetsToProtect.forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (sheet) {
      var protection = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0];
      if (!protection) { protection = sheet.protect().setDescription('Strict System Lock: ' + name); }
      if (protection.canDomainEdit()) { protection.setDomainEdit(false); }
      
      var editors = protection.getEditors();
      protection.removeEditors(editors);
      protection.addEditor(adminEmail);
      if (scriptOwner) { protection.addEditor(scriptOwner); }
    }
  });
}

function handleSheetChange(e) {
  if (!e) return;
  var sheetName = e.source.getActiveSheet().getName();
  if (sheetName === 'Asset Transfer Form' || sheetName === 'Asset Receiving Form' || sheetName === 'History') { 
    runMasterSync(); 
  }
}

// LOCK SERVICE ADDED TO PREVENT OVERLAPPING
function runMasterSync() {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(15000)) {
    try { 
      updateHistorySafe();
      updatePresentAssetsSafe();
      try { healthCheck_(); } catch (h) { console.error('Health check: ' + h); }
    } catch(e) {
      console.error("Sync Error: " + e); 
    } finally {
      lock.releaseLock();
    }
  }
}

// ------------------------------------------------------------
//  HEALTH CHECK: after every sync the sheet is compared with the whole form history and
//  anything that does not add up is listed on the "Health Check" tab (empty = all good).
// ------------------------------------------------------------
var HEALTH_TAB = 'Health Check';
var NOTHING_IN_TRANSIT = '— Nothing in transit right now —';   // the Receiving form's placeholder choice
var STUCK_DAYS = 3;

function healthCheck_() {
  var ss = SpreadsheetApp.openById(SHEET_ID), problems = [];
  var sites = LOCATION_BLOCKS.map(function (b) { return b.name; });
  var okCat = function (c) { var n = normCat_(c); return !n || ALL_CATS.indexOf(n) > -1 || n === 'OTHER ASSET'; };
  var okSite = function (s) { return sites.indexOf(String(s || '').trim().toUpperCase()) > -1; };

  // where the sheet has each name now
  var where = {};
  [OWN_TAB, CON_TAB].forEach(function (n) {
    var t = readSiteTab_(ss, n);
    Object.keys(t.cols).forEach(function (site) {
      Object.keys(t.cols[site]).forEach(function (h) {
        if (h === TRANSFER_DEST) return;
        var c = t.cols[site][h];
        t.rows.forEach(function (r) {
          var v = String(r[c]).trim();
          if (v && !IGNORE_WORDS.includes(v.toUpperCase())) (where[v] = where[v] || []).push({ site: site, moving: h === IN_TRANSFER });
        });
      });
    });
  });
  var placeText = function (w) { return w ? w.map(function (x) { return x.moving ? 'in transfer from ' + x.site : x.site; }).join(' and ') : 'nowhere in the sheet'; };
  Object.keys(where).forEach(function (n) { if (where[n].length > 1) problems.push(['Listed more than once', n + ': ' + placeText(where[n])]); });

  // every form entry, oldest first (a receipt stamped the same moment as its transfer comes after it)
  var removed = readRemoved_(), events = [];
  var tSh = ss.getSheetByName('Asset Transfer Form'), rSh = ss.getSheetByName('Asset Receiving Form');
  var tData = tSh ? tSh.getDataRange().getValues() : [], rData = rSh ? rSh.getDataRange().getValues() : [];
  for (var i = 1; i < tData.length; i++) {
    var row = tData[i], name = '';
    for (var c = 4; c <= 11; c++) if (row[c]) { name = String(row[c]).trim(); break; }
    if (!name || !row[0]) continue;
    events.push({ kind: 'T', name: name, t: new Date(row[0]).getTime(), from: String(row[2]).trim().toUpperCase(), to: String(row[12]).trim().toUpperCase(), cat: row[3], where: 'Transfer row ' + (i + 1) });
  }
  for (var j = 1; j < rData.length; j++) {
    var rr = rData[j], rn = String(rr[3] || '').trim();
    if (!rn || !rr[0] || rn === NOTHING_IN_TRANSIT) continue;
    events.push({ kind: 'R', name: rn, t: new Date(rr[0]).getTime(), at: String(rr[2]).trim().toUpperCase(), cat: rr[7], where: 'Receiving row ' + (j + 1) });
  }
  events.sort(function (a, b) { return a.t - b.t || (a.kind === 'T' ? -1 : 1); });

  var last = {}, sentTo = {};
  events.forEach(function (e) {
    var gone = removed[e.name.toUpperCase()];
    if (gone && e.t <= gone) return;                                   // before the vehicle was removed
    if (!where[e.name]) { problems.push(['Form names a vehicle that is not in the sheet', e.where + ': "' + e.name + '" (spelling different from the sheet?)']); return; }
    if (!okCat(e.cat)) problems.push(['Unknown category', e.where + ': "' + e.cat + '" for ' + e.name]);
    if (e.kind === 'T') {
      if (!okSite(e.from) || !okSite(e.to)) problems.push(['Unknown site', e.where + ': ' + e.from + ' -> ' + e.to + ' for ' + e.name]);
      sentTo[e.name] = e.to;
    } else {
      if (!okSite(e.at)) problems.push(['Unknown site', e.where + ': received at "' + e.at + '" for ' + e.name]);
      if (sentTo[e.name] && sentTo[e.name] !== e.at) problems.push(['Received at a different site than it was sent to', e.where + ': ' + e.name + ' was sent to ' + sentTo[e.name] + ' but received at ' + e.at]);
      delete sentTo[e.name];
    }
    last[e.name] = e;
  });

  // the sheet must show each vehicle where its latest form entry puts it
  var now = Date.now();
  Object.keys(last).forEach(function (n) {
    var e = last[n], w = where[n] || [];
    if (e.kind === 'T') {
      var ok = w.length === 1 && w[0].moving && w[0].site === e.from;
      if (!ok) problems.push(['Sheet does not match the forms', n + ': sent ' + e.from + ' -> ' + e.to + ' (' + e.where + ') but the sheet shows it ' + placeText(w)]);
      var days = Math.floor((now - e.t) / 86400000);
      if (days > STUCK_DAYS) problems.push(['On the way for ' + days + ' days', n + ': sent ' + e.from + ' -> ' + e.to + ', not received yet']);
    } else {
      var ok2 = w.length === 1 && !w[0].moving && w[0].site === e.at;
      if (!ok2) problems.push(['Sheet does not match the forms', n + ': received at ' + e.at + ' (' + e.where + ') but the sheet shows it ' + placeText(w)]);
    }
  });

  var sh = ss.getSheetByName(HEALTH_TAB) || ss.insertSheet(HEALTH_TAB);
  sh.clearContents();
  var out = [['Last checked', new Date()],
             ['Result', problems.length ? problems.length + ' problem(s) - see below' : 'All good: every vehicle in the sheet matches the transfer / receiving history'],
             ['', ''], ['Problem', 'Details']].concat(problems);
  sh.getRange(1, 1, out.length, 2).setValues(out);
  return problems;
}

/** Menu / editor: run the check on its own and show the result. */
function runHealthCheck() {
  var p = healthCheck_();
  try { SpreadsheetApp.getUi().alert(p.length ? p.length + ' problem(s) found - see the "' + HEALTH_TAB + '" tab.' : 'All good - every vehicle matches its form history.'); } catch (e) {}
  return p;
}

function forceBackendSync(token) {
  assetsSession_(token);
  runMasterSync();
  return true;
}

/** One present-asset tab: where each site's columns are (from the headers in rows 2-3)
 *  and its vehicle rows from DATA_ROW down. { sheet, cols: {SITE: {HEADING: index}}, rows, width } */
function readSiteTab_(ss, tabName) {
  var sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error('The "' + tabName + '" tab is missing.');
  var width = sh.getLastColumn(), last = sh.getLastRow();
  var head = sh.getRange(2, 1, 2, width).getDisplayValues();
  var cols = {}, site = '';
  for (var c = 0; c < width; c++) {
    var s = String(head[0][c]).trim().toUpperCase(), h = String(head[1][c]).trim().toUpperCase();
    if (s) site = s;
    if (!h) { if (!s) site = ''; continue; }        // a blank spacer column ends a band
    if (site) (cols[site] = cols[site] || {})[h] = c;
  }
  var rows = last >= DATA_ROW ? sh.getRange(DATA_ROW, 1, last - DATA_ROW + 1, width).getValues() : [];
  return { sheet: sh, cols: cols, rows: rows, width: width };
}

/** Column index of a site's heading in a tab; throws when the tab has no such column. */
function siteCol_(tab, site, heading) {
  var c = (tab.cols[String(site).toUpperCase()] || {})[String(heading).toUpperCase()];
  if (c == null) throw new Error('"' + tab.sheet.getName() + '" has no ' + heading + ' column for ' + site + '.');
  return c;
}

/** The names in a site's column (trimmed, blanks kept so positions match the rows). */
function siteList_(tab, site, heading) {
  var c = siteCol_(tab, site, heading);
  return tab.rows.map(function (r) { return String(r[c]).trim(); });
}

/** Put a list into a site's column (in memory; saveSiteTab_ writes it). Longer lists add rows. */
function setSiteList_(tab, site, heading, list) {
  var c = siteCol_(tab, site, heading);
  while (tab.rows.length < list.length) tab.rows.push(new Array(tab.width).fill(''));
  for (var r = 0; r < tab.rows.length; r++) tab.rows[r][c] = list[r] || '';
}

/** Write a tab's vehicle rows back in one go, adding sheet rows when a list grew. */
function saveSiteTab_(tab) {
  if (!tab.rows.length) return;
  var sh = tab.sheet, needLast = DATA_ROW + tab.rows.length - 1;
  if (sh.getMaxRows() < needLast) sh.insertRowsAfter(sh.getMaxRows(), needLast - sh.getMaxRows() + 50);
  sh.getRange(DATA_ROW, 1, tab.rows.length, tab.width).setValues(tab.rows);
}

/** Put one name in the first free cell of a site's column (one cell written). */
function putSiteName_(tab, site, heading, name) {
  var c = siteCol_(tab, site, heading), list = siteList_(tab, site, heading), r = 0;
  while (r < list.length && !(list[r] === '' || IGNORE_WORDS.includes(list[r].toUpperCase()))) r++;
  var row = DATA_ROW + r, sh = tab.sheet;
  if (sh.getMaxRows() < row) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows() + 50);
  sh.getRange(row, c + 1).setValue(name);
  while (tab.rows.length <= r) tab.rows.push(new Array(tab.width).fill(''));
  tab.rows[r][c] = name;
}

/** Clear every cell holding this exact name in the given headings of a site. True when found. */
function clearSiteName_(tab, site, headings, name) {
  var found = false;
  headings.forEach(function (h) {
    var c = siteCol_(tab, site, h);
    tab.rows.forEach(function (r, i) {
      if (String(r[c]).trim() === name) { r[c] = ''; tab.sheet.getRange(DATA_ROW + i, c + 1).setValue(''); found = true; }
    });
  });
  return found;
}

function getGlobalAssetStatus_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ownTab = readSiteTab_(ss, OWN_TAB);
  var conTab = readSiteTab_(ss, CON_TAB);
  var transferSheet = ss.getSheetByName('Asset Transfer Form');
  var receiveSheet  = ss.getSheetByName('Asset Receiving Form');

  var allAssets = {}; var catDictionary = {};

  LOCATION_BLOCKS.forEach(function(block) {
    ALL_CATS.forEach(function (cat) {
      siteList_(ownTab, block.name, cat).forEach(function (name) {
        if (name && !IGNORE_WORDS.includes(name.toUpperCase())) {
          allAssets[name] = { cat: cat, location: block.name, status: 'AT_BASE', dest: '', owner: 'OWN' };
          catDictionary[name.toUpperCase()] = cat;
        }
      });
    });
  });
  LOCATION_BLOCKS.forEach(function(block) {
    CON_CATS.forEach(function (cat) {
      siteList_(conTab, block.name, cat).forEach(function (cname) {
        if (cname && !IGNORE_WORDS.includes(cname.toUpperCase()) && !allAssets[cname]) {
          allAssets[cname] = { cat: cat, location: block.name, status: 'AT_BASE', dest: '', owner: 'CONTRACTOR' };
          catDictionary[cname.toUpperCase()] = cat;
        }
      });
    });
  });
  var owners = readOwners_();

  var latestEvents = {};
  var removedAt = readRemoved_();
  
  if (transferSheet) {
    var tData = transferSheet.getDataRange().getValues();
    for (var i = 1; i < tData.length; i++) {
      var row = tData[i]; var ts = row[0] ? new Date(row[0]).getTime() : 0;
      var src = row[2] ? String(row[2]).trim().toUpperCase() : ''; var type = row[3] ? String(row[3]).trim().toUpperCase() : '';
      var dst = row[12] ? String(row[12]).trim().toUpperCase() : ''; var assetName = '';
      for (var c = 4; c <= 11; c++) { if (row[c]) { assetName = String(row[c]).trim(); break; } }
      if (!assetName || IGNORE_WORDS.includes(assetName.toUpperCase())) continue;
      
      var dbCat = normCat_(type) || 'MISC.';
      catDictionary[assetName.toUpperCase()] = dbCat;
      if (!ts || !src || !dst) continue;
      if (removedAt[assetName.toUpperCase()] && ts <= removedAt[assetName.toUpperCase()]) continue;   // from before it was removed
      if (!latestEvents[assetName] || ts > latestEvents[assetName].time) { latestEvents[assetName] = { type: 'TRANSFER', source: src, dest: dst, time: ts, cat: dbCat }; }
    }
  }

  if (receiveSheet) {
    var rData = receiveSheet.getDataRange().getValues();
    for (var j = 1; j < rData.length; j++) {
      var row = rData[j]; var ts = row[0] ? new Date(row[0]).getTime() : 0;
      var dest = row[2] ? String(row[2]).trim().toUpperCase() : ''; var name = row[3] ? String(row[3]).trim() : ''; var cat = row[7] ? String(row[7]).trim().toUpperCase() : ''; 
      if (!name || IGNORE_WORDS.includes(name.toUpperCase())) continue;
      var dbCat = normCat_(cat) || 'MISC.';
      catDictionary[name.toUpperCase()] = dbCat;
      if (!ts) continue;
      if (removedAt[name.toUpperCase()] && ts <= removedAt[name.toUpperCase()]) continue;   // from before it was removed
      // >= : a receipt stamped the same moment as its transfer still counts as received
      if (!latestEvents[name] || ts >= latestEvents[name].time) { latestEvents[name] = { type: 'RECEIVE', dest: dest, time: ts, cat: dbCat }; }
    }
  }

  LOCATION_BLOCKS.forEach(function(block) {
    var moving = siteList_(ownTab, block.name, IN_TRANSFER), going = siteList_(ownTab, block.name, TRANSFER_DEST);
    for (var r = 0; r < moving.length; r++) {
      var name = moving[r]; var dest = going[r];
      if (name && !IGNORE_WORDS.includes(name.toUpperCase())) {
        if (!allAssets[name]) { 
          var foundCat = catDictionary[name.toUpperCase()] || 'MISC.';
          allAssets[name] = { cat: foundCat, location: block.name, status: 'IN_TRANSIT', dest: dest, owner: owners[name.toUpperCase()] || 'OWN' }; 
        }
      }
    }
  });

  // ASSET STATE OVERRIDE FIX: the latest form event decides where an asset is.
  // A transfer puts it in transit from its source; a receipt puts it at base where it
  // was received. (Restored: this was in version 61 and was lost when the app was
  // connected to GGM Portal, so dispatched assets never showed as in transit and the
  // receiving site had nothing to receive.)
  for (var assetName in allAssets) {
    var ev = latestEvents[assetName];
    if (ev) {
      if (ev.type === 'TRANSFER') {
        allAssets[assetName].status = 'IN_TRANSIT';
        allAssets[assetName].location = ev.source;
        allAssets[assetName].dest = ev.dest;
      } else if (ev.type === 'RECEIVE') {
        allAssets[assetName].status = 'AT_BASE';
        allAssets[assetName].location = ev.dest;
        allAssets[assetName].dest = '';
      }
    } else if (allAssets[assetName].status === 'IN_TRANSIT') {
      allAssets[assetName].status = 'AT_BASE';
      allAssets[assetName].dest = '';
    }
  }
  return allAssets;
}

function updatePresentAssetsSafe() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var allAssets = getGlobalAssetStatus_();
  var ownTab = readSiteTab_(ss, OWN_TAB);
  var conTab = readSiteTab_(ss, CON_TAB);
  var blockData = {};
  LOCATION_BLOCKS.forEach(function(block) {
    blockData[block.name] = { ci: { 'EXCAVATOR': [], 'TRACTORS': [], 'VAN & TANKERS': [], 'JCB': [], 'DUMPERS': [], 'CRAWLER/ COMP.': [], 'MISC.': [] },
                              co: { 'EXCAVATOR': [], 'TRACTORS': [], 'VAN & TANKERS': [], 'JCB': [], 'DUMPERS': [], 'CRAWLER/ COMP.': [] }, kl: [] };
  });

  for (var name in allAssets) {
    var a = allAssets[name];
    if (!blockData[a.location]) continue;
    if (a.status === 'AT_BASE') {
      if (a.owner === 'CONTRACTOR' && blockData[a.location].co[a.cat]) { blockData[a.location].co[a.cat].push(name); continue; }
      var catList = blockData[a.location].ci[a.cat];
      if (catList) catList.push(name); else blockData[a.location].ci['MISC.'].push(name);
    } else if (a.status === 'IN_TRANSIT') { blockData[a.location].kl.push({ asset: name, dest: a.dest }); }
  }

  LOCATION_BLOCKS.forEach(function(block) {
    var bd = blockData[block.name];

    // ASSETS SORTING LOGIC ADDED HERE TO PREVENT JUMPING ISSUE
    ALL_CATS.forEach(function(cat) {
        if (bd.ci[cat]) bd.ci[cat].sort(function(a, b) { return a.localeCompare(b); });
        if (bd.co[cat]) bd.co[cat].sort(function(a, b) { return a.localeCompare(b); });
    });
    bd.kl.sort(function(a, b) { return a.asset.localeCompare(b.asset); });

    // every site has its own columns, so a list simply runs further down
    ALL_CATS.forEach(function (cat) { setSiteList_(ownTab, block.name, cat, bd.ci[cat]); });
    setSiteList_(ownTab, block.name, IN_TRANSFER, bd.kl.map(function (k) { return k.asset; }));
    setSiteList_(ownTab, block.name, TRANSFER_DEST, bd.kl.map(function (k) { return k.dest; }));
    CON_CATS.forEach(function (cat) { setSiteList_(conTab, block.name, cat, bd.co[cat]); });
  });
  saveSiteTab_(ownTab);
  saveSiteTab_(conTab);
  try { saveOwners_(allAssets); } catch (e) { console.error('Owners list: ' + e); }
}

/** { ASSET NAME (upper case): time of its latest removal (ms) } from the Removed Assets tab. */
function readRemoved_() {
  var map = {};
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(REMOVED_TAB);
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var t = r[0] ? new Date(r[0]).getTime() : 0, n = String(r[1]).trim().toUpperCase();
    if (n && t && (!map[n] || t > map[n])) map[n] = t;
  });
  return map;
}

/** Remove a vehicle from the asset list. Admin / boss only; only while it is at base
 *  (a moving vehicle is received or its transfer cancelled first). The name is cleared
 *  from its site's Own or Contractors column and the removal is logged with a reason. */
function removeAsset(token, assetName, reason) {
  try {
    var sess = assetsSession_(token);
    if (!sess.boss) return { success: false, message: 'Only the admin / boss can remove an asset.' };
    var name = String(assetName || '').trim();
    reason = String(reason || '').trim();
    if (!name) return { success: false, message: 'Which asset?' };
    if (!reason) return { success: false, message: 'Write why it is being removed.' };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return { success: false, message: 'The sheet is busy. Please try again in a moment.' };
    var a;
    try {
      a = getGlobalAssetStatus_()[name];
      if (!a) return { success: false, message: name + ' is not in the asset list.' };
      if (a.status === 'IN_TRANSIT') return { success: false, message: name + ' is on its way to ' + a.dest + '. Receive it or cancel the transfer first, then remove it.' };
      var block = LOCATION_BLOCKS.find(function (b) { return b.name.toUpperCase() === String(a.location).toUpperCase(); });
      if (!block) return { success: false, message: 'Unknown site ' + a.location + '.' };

      var ss = SpreadsheetApp.openById(SHEET_ID);
      var foundOwn = clearSiteName_(readSiteTab_(ss, OWN_TAB), block.name, ALL_CATS, name);
      var foundCon = clearSiteName_(readSiteTab_(ss, CON_TAB), block.name, CON_CATS, name);
      if (!foundOwn && !foundCon) return { success: false, message: name + ' was not found in the ' + block.name + ' columns of the sheet.' };

      var log = ss.getSheetByName(REMOVED_TAB);
      if (!log) {
        log = ss.insertSheet(REMOVED_TAB);
        log.getRange(1, 1, 1, 7).setValues([['Removed At', 'Asset', 'Category', 'Owner', 'Site', 'Removed By', 'Reason']]);
      }
      log.appendRow([new Date(), name, a.cat, a.owner === 'CONTRACTOR' ? 'Contractor' : 'Own', a.location, sess.who, reason]);
      SpreadsheetApp.flush();
    } finally { lock.releaseLock(); }

    runMasterSync();   // after the lock is released: it takes the same lock
    return { success: true, message: name + ' removed from ' + a.location + '. Kept on record in the "' + REMOVED_TAB + '" tab.' };
  } catch (e) { return { success: false, message: e.toString() }; }
}

/** { ASSET NAME (upper case): 'CONTRACTOR' } from the Asset Owners tab. */
function readOwners_() {
  var map = {};
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(OWNERS_TAB);
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var n = String(r[0]).trim();
    if (n && String(r[1]).trim().toUpperCase() === 'CONTRACTOR') map[n.toUpperCase()] = 'CONTRACTOR';
  });
  return map;
}

/** Keep the Asset Owners tab equal to the contractor vehicles the sync knows about
 *  (rewritten only when that list changes). */
function saveOwners_(allAssets) {
  var want = Object.keys(allAssets).filter(function (n) { return allAssets[n].owner === 'CONTRACTOR'; }).sort();
  var have = Object.keys(readOwners_()).sort();
  if (JSON.stringify(want.map(function (n) { return n.toUpperCase(); }).sort()) === JSON.stringify(have)) return;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(OWNERS_TAB) || ss.insertSheet(OWNERS_TAB);
  sh.clearContents();
  var rows = [['Asset', 'Owner', 'Updated']].concat(want.map(function (n) { return [n, 'CONTRACTOR', new Date()]; }));
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
}

function updateHistorySafe() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var histSheet = ss.getSheetByName('History');
  var transferSheet = ss.getSheetByName('Asset Transfer Form');
  var receiveSheet = ss.getSheetByName('Asset Receiving Form');
  if (!histSheet || !transferSheet || !receiveSheet) return;

  // B-I: sent on / asset / from / to | received on / asset / at. J blank.
  // K-S (HIST_DETAIL): who sent, driver, photos, remarks | who received, driver, photos, remarks | cancelled.
  if (histSheet.getMaxColumns && histSheet.getMaxColumns() < HIST_COLS + 1) histSheet.insertColumnsAfter(histSheet.getMaxColumns(), HIST_COLS + 1 - histSheet.getMaxColumns());
  histSheet.getRange(5, 11, 1, HIST_DETAIL.length).setValues([HIST_DETAIL]);
  var maxRows = histSheet.getMaxRows();
  if (maxRows >= 6) { histSheet.getRange(6, 1, maxRows - 5, HIST_COLS + 1).clearContent(); }

  var tData = transferSheet.getDataRange().getValues();
  var transferList = [];
  for (var i = 1; i < tData.length; i++) {
    var row = tData[i]; var ts = row[0]; if (!ts) continue; 
    var src = row[2] ? String(row[2]).trim() : 'Unknown'; var dst = row[12] ? String(row[12]).trim() : 'Unknown'; var name = '';
    for (var c = 4; c <= 11; c++) { if(row[c]) { name = String(row[c]).trim(); break; } }
    if (name && !IGNORE_WORDS.includes(name.toUpperCase())) {
      transferList.push({ dateVal: new Date(ts).getTime(), dateStr: Utilities.formatDate(new Date(ts), ss.getSpreadsheetTimeZone(), 'dd-MMM-yyyy | hh:mm a'), asset: name, source: src, dest: dst,
        by: String(row[1] || ''), driver: String(row[13] || ''), photos: String(row[14] || ''), remarks: String(row[15] || '') });
    }
  }

  var rData = receiveSheet.getDataRange().getValues();
  var receiveList = [];
  for (var j = 1; j < rData.length; j++) {
    var row = rData[j]; var ts = row[0]; if (!ts) continue;
    var dest = row[2] ? String(row[2]).trim() : 'Unknown'; var name = row[3] ? String(row[3]).trim() : '';
    if (name && !IGNORE_WORDS.includes(name.toUpperCase())) {
      receiveList.push({ dateVal: new Date(ts).getTime(), dateStr: Utilities.formatDate(new Date(ts), ss.getSpreadsheetTimeZone(), 'dd-MMM-yyyy | hh:mm a'), asset: name, location: dest,
        by: String(row[1] || ''), driver: String(row[4] || ''), photos: String(row[6] || ''), remarks: String(row[5] || '') });
    }
  }

  // Each transfer is matched with the first receipt of that asset at or after it, before its
  // next transfer; a transfer with none is still on the way (shown as Pending in the app).
  // (Pairing by count - 1st transfer with 1st receipt - slid every later receipt onto the
  // wrong transfer as soon as one receipt had no transfer.)
  var combinedData = [];
  var byAsset = {};
  transferList.forEach(function(r) { var k = r.asset.toUpperCase(); (byAsset[k] = byAsset[k] || []).push({ kind: 'T', time: r.dateVal, row: r }); });
  receiveList.forEach(function(r) { var k = r.asset.toUpperCase(); (byAsset[k] = byAsset[k] || []).push({ kind: 'R', time: r.dateVal, row: r }); });

  var pairedList = [];
  Object.keys(byAsset).forEach(function(k) {
    var open = null;
    byAsset[k].sort(function(a, b) { return a.time - b.time || (a.kind === b.kind ? 0 : a.kind === 'T' ? -1 : 1); })   // same moment: sent, then received
      .forEach(function(e) {
        if (e.kind === 'T') { open = { sortTime: e.time, tRow: e.row, rRow: null }; pairedList.push(open); }
        else if (open) { open.rRow = e.row; open = null; }
        else pairedList.push({ sortTime: e.time, tRow: null, rRow: e.row });
      });
  });
  // cancelled transfers (their row is gone from the transfer tab) stay in the log, marked cancelled
  var cancelSheet = ss.getSheetByName(CANCELLED_TAB);
  if (cancelSheet && cancelSheet.getLastRow() > 1) {
    cancelSheet.getRange(2, 1, cancelSheet.getLastRow() - 1, CANCELLED_HEAD.length).getValues().forEach(function (c) {
      if (!c[0] || !c[2]) return;
      var sentAt = c[7] ? new Date(c[7]) : new Date(c[0]);
      if (isNaN(sentAt.getTime())) sentAt = new Date(c[0]);
      if (isNaN(sentAt.getTime())) return;
      pairedList.push({ sortTime: sentAt.getTime(), rRow: null, tRow: {
        dateStr: Utilities.formatDate(sentAt, ss.getSpreadsheetTimeZone(), 'dd-MMM-yyyy | hh:mm a'), asset: String(c[2]), source: String(c[4]), dest: String(c[5]),
        by: String(c[8] || ''), driver: String(c[6] || ''), photos: String(c[9] || ''), remarks: String(c[10] || '') },
        cancel: Utilities.formatDate(new Date(c[0]), ss.getSpreadsheetTimeZone(), 'dd-MMM-yyyy | hh:mm a') + ' | ' + String(c[1] || '') + ' | ' + String(c[11] || '') });
    });
  }
  pairedList.sort(function(a, b) { return b.sortTime - a.sortTime; });
  pairedList.forEach(function(pair) {
    var tr = pair.tRow || { dateStr: '-', asset: '-', source: '-', dest: '-' };
    var rr = pair.rRow || { dateStr: '-', asset: '-', location: '-' };
    combinedData.push([tr.dateStr, tr.asset, tr.source, tr.dest, '', rr.dateStr, rr.asset, rr.location, '',
      tr.by || '', tr.driver || '', tr.photos || '', tr.remarks || '', rr.by || '', rr.driver || '', rr.photos || '', rr.remarks || '', pair.cancel || '']);
  });
  if (histSheet.insertRowsAfter && histSheet.getMaxRows() < 5 + combinedData.length) histSheet.insertRowsAfter(histSheet.getMaxRows(), 5 + combinedData.length - histSheet.getMaxRows());   // the grid grows with the log
  if (combinedData.length > 0) histSheet.getRange(6, 2, combinedData.length, HIST_COLS).setValues(combinedData);
  try { CacheService.getScriptCache().remove('ASSET_PHOTO_IDS'); } catch (e) {}
}

function verifyUserLogin(username, password) {
  // Connected to GGM Portal: the portal username/phone + password are tried first (site from the portal).
  // While Portal-only is OFF the old site name + password keeps working too.
  var portalMsg = '';
  if (portalEnabled_()) {
    try {
      var b = portalRemoteLogin_(username, password);
      return { success: true, siteName: b.site, token: b.token, userName: b.name };
    } catch (e) {
      if (portalOnly_()) return { success: false, message: e.message || String(e) };
      portalMsg = e.message || String(e);
    }
  }
  var old = siteLogin_(username, password);
  if (!old.success && portalMsg) old.message = 'Wrong site name / username or password.';
  return old;
}

/** The app's own login: site name + password from the Users sheet. */
function siteLogin_(username, password) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID); var sheet = ss.getSheetByName("Users");
    if (!sheet) return { success: false, message: "'Users' sheet missing!" };
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toUpperCase() === String(username).trim().toUpperCase() && String(data[i][1]).trim() === String(password).trim()) {
        var site = String(data[i][0]).trim().toUpperCase();
        var boss = ['BOSS', 'ADMIN', 'MAIN'].indexOf(site) > -1;
        var token = portalNewSession_({ u: site, n: site, r: boss ? 'BOSS' : 'SITE', s: site }, 'legacy');
        return { success: true, siteName: site, token: token, userName: site };
      }
    }
    return { success: false, message: "Invalid Site Name or Password!" };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function doGet(e) {
  var gate = portalGate_(e);          // GGM Portal: launch pass / Portal-only (Portal.js)
  if (gate.block) return gate.block;
  return portalInject_(HtmlService.createHtmlOutputFromFile('Index'), gate).setTitle('GGM Assets').addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getMovementHistory_(maxRows) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID); var histSheet = ss.getSheetByName('History');
    if (!histSheet || histSheet.getLastRow() < 6) return [];
    var rows = Math.min(maxRows || 50, histSheet.getLastRow() - 5);
    var cols = Math.max(8, Math.min(HIST_COLS, histSheet.getLastColumn() - 1));   // older sheets: no detail columns yet
    var data = histSheet.getRange(6, 2, rows, cols).getDisplayValues();
    var logs = []; for (var i = 0; i < data.length; i++) { if (data[i][0] || data[i][5]) { while (data[i].length < HIST_COLS) data[i].push(''); logs.push(data[i]); } }
    return logs;
  } catch (e) { return []; }
}

/** Vehicle details change rarely, but the dashboard asks every minute and reading the
 *  vehicle spreadsheet (7 tabs) was most of each 5-7 s refresh. Kept for 10 minutes;
 *  adding an asset through the app refreshes it at once. */
function getVehicleDetails_(assetNames) {
  var cache = null, key = null;
  try {
    cache = CacheService.getScriptCache();
    var ver = cache.get('veh_ver') || '0';
    var sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, assetNames.slice().sort().join('|')));
    key = 'veh_' + ver + '_' + sig;
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }
  var details = getVehicleDetailsFresh_(assetNames);
  try { var s = JSON.stringify(details); if (cache && s.length < 95000) cache.put(key, s, 600); } catch (e) {}
  return details;
}

function forgetVehicleDetails_() {
  try { CacheService.getScriptCache().put('veh_ver', String(Date.now()) + '.' + Math.random().toString(36).slice(2), 21600); } catch (e) {}
}

function getVehicleDetailsFresh_(assetNames) {
  var details = {};
  try {
    var extSS = SpreadsheetApp.openById(VEHICLE_SHEET_ID);
    var normalize = function(str) { return String(str).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    var matchAsset = function(rawKey) {
      if(!rawKey || rawKey === '—' || rawKey === '-') return null;
      var normKey = normalize(rawKey); if(normKey.length < 4) return null; 
      for(var i = 0; i < assetNames.length; i++) { if(normalize(assetNames[i]).indexOf(normKey) > -1) return assetNames[i]; }
      return null;
    };

    var sheetConfigs = [
      { name: 'DUMPER',         keyCol: 4, dateCol: 1, compCol: 2, modelCol: 3, chasCol: 5, engCol: 6, motorCol: 7, ownCol: 10, keyType: 'Reg No.', serialCol: null, photoCol: 11 },
      { name: 'TRACTOR',        keyCol: 4, dateCol: 1, compCol: 2, modelCol: 3, chasCol: 5, engCol: 6, ownCol: 9,  keyType: 'Reg No.', serialCol: null, photoCol: 10 },
      { name: 'JCB',            keyCol: 5, dateCol: 1, compCol: 2, modelCol: 3, chasCol: 6, engCol: null, ownCol: 7, keyType: 'Reg No.', serialCol: null, photoCol: 8 },
      { name: 'MACHINE',        keyCol: 3, dateCol: 1, compCol: 2, modelCol: 4, chasCol: null, engCol: null, ownCol: 7, keyType: 'Name', serialCol: 5, photoCol: 8 },
      { name: 'CRAWLER/ COMP.', keyCol: 4, dateCol: 1, compCol: 2, modelCol: 3, chasCol: null, engCol: null, ownCol: 6, keyType: 'Serial No.', serialCol: 4, photoCol: 7 },
      { name: 'VAN & TANKERS',  keyCol: 5, dateCol: 1, compCol: 2, modelCol: 3, chasCol: 6, engCol: 7, ownCol: 8, keyType: 'Reg No.', serialCol: null, photoCol: 9 },
      { name: 'MISC.',          keyCol: 2, dateCol: 1, compCol: 3, modelCol: 6, chasCol: null, engCol: null, ownCol: null, keyType: 'Name', serialCol: null, photoCol: 8 }
    ];

    sheetConfigs.forEach(function(cfg) {
      var sh = extSS.getSheetByName(cfg.name);
      if (sh) {
        var data = sh.getDataRange().getDisplayValues(); 
        for (var r = 1; r < data.length; r++) {
          var rawKey = String(data[r][cfg.keyCol] || '').trim();
          var matchedAsset = matchAsset(rawKey);
          if (matchedAsset) {
            var engineStr = cfg.engCol !== null ? String(data[r][cfg.engCol] || '').trim() : '—';
            if (cfg.motorCol !== undefined && data[r][cfg.motorCol]) {
              var m = String(data[r][cfg.motorCol]).trim();
              if (m && m !== '—' && m !== '-') {
                engineStr = (engineStr && engineStr !== '—') ? engineStr + ' / M:' + m : 'M:' + m;
              }
            }
            details[matchedAsset] = {
              regNo: cfg.keyType === 'Reg No.' ? rawKey : '—',
              serialNo: cfg.serialCol !== null ? String(data[r][cfg.serialCol] || '').trim() : (cfg.keyType === 'Serial No.' ? rawKey : '—'),
              date: cfg.dateCol !== null ? String(data[r][cfg.dateCol] || '').trim() : '—',
              company: cfg.compCol !== null ? String(data[r][cfg.compCol] || '').trim() : '—',
              model: cfg.modelCol !== null ? String(data[r][cfg.modelCol] || '').trim() : '—',
              chasis: cfg.chasCol !== null ? String(data[r][cfg.chasCol] || '').trim() : '—',
              engine: engineStr,
              owner: cfg.ownCol !== null ? String(data[r][cfg.ownCol] || '').trim() : '—',
              photoUrls: cfg.photoCol !== null ? String(data[r][cfg.photoCol] || '').trim() : '',
              type: cfg.name
            };
          }
        }
      }
    });
  } catch(e) { console.error("Vehicle Sync Error: " + e); }
  return details;
}

function getDashboardDataUI(token, siteNameIgnored) {
  try {
    var sess = assetsSession_(token);           // the site comes from the session, never from the browser
    var siteName = sess.site;
    var allAssets  = getGlobalAssetStatus_(); 
    var allHistory = getMovementHistory_(300); 
    var vehicleDict = getVehicleDetails_(Object.keys(allAssets)); 
    
    var isBoss = sess.boss;
    var requestedSite = String(siteName).toUpperCase().trim();
    var filteredAssets = {}; var filteredHistory = [];

    for (var name in allAssets) {
      var a = allAssets[name];
      if (isBoss) {
        filteredAssets[name] = a;
      } else if (a.location.toUpperCase() === requestedSite) {
        filteredAssets[name] = a;
      } else if (a.status === 'IN_TRANSIT' && a.dest.toUpperCase() === requestedSite) {
        filteredAssets[name] = a; 
      }
    }
    
    for (var i = 0; i < allHistory.length; i++) {
      var row = allHistory[i]; 
      var src = row[2] ? String(row[2]).trim().toUpperCase() : ''; 
      var dstTransfer = row[3] ? String(row[3]).trim().toUpperCase() : ''; 
      var dstReceive = row[7] ? String(row[7]).trim().toUpperCase() : '';  
      if (isBoss || src === requestedSite || dstTransfer === requestedSite || dstReceive === requestedSite) {
        filteredHistory.push(row);
      }
    }
    filteredHistory = filteredHistory.slice(0, 50);
    
    return JSON.stringify({ ok: true, assets: filteredAssets, history: filteredHistory, vehicles: vehicleDict });
  } catch (err) { return JSON.stringify({ ok: false, error: String(err) }); }
}

/* ---------------- photos on the movement log (14 Nov 2026) ---------------- */

/** Drive file ids in a photo cell ("https://drive.google.com/file/d/ID/view", "...open?id=ID", several per cell). */
function photoIds_(text) {
  var out = [];
  String(text || '').replace(/(?:[?&]id=|\/d\/)([-\w]{20,})/g, function (m, id) { if (out.indexOf(id) === -1) out.push(id); });
  return out;
}

/** Only photos attached to a movement can be fetched through the app. */
function allowedPhotoIds_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('ASSET_PHOTO_IDS');
  if (hit) return JSON.parse(hit);
  var ok = {}, sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('History');
  if (sh && sh.getLastRow() >= 6 && sh.getLastColumn() >= 17) {
    sh.getRange(6, 13, sh.getLastRow() - 5, 5).getValues().forEach(function (r) {   // M = photos sent, Q = photos received
      photoIds_(r[0]).concat(photoIds_(r[4])).forEach(function (id) { ok[id] = 1; });
    });
  }
  try { cache.put('ASSET_PHOTO_IDS', JSON.stringify(ok), 600); } catch (e) {}
  return ok;
}

/**
 * Photos for the movement log, as data URLs (the files sit in the owner's Drive, so nobody needs
 * Drive access to see them). full=false: small thumbnails for up to 30 ids; full=true: one photo.
 */
function getAssetPhotos(token, ids, full) {
  assetsSession_(token);
  var allowed = allowedPhotoIds_(), cache = CacheService.getScriptCache(), out = {};
  (ids || []).slice(0, full ? 1 : 30).forEach(function (id) {
    id = String(id);
    if (!allowed[id]) { out[id] = ''; return; }
    var key = 'APT_' + id, hit = full ? null : cache.get(key);
    if (hit) { out[id] = hit; return; }
    try {
      var f = DriveApp.getFileById(id), blob = null;
      if (full) { if (f.getSize() <= 12 * 1024 * 1024) blob = f.getBlob(); }
      else { blob = f.getThumbnail(); if (!blob && f.getSize() <= 300000) blob = f.getBlob(); }
      if (!blob) { out[id] = ''; return; }
      var url = 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
      if (!full && url.length < 95000) cache.put(key, url, 21600);
      out[id] = url;
    } catch (e) { out[id] = ''; }
  });
  return out;
}

function saveMultipleImagesToDrive_(fileObjs) {
  if (!fileObjs || fileObjs.length === 0) return '';
  try {
    var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    var urls = [];
    for (var i = 0; i < fileObjs.length && i < 5; i++) { 
      var f = fileObjs[i];
      if (f && f.data) {
        var blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.mimeType || 'image/jpeg', f.name);
        var file = folder.createFile(blob);
        try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
        urls.push(file.getUrl());
      }
    }
    return urls.join(" \n "); 
  } catch(e) { return 'Drive Error: ' + e.message; }
}

function processAddNewAsset(token, d) {
  try {
    var sess = assetsSession_(token);
    if (!sess.boss && String(d.loc || '').toUpperCase().trim() !== sess.site) return { success: false, message: 'You can only add assets at ' + sess.site + '.' };
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var block = LOCATION_BLOCKS.find(function(b) { return b.name.toUpperCase() === d.loc.toUpperCase(); });
    if (!block) return {success: false, message: 'System Error: Invalid Location Block'};
    
    var allAssets = getGlobalAssetStatus_(); 
    var upperName = d.name.toUpperCase().trim();
    if (IGNORE_WORDS.includes(upperName)) return {success: false, message: 'Asset Name invalid!'};
    for(var k in allAssets) { if (k.toUpperCase().trim() === upperName) return {success: false, message: 'Asset Name already exists!'}; }

    var catDb = (d.cat === 'MISCELLANEUOS') ? 'MISC.' : d.cat; 
    var contractor = String(d.ownership || '').toUpperCase() === 'CONTRACTOR';
    var catIndex = contractor ? CON_CATS.indexOf(catDb) : ALL_CATS.indexOf(catDb);
    if (contractor && catIndex === -1) return {success: false, message: 'A contractor vehicle can be an Excavator, Tractor, Van & Tanker, JCB, Dumper or Crawler / Comp. (the Contractors section has no Misc. column).'};
    if (catIndex > -1) {
      // first free cell of that site's column (the column has no row limit)
      putSiteName_(readSiteTab_(ss, contractor ? CON_TAB : OWN_TAB), block.name, catDb, d.name);
    } else { return {success: false, message: 'Invalid Category Parameters'}; }

    var photoUrls = saveMultipleImagesToDrive_(d.files);

    var targetSheetName = d.cat; 
    if (d.cat === 'EXCAVATOR') targetSheetName = 'MACHINE';
    if (d.cat === 'TRACTORS') targetSheetName = 'TRACTOR';
    if (d.cat === 'DUMPERS') targetSheetName = 'DUMPER';

    var extSS = SpreadsheetApp.openById(VEHICLE_SHEET_ID);
    var sh = extSS.getSheetByName(targetSheetName);
    
    if(sh) {
      var lastRow = sh.getLastRow();
      var lrData = sh.getRange(Math.max(1, lastRow), 1).getValue();
      var sn = parseInt(lrData) ? parseInt(lrData) + 1 : (lastRow > 0 ? lastRow : 1);
      var newRow = [];

      var finalEngine = d.engine;
      if(d.motor) { finalEngine = finalEngine ? finalEngine + " / M:" + d.motor : "Motor: " + d.motor; }

      if (targetSheetName === 'DUMPER') { 
        newRow = new Array(12).fill('');
        newRow[0] = sn; newRow[1] = d.date; newRow[2] = d.company; newRow[3] = d.model; newRow[4] = d.regNo; newRow[5] = d.chasis; newRow[6] = d.engine; newRow[7] = d.motor; newRow[8] = d.loc; newRow[9] = d.cat; newRow[10] = d.owner; newRow[11] = photoUrls;
      } else if (targetSheetName === 'TRACTOR') { 
        newRow = new Array(11).fill('');
        newRow[0] = sn; newRow[1] = d.date; newRow[2] = d.company; newRow[3] = d.model; newRow[4] = d.regNo; newRow[5] = d.chasis; newRow[6] = finalEngine; newRow[8] = d.loc; newRow[9] = d.owner; newRow[10] = photoUrls;
      } else if (targetSheetName === 'JCB') { 
        newRow = new Array(9).fill('');
        newRow[0] = sn; newRow[1] = d.date; newRow[2] = d.company; newRow[3] = d.model; newRow[4] = d.loc; newRow[5] = d.regNo; newRow[6] = d.chasis; newRow[7] = d.owner; newRow[8] = photoUrls;
      } else if (targetSheetName === 'MACHINE') { 
        newRow = new Array(9).fill('');
        newRow[0] = sn; newRow[1] = d.date; newRow[2] = d.company; newRow[3] = d.name; newRow[4] = d.model; newRow[5] = d.regNo; newRow[6] = d.loc; newRow[7] = d.owner; newRow[8] = photoUrls;
      } else if (targetSheetName === 'CRAWLER/ COMP.') { 
        newRow = new Array(8).fill('');
        newRow[0] = sn; newRow[1] = d.date; newRow[2] = d.company; newRow[3] = d.model; newRow[4] = d.regNo; newRow[5] = d.loc; newRow[6] = d.owner; newRow[7] = photoUrls;
      } else if (targetSheetName === 'VAN & TANKERS') { 
        newRow = new Array(10).fill('');
        newRow[0] = sn; newRow[1] = d.date; newRow[2] = d.company; newRow[3] = d.model; newRow[4] = d.loc; newRow[5] = d.regNo; newRow[6] = d.chasis; newRow[7] = finalEngine; newRow[8] = d.owner; newRow[9] = photoUrls;
      } else if (targetSheetName === 'MISC.') { 
        newRow = new Array(9).fill('');
        newRow[0] = sn; newRow[1] = d.date; newRow[2] = d.name; newRow[3] = d.company; newRow[5] = d.loc; newRow[6] = d.model; newRow[8] = photoUrls; 
      }
      sh.appendRow(newRow);
      forgetVehicleDetails_();
    }

    SpreadsheetApp.flush(); runMasterSync(); 
    return {success: true, message: d.name + ' added under ' + (contractor ? 'Contractors' : 'Own vehicles') + ' at ' + block.name + '.'};

  } catch(e) { return {success: false, message: e.toString()}; }
}

function processWebTransfer(token, assetName, category, sourceLoc, destLoc, driverName, fileObjs, remarks, loggedInUser) {
  try {
    var sess = assetsSession_(token);
    if (!sess.boss && String(sourceLoc || '').toUpperCase().trim() !== sess.site) return { success: false, message: 'You can only dispatch from ' + sess.site + '.' };
    // the asset must really be standing at that site (not already on its way somewhere)
    var here = getGlobalAssetStatus_()[String(assetName || '').trim()];
    if (!here) return { success: false, message: 'Asset "' + assetName + '" is not in the asset list.' };
    if (here.status === 'IN_TRANSIT') return { success: false, message: assetName + ' is already on its way to ' + here.dest + '. It must be received (or the transfer cancelled) first.' };
    if (here.location.toUpperCase() !== String(sourceLoc || '').toUpperCase().trim()) return { success: false, message: assetName + ' is at ' + here.location + ', not ' + sourceLoc + '.' };
    if (String(destLoc || '').toUpperCase().trim() === here.location.toUpperCase()) return { success: false, message: 'Pick a different site to send it to.' };
    if (!String(driverName || '').trim()) return { success: false, message: 'Enter the driver name / vehicle no.' };
    var photoUrl = saveMultipleImagesToDrive_(fileObjs);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName('Asset Transfer Form');
    var row = new Array(16).fill('');
    
    var emailIdentifier = sess.who;               // the signed-in person (GGM Portal username)

    row[0] = new Date(); 
    row[1] = emailIdentifier;
    row[2] = sourceLoc; 
    row[3] = category; 
    
    var colIdx = TRANSFER_CAT_COLS[normCat_(category)] || 11;
    row[colIdx] = assetName; 
    row[12] = destLoc; 
    row[13] = String(driverName).trim();  
    row[14] = photoUrl; 
    row[15] = remarks || ''; 
    
    sh.appendRow(row); SpreadsheetApp.flush(); runMasterSync();
    return {success: true, message: 'Asset successfully dispatched!'};
  } catch(e) { return {success: false, message: e.toString()}; }
}

function processWebReceive(token, assetName, destLoc, category, driverName, fileObjs, remarks, loggedInUser) {
  try {
    var sess = assetsSession_(token);
    if (!sess.boss && String(destLoc || '').toUpperCase().trim() !== sess.site) return { success: false, message: 'You can only receive at ' + sess.site + '.' };
    // only what was actually sent here can be received here
    var moving = getGlobalAssetStatus_()[String(assetName || '').trim()];
    if (!moving || moving.status !== 'IN_TRANSIT') return { success: false, message: assetName + ' is not on its way anywhere, so there is nothing to receive.' };
    if (moving.dest.toUpperCase() !== String(destLoc || '').toUpperCase().trim()) return { success: false, message: assetName + ' was sent to ' + moving.dest + ', not ' + destLoc + '.' };
    var photoUrl = saveMultipleImagesToDrive_(fileObjs);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName('Asset Receiving Form');
    var row = new Array(8).fill('');
    
    var emailIdentifier = sess.who;               // the signed-in person (GGM Portal username)

    row[0] = new Date(); 
    row[1] = emailIdentifier; 
    row[2] = destLoc; 
    row[3] = assetName; 
    row[4] = driverName || ''; 
    row[5] = remarks || ''; 
    row[6] = photoUrl; 
    row[7] = category; 
    
    sh.appendRow(row); SpreadsheetApp.flush(); runMasterSync();
    return {success: true, message: 'Asset successfully received!'};
  } catch(e) { return {success: false, message: e.toString()}; }
}

function cancelAssetTransfer(token, assetName, reason) {
  try {
    var sess = assetsSession_(token);
    reason = String(reason || '').trim();
    if (reason.length < 3) return { success: false, message: 'Write why this transfer is being cancelled.' };
    var moving = getGlobalAssetStatus_()[String(assetName || '').trim()];
    if (!moving || moving.status !== 'IN_TRANSIT') return { success: false, message: assetName + ' is not on its way anywhere, so there is no transfer to cancel.' };
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var transferSheet = ss.getSheetByName('Asset Transfer Form');
    if (!transferSheet) return { success: false, message: 'System sheets missing!' };
    
    var tData = transferSheet.getDataRange().getValues();
    var rowIndexToDelete = -1; var sourceLoc = ''; var assetCat = ''; var cancelledRow = null;
    
    for (var i = tData.length - 1; i >= 1; i--) {
      var row = tData[i];
      for (var c = 4; c <= 11; c++) {
        if (row[c] && String(row[c]).trim() === assetName) {
          rowIndexToDelete = i + 1;
          sourceLoc = row[2] ? String(row[2]).trim().toUpperCase() : ''; 
          assetCat = row[3] ? String(row[3]).trim().toUpperCase() : '';
          cancelledRow = row;
          break;
        }
      }
      if (rowIndexToDelete > -1) break;
    }
    
    if (rowIndexToDelete > -1 && !sess.boss && sourceLoc !== sess.site) {
      return { success: false, message: 'Only ' + sourceLoc + ' (or the boss) can cancel this transfer.' };
    }
    if (rowIndexToDelete > -1) {
      var block = LOCATION_BLOCKS.find(function(b) { return b.name.toUpperCase() === sourceLoc; });
      if (block) {
        var catDb = normCat_(assetCat);
        // a contractor vehicle goes back to the Contractors section
        var isCon = readOwners_()[String(assetName).toUpperCase()] === 'CONTRACTOR' && CON_CATS.indexOf(catDb) > -1;
        var catIndex = isCon ? CON_CATS.indexOf(catDb) : ALL_CATS.indexOf(catDb);
        if (catIndex > -1) putSiteName_(readSiteTab_(ss, isCon ? CON_TAB : OWN_TAB), block.name, catDb, assetName);
      }

      // out of every site's "Asset In Transfer" box
      var ownTab = readSiteTab_(ss, OWN_TAB);
      LOCATION_BLOCKS.forEach(function (b) {
        var cA = siteCol_(ownTab, b.name, IN_TRANSFER), cD = siteCol_(ownTab, b.name, TRANSFER_DEST);
        ownTab.rows.forEach(function (row, i) {
          if (String(row[cA]).trim() === assetName) {
            ownTab.sheet.getRange(DATA_ROW + i, cA + 1).setValue('');
            ownTab.sheet.getRange(DATA_ROW + i, cD + 1).setValue('');
          }
        });
      });
      SpreadsheetApp.flush();
      
      var cs = ss.getSheetByName(CANCELLED_TAB);
      if (!cs) { cs = ss.insertSheet(CANCELLED_TAB); cs.appendRow(CANCELLED_HEAD); cs.setFrozenRows(1); cs.getRange(1, 1, 1, CANCELLED_HEAD.length).setFontWeight('bold'); }
      var cr = cancelledRow;
      cs.appendRow([new Date(), sess.who, assetName, cr[3] || '', cr[2] || '', cr[12] || '', cr[13] || '', cr[0] || '', cr[1] || '', cr[14] || '', cr[15] || '', reason]);
      transferSheet.deleteRow(rowIndexToDelete);
      SpreadsheetApp.flush();
      runMasterSync(); 
      
      return { success: true, message: 'Transfer cancelled! Restored to ' + sourceLoc + '.' };
    } else { return { success: false, message: 'Active transfer response not found.' }; }
  } catch(e) { return { success: false, message: e.toString() }; }
}