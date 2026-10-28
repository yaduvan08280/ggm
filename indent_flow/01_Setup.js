/**********************************************************************
 * File: 01_Setup.gs  —  One-time installer
 *  Run  setupSystem()  once from the Apps Script editor.
 *  It is idempotent: running it again will not duplicate anything.
 *********************************************************************/

function setupSystem() {
  portalAssertEditor_();
  var ss = SS_();
  ss.setSpreadsheetTimeZone(APP.TIMEZONE);

  // 0. Rename any v6 headers before the tabs are rebuilt --------------
  var renamed = renameLegacyHeaders_(ss);

  // 1. Create every tab with its header row --------------------------
  var allTabs = {};
  Object.keys(SCHEMA).forEach(function (k) { allTabs[k] = SCHEMA[k]; });
  var invTabs = inventorySchemas_();
  Object.keys(invTabs).forEach(function (k) { allTabs[k] = invTabs[k]; });

  assertHeadersLineUp_(ss, allTabs);

  Object.keys(allTabs).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var head = allTabs[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, head.length)
      .setFontWeight('bold')
      .setBackground('#1E293B')
      .setFontColor('#FFFFFF');
    if (sh.getMaxColumns() > head.length) {
      sh.deleteColumns(head.length + 1, sh.getMaxColumns() - head.length);
    }
  });

  // 2. Default settings ---------------------------------------------
  DEFAULT_SETTINGS.forEach(function (r) {
    if (getSetting_(r[0]) === null) insert_(SH.SETTINGS, { Key: r[0], Value: r[1], Description: r[2] });
  });

  // 3. The four sites, and a starter section list for each ------------
  var haveSites = readAll_(SH.SITES).map(function (r) { return String(r.Site_Name).toUpperCase().trim(); });
  insertMany_(SH.SITES, SITES.filter(function (s) { return haveSites.indexOf(s) === -1; })
                             .map(function (s) { return { Site_Name: s, Active: 'TRUE' }; }));

  /* Starter sections. These are only a starting point — add, rename or
     switch off whatever you like in the Sections tab, or from Admin ▸
     Sections. An indent with no section belongs to the site itself. */
  var seedSections = [
    ['TONK',       'WASHING PLANT'], ['TONK',       'COLOR SHOTER'], ['TONK',       'CRUSHER'],
    ['NEWAI',      'WASHING PLANT'], ['NEWAI',      'COLOR SHOTER'], ['NEWAI',      'CRUSHER'],
    ['SANWARIYA',  'WASHING PLANT'], ['SANWARIYA',  'COLOR SHOTER'], ['SANWARIYA',  'CRUSHER'],
    ['KHAKHUNDA',  'WASHING PLANT'], ['KHAKHUNDA',  'COLOR SHOTER'], ['KHAKHUNDA',  'CRUSHER']
  ];
  var haveSec = {};
  readAll_(SH.SECTIONS).forEach(function (r) {
    haveSec[String(r.Site_Name).toUpperCase().trim() + '|' +
            String(r.Section_Name).toUpperCase().trim()] = true;
  });
  insertMany_(SH.SECTIONS, seedSections
    .filter(function (r) { return !haveSec[r[0] + '|' + r[1]]; })
    .map(function (r) { return { Site_Name: r[0], Section_Name: r[1], Active: 'TRUE' }; }));

  // 4. Seed users (default PIN 1234 — change from Admin ▸ Users) ------
  var seedUsers = [
    ['ADMIN',    'Administrator',   'ADMIN',    'ALL',        ''],
    ['PC01',     'Process Coordinator', 'PC',   'ALL',        ''],
    ['VINOD',    'Vinod',           'PURCHASE', 'ALL',        ''],
    ['HEMRAJ',   'Hemraj',          'PURCHASE', 'ALL',        ''],
    ['DEEPAK',   'Deepak',          'STORE',    'TONK',       ''],
    ['SHYOJI',   'Shyoji',          'STORE',    'KHAKHUNDA',  ''],
    ['SONU',     'Sonu',            'USER',     'TONK',       ''],
    ['PRASHANT', 'Prashant Pareek', 'USER',     'NEWAI',      ''],
    ['LALA',     'Lala Banna',      'USER',     'TONK',       ''],
    ['ISLAM',    'Islam Khan',      'USER',     'SANWARIYA',  ''],
    ['JAWED',    'Jawed Khan',      'USER',     'KHAKHUNDA',  '']
  ];
  var have = readAll_(SH.USERS).map(function (u) { return String(u.User_ID).toUpperCase(); });
  var toAdd = [];
  seedUsers.forEach(function (u) {
    if (have.indexOf(u[0]) !== -1) return;
    toAdd.push({
      User_ID: u[0], Name: u[1], Role: u[2], Site: u[3],
      Phone: '', Email: u[4], PIN_Hash: hashPin_(u[0], '1234'),
      Active: 'TRUE', Created_At: now_()
    });
  });
  insertMany_(SH.USERS, toAdd);

  // 5. Seed vendors from the existing register ------------------------
  var seedVendors = ['Local', 'Metso India', 'KP India', 'Kethvisri Polyurathane', 'Best Elestomers',
                     'Cflo', 'R.S Enterprises', 'Bull Conveyor', 'Pawan Wire and Cable',
                     'Aira Euro Automation Pvt. Ltd.'];
  var haveV = readAll_(SH.VENDORS).map(function (v) { return String(v.Vendor_Name).toUpperCase(); });
  var addV = [];
  var seq = readAll_(SH.VENDORS).length;
  seedVendors.forEach(function (v) {
    if (haveV.indexOf(v) !== -1) return;
    seq++;
    var id = 'VEN-' + ('000' + seq).slice(-3);
    addV.push({ Vendor_ID: id, Vendor_Name: v, Contact_Person: '', Phone: '', Email: '',
                Category: 'GENERAL', Active: 'TRUE', Created_By: 'SETUP', Created_At: now_() });
  });
  insertMany_(SH.VENDORS, addV);

  // 5b. Keep the editable turn-around map in step with the pipeline ---
  syncTatSetting_();

  // 5c. Bring a v1 installation up to the v2 pipeline ------------------
  var migrated = migrateToV2_();

  // 5d. Bring a v6 installation up to sites + sections -----------------
  var unsited = migrateToSites_();

  // 5e. Give older indents a requested quantity -------------------------
  backfillRequestedQty_();

  // 6. Remember the spreadsheet id + install triggers -----------------
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  installTriggers();

  // 5f. Report anything the old floor-at-zero already broke -----------
  var drift = [];
  try { drift = reconcileStock_(null); } catch (e) { drift = []; }

  var msg = 'Setup complete. ' + toAdd.length + ' users and ' + addV.length + ' vendors seeded' +
            (migrated ? ', ' + migrated + ' existing indents migrated' : '') +
            (renamed ? ', ' + renamed + ' column headers renamed' : '') + '.';
  if (unsited) {
    msg += ' ' + unsited + ' user' + (unsited === 1 ? ' has' : 's have') +
           ' no site yet — set each one in Admin \u25b8 Users before they can raise an indent.';
  }
  if (drift.length) {
    msg += ' \u26a0 ' + drift.length + ' stock item' + (drift.length === 1 ? '' : 's') +
           ' cannot be reconciled with their own ledger — run reconcileStock() to list them, ' +
           'then count and correct each one under Stock \u25b8 Edit.';
  }
  return msg + ' Default PIN for every seeded user is 1234.';
}

