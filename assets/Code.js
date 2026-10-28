// ============================================================
//  GGM ASSETS - 100% LIVE SYNC + SMART RESTORE + CLOUD UPLOAD
// ============================================================

var SHEET_ID = '1ZkXxIEP4mqUu4zF1WwVAMYHLzBG8gaGCLPxIB_kkXC8';
var VEHICLE_SHEET_ID = '194PebQBGqTmdrLgrPnpmne_kLCCyQdlKP1a1IzdG2Pw'; 
var DRIVE_FOLDER_ID = '1aG-yoGaFJDhK4AhBTfdTM_x6wWTYSFC3';

// ROW NUMBERS FIXED ACCORDING TO SCREENSHOTS
var LOCATION_BLOCKS = [
  { name: 'TONK',            dataStart: 4,   dataEnd: 21 }, 
  { name: 'SANWARIYA',       dataStart: 25,  dataEnd: 39 }, 
  { name: 'KHAKHUNDA',       dataStart: 43,  dataEnd: 58 }, 
  { name: 'NEWAI',           dataStart: 63,  dataEnd: 78 },
  { name: 'AMARGARH',        dataStart: 83,  dataEnd: 98 },  
  { name: 'KACHOLA FACTORY', dataStart: 103, dataEnd: 118 }  
];

var ALL_CATS = ['EXCAVATOR', 'TRACTORS', 'VAN & TANKERS', 'JCB', 'DUMPERS', 'CRAWLER/ COMP.', 'MISC.'];

// Contractor vehicles sit in the "Contractors" section of Present Assets List: columns O-T,
// same rows as each site's block, six categories (no MISC). Own vehicles stay in C-I.
var CON_CATS = ['EXCAVATOR', 'TRACTORS', 'VAN & TANKERS', 'JCB', 'DUMPERS', 'CRAWLER/ COMP.'];
var CON_COL = 15;   // column O
// Which vehicles are contractor-owned, so one that is in transit (in the shared
// "Asset In Transfer" box) still lands back in the Contractors section.
var OWNERS_TAB = 'Asset Owners';
// Every removal is recorded here (who, when, why). Transfers / receipts older than an
// asset's removal are ignored, so a vehicle added again later is not moved by its past.
var REMOVED_TAB = 'Removed Assets';

var TRANSFER_CAT_COLS = { 'EXCAVATOR': 4, 'VAN & TANKER': 5, 'VAN & TANKERS': 5, 'TRACTORS': 6, 'JCB': 7, 'DUMPERS': 8, 'CRAWLER/ COMP.': 9, 'MISCELLANEUOS': 10, 'MISC.': 10 };

var IGNORE_WORDS = ['TONK', 'SANWARIYA', 'KHAKHUNDA', 'NEWAI', 'AMARGARH', 'KACHOLA FACTORY', 'EXCAVATOR', 'TRACTORS', 'VAN & TANKER', 'VAN & TANKERS', 'JCB', 'DUMPERS', 'CRAWLER/ COMP.', 'CRAWLER', 'MISC.', 'MISCELLANEUOS', 'NAN', 'NA', 'N/A'];

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ LIVE SYNC SYSTEM')
    .addItem('🟢 Activate Live Updates & Triggers', 'activateLiveSystem')
    .addItem('🔒 Apply Strict Sheet Lock', 'secureSystemSheets')
    .addItem('🔄 Run Manual Sync Now', 'runMasterSync')
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
    } catch(e) { 
      console.error("Sync Error: " + e); 
    } finally {
      lock.releaseLock();
    }
  }
}

function forceBackendSync(token) {
  assetsSession_(token);
  runMasterSync();
  return true;
}

