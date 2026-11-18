/*******************************************************
 * Triggers.gs
 * A year tab builds itself on first use, so these are a
 * safety net: they make sure the new year's tab exists
 * before anyone opens the app on 1 January, and they paint
 * each new day red the moment it starts.
 *******************************************************/

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'monthlyRollover' || fn === 'yearlyRollover' || fn === 'nightlyMaintenance' || fn === 'warmCaches') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('yearlyRollover')
    .timeBased().onMonthDay(1).atHour(0).nearMinute(5).create();

  ScriptApp.newTrigger('nightlyMaintenance')
    .timeBased().everyDays(1).atHour(0).nearMinute(15).create();

  ScriptApp.newTrigger('warmCaches')
    .timeBased().everyMinutes(5).create();

  ensureChangeTrigger_(true);
}

/**
 * Someone changes the sheet by hand (a mark, a colour, a name, Settings, Employees...): the app's
 * saved copies are dropped at once, so every open page shows it on its next refresh (Site rules,
 * 10-30 s) or straight away with the Refresh button. The app's own writes do not fire this.
 */
function sheetChanged(e) {
  try {
    var t = todayParts_(), keys = ['ATT_EMP', 'ATT_SETTINGS', 'ATT_OVERVIEW_' + t.iso, 'ALLTIME_STATS'];
    SITES.forEach(function (site) {
      keys.push(dayKey_(site, t.iso));
      for (var m = 1; m <= 12; m++) keys.push('ATT_REC_' + site + '_' + t.year + '_' + m);
    });
    CacheService.getScriptCache().removeAll(keys);
    MEMO_ = {};
    syncSupervisorDropdown_();
  } catch (err) {
    console.error('sheetChanged: ' + err);
  }
}

/** Makes sure sheetChanged is hooked to the spreadsheet (warmCaches checks this, once). */
function ensureChangeTrigger_(force) {
  var props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('ATT_CHANGE_TRIGGER') === '1') return;
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sheetChanged'; });
  if (!has) ScriptApp.newTrigger('sheetChanged').forSpreadsheet(ss_()).onChange().create();
  props.setProperty('ATT_CHANGE_TRIGGER', '1');
}

/**
 * Every 5 minutes: re-reads each site's day column and works out the Admin
 * month-to-date numbers (16-30 seconds of sheet reading), so no person ever
 * waits for them. The lock keeps a fresh read from overwriting a mark being saved.
 */
function warmCaches() {
  try { syncSupervisorDropdown_(); } catch (e) { console.error('syncSupervisorDropdown_: ' + e); }
  try { autoAbsent_(); } catch (e) { console.error('autoAbsent_: ' + e); }
  try { ensureChangeTrigger_(false); } catch (e) { console.error('ensureChangeTrigger_: ' + e); }
  try { backfillAbsentOnce_(); } catch (e) { console.error('backfillAbsentOnce_: ' + e); }
  try { salSetupOnce_(); } catch (e) { console.error('salSetupOnce_: ' + e); }
  try { salImportOnce_(); } catch (e) { console.error('salImportOnce_: ' + e); }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    SITES.forEach(function (site) { dropDay_(site); dayRows_(site); });
  } finally {
    lock.releaseLock();
  }
  var t = todayParts_();
  cacheDrop_('ATT_OVERVIEW_' + t.iso);
  overviewData_({ role: 'Admin', site: 'ALL' });
  SITES.forEach(function (site) {             // the Record tab's current month
    cacheDrop_('ATT_REC_' + site + '_' + t.year + '_' + t.month);
    siteMonthRows_(site, t.year, t.month);
  });
}

/** Fires on the 1st of every month; only does real work on 1 January. */
function yearlyRollover() {
  var t = todayParts_();
  if (t.month !== 1) return;
  var ss = ss_();
  SITES.forEach(function (site) { ensureYearSheet_(ss, site, t.year); });
  CacheService.getScriptCache().remove('ALLTIME_STATS');
}

/**
 * Start of day: clear yesterday's caches, pull in any roster changes,
 * and paint the new day red so it reads as "not approved yet".
 */
function nightlyMaintenance() {
  var ss = ss_();
  var t = todayParts_();
  var cache = CacheService.getScriptCache();
  cache.remove('ALLTIME_STATS');
  var props = PropertiesService.getScriptProperties();   // yesterday's "Marked by me" lists
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf('ATT_BY_') === 0 && k.indexOf('ATT_BY_' + t.iso + '_') !== 0) props.deleteProperty(k);
  });

  SITES.forEach(function (site) {
    var name = yearTabName_(site, t.year);
    cache.remove('ROSTER_' + name);
    var sh = ensureYearSheet_(ss, site, t.year);
    syncRoster_(ss, sh, site, t.year, true);
    paintElapsedDays_(sh, t.year);
  });
  try { salSyncSetup_(ss); } catch (e) { console.error('salSyncSetup_: ' + e); }   // new people get a Salary Setup row
}

/** Handy from the editor if a day ever fails to turn red. */
function repaintThisYear() {
  var ss = ss_();
  var t = todayParts_();
  var props = PropertiesService.getDocumentProperties();
  SITES.forEach(function (site) {
    var sh = ss.getSheetByName(yearTabName_(site, t.year));
    if (!sh) return;
    props.deleteProperty('PAINTED_' + sh.getName());
    paintElapsedDays_(sh, t.year);
  });
}