/** Time-driven triggers (safe to re-run — old ones are removed first). */
function installTriggers() {
  portalAssertEditor_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (['processReminders', 'nightlyStageSweep', 'pollTelegram', 'overdueSweep',
         'stockSweep', 'updateConsumption']
        .indexOf(f) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processReminders').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('pollTelegram').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('overdueSweep').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('nightlyStageSweep').timeBased().atHour(6).everyDays(1).create();
  // the stock side: catch rows typed straight into the ledger, and keep
  // consumption (and every reorder point that depends on it) current
  ScriptApp.newTrigger('stockSweep').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('updateConsumption').timeBased().atHour(5).everyDays(1).create();
  return 'Triggers installed.';
}

/** Reset any user's PIN (Apps Script editor helper). */
function resetPin(userId, newPin) {
  portalAssertEditor_();
  var u = findBy_(SH.USERS, 'User_ID', userId);
  if (!u) throw new Error('No such user: ' + userId);
  update_(SH.USERS, u.__row, { PIN_Hash: hashPin_(u.User_ID, newPin) });
  return 'PIN updated for ' + userId;
}

/** Recomputes Planned_At / delay figures for every open stage. */
function nightlyStageSweep() {
  var rows = readWhere_(SH.STAGES, function (r) { return String(r.Status) === 'PENDING'; });
  var n = now_();
  rows.forEach(function (r) {
    var planned = toDate_(r.Planned_At);
    if (!planned) return;
    var delay = n.getTime() > planned.getTime() ? Math.round((n - planned) / 60000) : 0;
    update_(SH.STAGES, r.__row, { Delay_Mins: delay });
  });
  bumpIfDirty_();
  return rows.length;
}


/* ==================================================================
   Turn-around-time map: add newly introduced stages, drop retired
   ones, and keep whatever hours the admin had already set.
   ================================================================== */
function syncTatSetting_() {
  var current = {};
  try { current = JSON.parse(getSetting_('STAGE_TAT_JSON') || '{}') || {}; } catch (e) { current = {}; }
  // v1 -> v2 key renames, so the admin's own numbers survive the upgrade
  var renames = { GOODS_RECEIVED: 'RECEIVE_CHECK', QC_CHECK: 'PLANT_RECEIVE' };
  Object.keys(renames).forEach(function (oldKey) {
    if (current[oldKey] !== undefined && current[renames[oldKey]] === undefined) {
      current[renames[oldKey]] = current[oldKey];
    }
  });
  var out = {};
  STAGES.forEach(function (st) {
    out[st.key] = (current[st.key] === undefined || current[st.key] === '') ? st.tat : Number(current[st.key]);
  });
  setSetting_('STAGE_TAT_JSON', JSON.stringify(out), 'Turn-around-time per stage, in hours');
  return out;
}

/* ==================================================================
   v1 -> v2 migration.  Idempotent: safe to run any number of times.
     • "Goods Received"      becomes "Receive & Check"   (stage 7)
     • "Quality & Qty Check" becomes "Plant Receipt & Check" (stage 9)
     • Direct-to-plant consignments have the whole hub leg
       (Send To Station + Plant Receipt) marked SKIPPED.
   ================================================================== */
function migrateToV2_() {
  var KEY_MAP = { GOODS_RECEIVED: 'RECEIVE_CHECK', QC_CHECK: 'PLANT_RECEIVE' };
  var STATUS_MAP = {
    GOODS_RECEIVED : STATUS.RECEIVED_AT_HUB,
    SENT_TO_STATION: STATUS.IN_TRANSIT_TO_PLANT,
    QC_DONE        : STATUS.RECEIVED_AT_PLANT
  };
  var touched = 0;

  // 1. stage rows -----------------------------------------------------
  readAll_(SH.STAGES).forEach(function (r) {
    var newKey = KEY_MAP[String(r.Stage_Key)];
    if (!newKey) return;
    var st = stageByKey_(newKey);
    update_(SH.STAGES, r.__row, { Stage_Key: newKey, Stage_Name: st ? st.name : newKey });
  });

  // 2. history --------------------------------------------------------
  readAll_(SH.HISTORY).forEach(function (r) {
    var newKey = KEY_MAP[String(r.Stage_Key)];
    if (!newKey) return;
    var st = stageByKey_(newKey);
    update_(SH.HISTORY, r.__row, { Stage_Key: newKey, Stage_Name: st ? st.name : newKey });
  });

  // 3. follow-ups & reminders ----------------------------------------
  [SH.FOLLOWUPS, SH.REMINDERS].forEach(function (tab) {
    readAll_(tab).forEach(function (r) {
      var newKey = KEY_MAP[String(r.Stage_Key)];
      if (!newKey) return;
      var st = stageByKey_(newKey);
      update_(tab, r.__row, { Stage_Key: newKey, Stage_Name: st ? st.name : newKey });
    });
  });

  // 4. stock ledger ---------------------------------------------------
  readAll_(SH.STOCK).forEach(function (r) {
    if (String(r.Transaction_Type) !== 'RECEIVED') return;
    update_(SH.STOCK, r.__row, { Transaction_Type: STOCK_TXN.RECEIVED_AT_PLANT });
  });

  // 5. indents --------------------------------------------------------
  readAll_(SH.INDENTS).forEach(function (ind) {
    var patch = {};
    var newStage = KEY_MAP[String(ind.Current_Stage)];
    if (newStage) patch.Current_Stage = newStage;
    var newStatus = STATUS_MAP[String(ind.Status)];
    if (newStatus) patch.Status = newStatus;

    // the old single QC result becomes the final plant check
    if (safeStr_(ind.Received_Qty) && !safeStr_(ind.Final_Receipt_Location)) {
      patch.Final_Receipt_Location = safeStr_(ind.Primary_Location) || ind.Site;
    }

    var closed = [STATUS.COMPLETED, STATUS.REJECTED, STATUS.CANCELLED].indexOf(String(ind.Status)) !== -1;
    if (!closed && String(ind.Destination_Type) === 'DIRECT_TO_PLANT') {
      var rows = stageRowsFor_(ind.Indent_ID);
      var pending = false;
      rows.forEach(function (r) {
        if (STAGE_SET.HUB_LEG.indexOf(String(r.Stage_Key)) === -1) return;
        if (String(r.Status) === 'DONE') return;
        if (String(r.Status) !== 'SKIPPED') {
          update_(SH.STAGES, r.__row, { Status: 'SKIPPED', Note: 'Shipped direct to plant — no hub leg' });
          pending = true;
        }
      });
      // an indent parked on a stage that no longer applies moves forward
      if (STAGE_SET.HUB_LEG.indexOf(String(patch.Current_Stage || ind.Current_Stage)) !== -1) {
        var at = now_();
        var t  = openStage_(ind.Indent_ID, 'CONFIRM_REQUEST', at);
        patch.Current_Stage    = 'CONFIRM_REQUEST';
        patch.Stage_Entered_At = t ? t.entered : at;
        patch.Stage_Planned_At = t ? t.planned : '';
        patch.Status           = STATUS.RECEIVED_AT_PLANT;
      }
      if (pending) touched++;
    }
    if (Object.keys(patch).length) {
      update_(SH.INDENTS, ind.__row, patch);
      if (!patch.Current_Stage && !patch.Status) return;
      touched++;
    }
  });

  return touched;
}

/** Run this by hand if you upgraded the code without re-running setupSystem(). */
function migrateToV2() {
  portalAssertEditor_();
  syncTatSetting_();
  return 'Migrated ' + migrateToV2_() + ' indents to the v2 pipeline.';
}

/* ==================================================================
   v6 -> v7 : "Plant" becomes "Site"
   ------------------------------------------------------------------
   Two columns are renamed in place, so no data is copied or lost:
       Users.Plant_Location   ->  Users.Site
       Indents.Plant_Name     ->  Indents.Site
       Stock_Logs.Plant_Location -> Stock_Logs.Site
   New columns (Indents.Section, Stock_Logs.Balance_After) are added by
   the tab rebuild in step 1, which only ever writes the header row.
   ================================================================== */
function renameLegacyHeaders_(ss) {
  var RENAMES = {
    Users     : { Plant_Location: 'Site' },
    Indents   : { Plant_Name: 'Site' },
    Stock_Logs: { Plant_Location: 'Site' }
  };
  // every per-site item tab gets the same treatment
  SITES.forEach(function (site) {
    RENAMES['INV_' + site] = { Min_Stock: 'ROP_Override' };
  });
  var n = 0;
  Object.keys(RENAMES).forEach(function (tab) {
    var sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastColumn() === 0) return;
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var changed = false;
    for (var c = 0; c < head.length; c++) {
      var to = RENAMES[tab][String(head[c]).trim()];
      if (to && head.indexOf(to) === -1) { head[c] = to; changed = true; n++; }
    }
    if (changed) sh.getRange(1, 1, 1, head.length).setValues([head]);
  });
  if (n) memoClear_();
  return n;
}