function getGlobalAssetStatus_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var presentSheet  = ss.getSheetByName('Present Assets List');
  var transferSheet = ss.getSheetByName('Asset Transfer Form');
  var receiveSheet  = ss.getSheetByName('Asset Receiving Form');

  var allAssets = {}; var catDictionary = {}; 

  LOCATION_BLOCKS.forEach(function(block) {
    var numRows = block.dataEnd - block.dataStart + 1;
    var ciData = presentSheet.getRange(block.dataStart, 3, numRows, 7).getValues();
    for (var r = 0; r < ciData.length; r++) {
      for (var c = 0; c < ALL_CATS.length; c++) {
        var name = String(ciData[r][c]).trim();
        if (name && !IGNORE_WORDS.includes(name.toUpperCase())) {
          allAssets[name] = { cat: ALL_CATS[c], location: block.name, status: 'AT_BASE', dest: '', owner: 'OWN' };
          catDictionary[name.toUpperCase()] = ALL_CATS[c];
        }
      }
    }
    // the Contractors section of the same block
    var coData = presentSheet.getRange(block.dataStart, CON_COL, numRows, CON_CATS.length).getValues();
    for (var r2 = 0; r2 < coData.length; r2++) {
      for (var c2 = 0; c2 < CON_CATS.length; c2++) {
        var cname = String(coData[r2][c2]).trim();
        if (cname && !IGNORE_WORDS.includes(cname.toUpperCase()) && !allAssets[cname]) {
          allAssets[cname] = { cat: CON_CATS[c2], location: block.name, status: 'AT_BASE', dest: '', owner: 'CONTRACTOR' };
          catDictionary[cname.toUpperCase()] = CON_CATS[c2];
        }
      }
    }
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
      
      var dbCat = (type === 'MISCELLANEUOS') ? 'MISC.' : type; if (!dbCat) dbCat = 'MISC.';
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
      var dbCat = 'MISC.'; if (cat) { dbCat = (cat === 'MISCELLANEUOS') ? 'MISC.' : (cat.includes('CRAWLER') ? 'CRAWLER/ COMP.' : cat); }
      catDictionary[name.toUpperCase()] = dbCat;
      if (!ts) continue;
      if (removedAt[name.toUpperCase()] && ts <= removedAt[name.toUpperCase()]) continue;   // from before it was removed
      // >= : a receipt stamped the same moment as its transfer still counts as received
      if (!latestEvents[name] || ts >= latestEvents[name].time) { latestEvents[name] = { type: 'RECEIVE', dest: dest, time: ts, cat: dbCat }; }
    }
  }

  LOCATION_BLOCKS.forEach(function(block) {
    var numRows = block.dataEnd - block.dataStart + 1;
    var klData = presentSheet.getRange(block.dataStart, 11, numRows, 2).getValues();
    for (var r = 0; r < klData.length; r++) {
      var name = String(klData[r][0]).trim(); var dest = String(klData[r][1]).trim();
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
  var presentSheet = ss.getSheetByName('Present Assets List');
  if (!presentSheet) return;

  var allAssets = getGlobalAssetStatus_();
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
    var numRows = block.dataEnd - block.dataStart + 1;
    var bd = blockData[block.name];
    
    // ASSETS SORTING LOGIC ADDED HERE TO PREVENT JUMPING ISSUE
    ALL_CATS.forEach(function(cat) {
        if (bd.ci[cat]) bd.ci[cat].sort(function(a, b) { return a.localeCompare(b); });
        if (bd.co[cat]) bd.co[cat].sort(function(a, b) { return a.localeCompare(b); });
    });
    bd.kl.sort(function(a, b) { return a.asset.localeCompare(b.asset); });

    // A block with more vehicles in a column than it has rows is NOT rewritten: writing
    // it would silently drop the extra names from the sheet. Add rows to that block.
    var lists = [bd.kl].concat(ALL_CATS.map(function (c) { return bd.ci[c]; }), CON_CATS.map(function (c) { return bd.co[c]; }));
    if (lists.some(function (l) { return l.length > numRows; })) {
      console.error('Sync skipped ' + block.name + ': a column has more vehicles than the ' + numRows + ' rows of its block.');
      return;
    }

    var ciValues = []; var coValues = []; var klValues = [];
    for (var i = 0; i < numRows; i++) {
      ciValues.push([ bd.ci['EXCAVATOR'][i]||'', bd.ci['TRACTORS'][i]||'', bd.ci['VAN & TANKERS'][i]||'', bd.ci['JCB'][i]||'', bd.ci['DUMPERS'][i]||'', bd.ci['CRAWLER/ COMP.'][i]||'', bd.ci['MISC.'][i]||'' ]);
      coValues.push(CON_CATS.map(function (c) { return bd.co[c][i] || ''; }));
      klValues.push([ bd.kl[i] ? bd.kl[i].asset : '', bd.kl[i] ? bd.kl[i].dest  : '' ]);
    }
    presentSheet.getRange(block.dataStart, 3, numRows, 7).setValues(ciValues);
    presentSheet.getRange(block.dataStart, CON_COL, numRows, CON_CATS.length).setValues(coValues);
    presentSheet.getRange(block.dataStart, 11, numRows, 2).setValues(klValues);
  });
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
      var present = ss.getSheetByName('Present Assets List');
      var numRows = block.dataEnd - block.dataStart + 1;
      var found = false;
      [[3, ALL_CATS.length], [CON_COL, CON_CATS.length]].forEach(function (part) {
        var rng = present.getRange(block.dataStart, part[0], numRows, part[1]);
        var vals = rng.getValues(), changed = false;
        for (var r = 0; r < vals.length; r++) for (var c = 0; c < vals[r].length; c++) {
          if (String(vals[r][c]).trim() === name) { vals[r][c] = ''; changed = true; }
        }
        if (changed) { rng.setValues(vals); found = true; }
      });
      if (!found) return { success: false, message: name + ' was not found in the ' + block.name + ' block of the sheet.' };

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

  var maxRows = histSheet.getMaxRows();
  if (maxRows >= 6) { histSheet.getRange(6, 1, maxRows - 5, 8).clearContent(); }

  var tData = transferSheet.getDataRange().getValues();
  var transferList = [];
  for (var i = 1; i < tData.length; i++) {
    var row = tData[i]; var ts = row[0]; if (!ts) continue; 
    var src = row[2] ? String(row[2]).trim() : 'Unknown'; var dst = row[12] ? String(row[12]).trim() : 'Unknown'; var name = '';
    for (var c = 4; c <= 11; c++) { if(row[c]) { name = String(row[c]).trim(); break; } }
    if (name && !IGNORE_WORDS.includes(name.toUpperCase())) {
      transferList.push({ dateVal: new Date(ts).getTime(), dateStr: Utilities.formatDate(new Date(ts), ss.getSpreadsheetTimeZone(), 'dd-MMM-yyyy | hh:mm a'), asset: name, source: src, dest: dst });
    }
  }

  var rData = receiveSheet.getDataRange().getValues();
  var receiveList = [];
  for (var j = 1; j < rData.length; j++) {
    var row = rData[j]; var ts = row[0]; if (!ts) continue;
    var dest = row[2] ? String(row[2]).trim() : 'Unknown'; var name = row[3] ? String(row[3]).trim() : '';
    if (name && !IGNORE_WORDS.includes(name.toUpperCase())) {
      receiveList.push({ dateVal: new Date(ts).getTime(), dateStr: Utilities.formatDate(new Date(ts), ss.getSpreadsheetTimeZone(), 'dd-MMM-yyyy | hh:mm a'), asset: name, location: dest });
    }
  }

  var combinedData = [];
  var allKeys = {}; var tByAsset = {}; var rByAsset = {};
  transferList.forEach(function(r) { var k = r.asset.toUpperCase(); if(!tByAsset[k]) tByAsset[k]=[]; tByAsset[k].push(r); allKeys[k]=true; });
  receiveList.forEach(function(r) { var k = r.asset.toUpperCase(); if(!rByAsset[k]) rByAsset[k]=[]; rByAsset[k].push(r); allKeys[k]=true; });
  
  for(var k in tByAsset) tByAsset[k].sort(function(a,b){return a.dateVal-b.dateVal;});
  for(var k in rByAsset) rByAsset[k].sort(function(a,b){return a.dateVal-b.dateVal;});
  
  var pairedList = [];
  for (var key in allKeys) {
    var tList = tByAsset[key] || []; var rList = rByAsset[key] || [];
    var max = Math.max(tList.length, rList.length);
    for (var m = 0; m < max; m++) {
      var tr = tList[m] || null; var rr = rList[m] || null;
      pairedList.push({ sortTime: tr ? tr.dateVal : (rr ? rr.dateVal : 0), tRow: tr, rRow: rr });
    }
  }
  pairedList.sort(function(a, b) { return b.sortTime - a.sortTime; });
  pairedList.forEach(function(pair) {
    var tr = pair.tRow || { dateStr: '-', asset: '-', source: '-', dest: '-' };
    var rr = pair.rRow || { dateStr: '-', asset: '-', location: '-' };
    combinedData.push([tr.dateStr, tr.asset, tr.source, tr.dest, '', rr.dateStr, rr.asset, rr.location]);
  });
  if (combinedData.length > 0) histSheet.getRange(6, 2, combinedData.length, 8).setValues(combinedData);
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
    var data = histSheet.getRange(6, 2, rows, 8).getDisplayValues();
    var logs = []; for (var i = 0; i < data.length; i++) { if (data[i][0] || data[i][5]) logs.push(data[i]); }
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
    var presentSheet = ss.getSheetByName('Present Assets List');
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
    var successInMain = false;

    if (catIndex > -1) {
      var targetCol = contractor ? CON_COL + catIndex : 3 + catIndex; 
      var blockRange = presentSheet.getRange(block.dataStart, targetCol, block.dataEnd - block.dataStart + 1, 1);
      var blockValues = blockRange.getValues(); 
      for (var r = 0; r < blockValues.length; r++) {
        var val = String(blockValues[r][0]).trim(); var upVal = val.toUpperCase();
        if (val === '' || upVal === 'NAN' || upVal === 'NA' || IGNORE_WORDS.includes(upVal)) { 
          blockValues[r][0] = d.name; successInMain = true; break; 
        }
      }
      if (successInMain) { blockRange.setValues(blockValues); } 
      else { return {success: false, message: 'No empty slot available in Master Hub Sheet.'}; }
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
    var photoUrl = saveMultipleImagesToDrive_(fileObjs);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName('Asset Transfer Form');
    var row = new Array(16).fill('');
    
    var emailIdentifier = sess.who;               // the signed-in person (GGM Portal username)

    row[0] = new Date(); 
    row[1] = emailIdentifier;
    row[2] = sourceLoc; 
    row[3] = category; 
    
    var colIdx = TRANSFER_CAT_COLS[category.toUpperCase()] || 11;
    row[colIdx] = assetName; 
    row[12] = destLoc; 
    row[13] = driverName || ''; 
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

function cancelAssetTransfer(token, assetName) {
  try {
    var sess = assetsSession_(token);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var transferSheet = ss.getSheetByName('Asset Transfer Form');
    var presentSheet = ss.getSheetByName('Present Assets List');
    if (!transferSheet || !presentSheet) return { success: false, message: 'System sheets missing!' };
    
    var tData = transferSheet.getDataRange().getValues();
    var rowIndexToDelete = -1; var sourceLoc = ''; var assetCat = '';
    
    for (var i = tData.length - 1; i >= 1; i--) {
      var row = tData[i];
      for (var c = 4; c <= 11; c++) {
        if (row[c] && String(row[c]).trim() === assetName) {
          rowIndexToDelete = i + 1;
          sourceLoc = row[2] ? String(row[2]).trim().toUpperCase() : ''; 
          assetCat = row[3] ? String(row[3]).trim().toUpperCase() : '';
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
        var catDb = (assetCat === 'MISCELLANEUOS') ? 'MISC.' : assetCat;
        // a contractor vehicle goes back to the Contractors section
        var isCon = readOwners_()[String(assetName).toUpperCase()] === 'CONTRACTOR' && CON_CATS.indexOf(catDb) > -1;
        var catIndex = isCon ? CON_CATS.indexOf(catDb) : ALL_CATS.indexOf(catDb);
        if (catIndex > -1) {
          var targetCol = isCon ? CON_COL + catIndex : 3 + catIndex; 
          var blockRange = presentSheet.getRange(block.dataStart, targetCol, block.dataEnd - block.dataStart + 1, 1);
          var blockValues = blockRange.getValues();
          for (var r = 0; r < blockValues.length; r++) {
            var v = String(blockValues[r][0]).trim(); var upV = v.toUpperCase();
            if (v === '' || upV === 'NAN' || upV === 'NA' || IGNORE_WORDS.includes(upV)) {
              blockValues[r][0] = assetName; break; 
            }
          }
          blockRange.setValues(blockValues);
        }
      }

      var klRange = presentSheet.getRange(1, 11, presentSheet.getLastRow() || 120, 2);
      var klData = klRange.getValues();
      for (var r = 0; r < klData.length; r++) {
        if (String(klData[r][0]).trim() === assetName) { klData[r][0] = ''; klData[r][1] = ''; }
      }
      klRange.setValues(klData);
      SpreadsheetApp.flush();
      
      transferSheet.deleteRow(rowIndexToDelete);
      SpreadsheetApp.flush();
      runMasterSync(); 
      
      return { success: true, message: 'Transfer cancelled! Restored to ' + sourceLoc + '.' };
    } else { return { success: false, message: 'Active transfer response not found.' }; }
  } catch(e) { return { success: false, message: e.toString() }; }
}