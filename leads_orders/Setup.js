/*******************************************************
 * Setup.js — sheet menu, one-time setup, triggers.
 *
 *   setup()          tabs, photo folder, triggers (run once from the editor or the menu)
 *   fmsChanged(e)    any hand edit in this spreadsheet → the board reloads within seconds
 *   warmBoards()     every 10 minutes: keeps the board ready in the cache
 *   dailyOverdue()   every evening: overdue tiles cost their people points (Perf.js)
 *   notifyTick()     every 5 minutes, once a Telegram bot is set: reminders + alerts (Notify.js)
 *******************************************************/

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Leads & Orders')
    .addItem('Set up / repair (tabs, triggers, photo folder)', 'setup')
    .addItem('Paste GGM Portal key…', 'pastePortalKey')
    .addItem('Re-read the LEADS / ORDERS headings and Steps tab', 'refreshLayout')
    .addItem('Rename owner names to Master App usernames now', 'renameOwnersNow')
    .addToUi();
}

function setup() {
  Object.keys(TABS).forEach(function (k) { tab_(TABS[k]); });
  photoFolder_();
  installTriggers_();
  refreshLayout(true);
  var msg = 'Tabs, photo folder and triggers are ready.';
  if (!PropertiesService.getScriptProperties().getProperty('PORTAL_KEY')) msg += '\n\nNext: Leads & Orders → Paste GGM Portal key (hub: Portal Admin → Connect selected app).';
  try { SpreadsheetApp.getUi().alert('Leads & Orders', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { Logger.log(msg); }
}

function pastePortalKey() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('GGM Portal key', 'In GGM Portal: Apps tab → click the LEADS row → Portal Admin → Connect selected app. Paste the key it shows here.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var k = String(r.getResponseText() || '').trim();
  if (k.length < 16) { ui.alert('That does not look like the key. Nothing was saved.'); return; }
  PropertiesService.getScriptProperties().setProperty('PORTAL_KEY', k);
  ui.alert('Saved. People ticked for LEADS in GGM Portal can now open the app.');
}

/** Drops the cached step layout (after columns were added or renamed in an FMS sheet). */
function refreshLayout(quiet) {
  FLOW_IDS.forEach(function (fid) { cache_().remove('lay_' + fid + LAY_V); });
  MEMO_ = {};
  FLOW_IDS.forEach(function (fid) { layout_(fid); });
  rebuildBoards_();
  if (quiet !== true) try { SpreadsheetApp.getUi().alert('The step layout was read again (LEADS / ORDERS headings, Steps and Holidays tabs).'); } catch (e) {}
}

function installTriggers_() {
  var have = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction() + '|' + (t.getTriggerSourceId() || '')] = 1; });
  var appId = appSs_().getId();
  // the old FMS sheets are no longer watched for edits; only their form answers are copied in
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'fmsChanged' && t.getTriggerSourceId() && t.getTriggerSourceId() !== appId) { ScriptApp.deleteTrigger(t); delete have['fmsChanged|' + t.getTriggerSourceId()]; }
  });
  if (!have['fmsChanged|' + appId]) ScriptApp.newTrigger('fmsChanged').forSpreadsheet(appId).onChange().create();
  dropFormTriggers_();
  var any = function (fn) { return Object.keys(have).some(function (k) { return k.indexOf(fn + '|') === 0; }); };
  if (!any('warmBoards')) ScriptApp.newTrigger('warmBoards').timeBased().everyMinutes(10).create();
  if (!any('dailyOverdue')) ScriptApp.newTrigger('dailyOverdue').timeBased().atHour(19).everyDays(1).inTimezone('Asia/Kolkata').create();
  if (!any('notifyTick')) ScriptApp.newTrigger('notifyTick').timeBased().everyMinutes(5).create();
  try { UrlFetchApp.fetch('https://api.telegram.org', { muteHttpExceptions: true }); } catch (e) {}   // asks for "connect to an external service" once
}

/** onChange of either FMS sheet (hand edits, form rows). The board is rebuilt here, so no visitor waits for it. */
function fmsChanged(e) {
  var t = e && e.changeType;
  if (t === 'INSERT_COLUMN' || t === 'REMOVE_COLUMN' || t === 'INSERT_GRID' || t === 'REMOVE_GRID') {
    FLOW_IDS.forEach(function (fid) { cache_().remove('lay_' + fid + LAY_V); });
  }
  rebuildBoards_();
}

/** Menu: rename owner names in both FMS sheets to Master App usernames right away. */
function renameOwnersNow() {
  var r = normalizeOwners_();
  var lines = Object.keys(r.report).map(function (k) { return k + ' (' + r.report[k] + ')'; });
  var msg = r.changed ? r.changed + ' cell(s) renamed:\n' + lines.join('\n') : 'Every owner name already is a Master App username.';
  if (r.unknown.length) msg += '\n\nNo Master App user found for: ' + r.unknown.join(', ') + ' (add the spelling in the app: Settings → People).';
  try { SpreadsheetApp.getUi().alert('Owner names', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { Logger.log(msg); }
}

/** Google Forms are no longer used: their form-submit triggers are removed. */
function dropFormTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'importForms') ScriptApp.deleteTrigger(t); });
}

function warmBoards() {
  var pp = PropertiesService.getScriptProperties();
  if (!pp.getProperty('FORMS_OFF')) { try { dropFormTriggers_(); pp.setProperty('FORMS_OFF', '1'); } catch (e) { Logger.log('form triggers: ' + e); } }
  var p = PropertiesService.getScriptProperties(), built = Number(p.getProperty('BOARD_BUILT') || 0);
  if (Date.now() - built > 28 * 60000 || !cacheGet_('bd2_L2O_last') || !cacheGet_('bd2_O2D_last')) {
    try { rebuildBoards_(); } catch (e) { Logger.log('rebuild: ' + e); }
  }
  try { normalizeOwners_(); } catch (e) { Logger.log('names: ' + e); }
  p.getKeys().forEach(function (k) { if (/^OVD_/.test(k) && k < 'OVD_' + isoOf_(Date.now() - 20 * 864e5)) p.deleteProperty(k); });
}