/* ==================================================================
   Puts every account and every indent onto one of the four sites.

   Existing people keep working, but a shop-floor user or storekeeper
   whose old plant is not one of the four sites is left BLANK on
   purpose — you asked to reassign them yourself. They can still sign
   in and see their history; the app simply asks the administrator to
   set their site before they raise anything new.

   Admin, purchase and the coordinator are set to ALL, because they
   work across every site.
   ================================================================== */
function migrateToSites_() {
  var withoutSite = 0;

  readAll_(SH.USERS).forEach(function (u) {
    var cur  = String(u.Site || '').toUpperCase().trim();
    var role = String(u.Role || '').toUpperCase();

    if (!roleNeedsSite_(role)) {
      if (cur !== SITE_ALL) update_(SH.USERS, u.__row, { Site: SITE_ALL });
      return;
    }
    if (isSite_(cur)) return;                       // already on a real site
    if (cur) update_(SH.USERS, u.__row, { Site: '' });   // an old plant name: clear it
    withoutSite++;
  });

  /* Old indents keep the plant name they were raised against — that is
     their history and rewriting it would be a lie. They are simply upper-cased
     so the site filters match. Anything not one of the four sites stays as it
     is and shows up under its own name in the register. */
  readAll_(SH.INDENTS).forEach(function (r) {
    var raw = String(r.Site || '').trim();
    if (raw && raw !== raw.toUpperCase()) update_(SH.INDENTS, r.__row, { Site: raw.toUpperCase() });
  });

  return withoutSite;
}


/* ==================================================================
   A sheet's data rows are positional. Writing a new header row over an
   old one is only safe when every column the old sheet already had is
   still in the same place — otherwise every historic value would shift
   sideways under the wrong heading and the data would be quietly ruined.

   So: before touching anything, check that the existing header is a
   prefix-compatible match for the new one. New columns may only be
   ADDED AT THE END. If that is ever not true, stop and say so rather
   than corrupting the spreadsheet.
   ================================================================== */
function assertHeadersLineUp_(ss, allTabs) {
  var problems = [];
  Object.keys(allTabs).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastColumn() === 0 || sh.getLastRow() < 2) return;   // new or empty: nothing to shift
    var have = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                 .map(function (h) { return String(h).trim(); });
    var want = allTabs[name];
    for (var i = 0; i < have.length; i++) {
      if (!have[i]) continue;                       // a blank trailing column is harmless
      if (want[i] !== have[i]) {
        problems.push(name + ': column ' + (i + 1) + ' is "' + have[i] +
                      '" but this version expects "' + (want[i] || '(nothing)') + '"');
        break;
      }
    }
  });
  if (problems.length) {
    throw new Error('Setup stopped so your data is not damaged. These tabs have columns in an ' +
      'unexpected order, and writing the new headings over them would shift every existing row ' +
      'sideways:\n\n  • ' + problems.join('\n  • ') +
      '\n\nTake a copy of the spreadsheet, then either put those columns back in order or ' +
      'tell me what the tab looks like and I will write a migration for it.');
  }
}


/* ==================================================================
   Older indents have no Requested_Qty, because the column did not
   exist when they were raised. The order quantity is the only figure
   there is, so that is what goes in — it is right for every indent the
   store did not change, and the honest best guess for the rest.
   Runs once; a row that already has a figure is left alone.
   ================================================================== */
function backfillRequestedQty_() {
  var n = 0;
  readAll_(SH.INDENTS).forEach(function (r) {
    if (safeStr_(r.Requested_Qty)) return;
    if (!safeStr_(r.Quantity)) return;
    update_(SH.INDENTS, r.__row, { Requested_Qty: r.Quantity });
    n++;
  });
  return n;
}
