// ============================================================
//  LIVE SELF-TEST: one throw-away vehicle goes through the real system -
//  add -> shows at its site -> dispatch -> shows in transit (sheet, dashboards, Receiving
//  form list) -> only the right site can receive -> receive -> shows at the new site.
//  Afterwards every trace of it is removed (form rows, sheet cells, vehicle-details row).
//  Run liveSelfTest() from the editor; the result is in the execution log.
// ============================================================

function liveSelfTest() {
  var NAME = 'ZZ SELF TEST ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'ddMMyy HHmmss');
  var FROM = 'TONK', TO = 'NEWAI', CAT = 'DUMPERS';
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var realSession = assetsSession_;
  var as = function (site) { assetsSession_ = function () { return site === 'BOSS' ? { boss: true, site: 'BOSS', who: 'SELF TEST' } : { boss: false, site: site, who: 'SELF TEST' }; }; };
  var log = [], fails = 0;
  var check = function (label, ok, extra) { log.push((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '   [' + extra + ']' : '')); if (!ok) fails++; };
  var list = function (tabName, site, heading) { return siteList_(readSiteTab_(ss, tabName), site, heading).filter(String); };
  var status = function () { return getGlobalAssetStatus_()[NAME]; };
  var dash = function (site) { as(site); var d = JSON.parse(getDashboardDataUI('x')); return d.ok ? d.assets[NAME] : null; };
  var inUpdater = function () { SpreadsheetApp.flush(); return ss.getSheetByName('updater').getRange('B2:B').getDisplayValues().some(function (r) { return r[0] === NAME; }); };

  try {
    // 1. add
    as('BOSS');
    var add = processAddNewAsset('x', { name: NAME, cat: CAT, loc: FROM, ownership: 'OWN', files: [], date: '', company: 'SELF TEST', model: 'SELF TEST', regNo: NAME, chasis: '', engine: '', motor: '', owner: 'SELF TEST' });
    check('1. add the vehicle at ' + FROM, add && add.success, add && add.message);
    check('   it is in Owned By Us > ' + FROM + ' > ' + CAT, list(OWN_TAB, FROM, CAT).indexOf(NAME) > -1);
    var s = status();
    check('   the system sees it AT BASE at ' + FROM, s && s.status === 'AT_BASE' && s.location === FROM, s && s.status + ' ' + s.location);
    SpreadsheetApp.flush();
    check('   For Forms lists it under ' + FROM + ' ' + CAT + ' (Google Forms dropdowns)', list(FORMS_TAB, FROM, CAT).indexOf(NAME) > -1);
    check('   a second vehicle with the same name is refused', /already exists/.test((processAddNewAsset('x', { name: NAME, cat: CAT, loc: TO, ownership: 'OWN', files: [] }) || {}).message || ''));

    // 2. dispatch
    as(TO);
    check('2. another site cannot dispatch it', !processWebTransfer('x', NAME, CAT, FROM, TO, 'SELF TEST', [], 'self test').success);
    as(FROM);
    var tr = processWebTransfer('x', NAME, CAT, FROM, TO, 'SELF TEST', [], 'self test');
    check('   ' + FROM + ' dispatches it to ' + TO, tr && tr.success, tr && tr.message);
    s = status();
    check('   the system sees it IN TRANSIT ' + FROM + ' -> ' + TO, s && s.status === 'IN_TRANSIT' && s.location === FROM && s.dest === TO, s && s.status + ' ' + s.location + ' -> ' + s.dest);
    var box = readSiteTab_(ss, OWN_TAB), mv = siteList_(box, FROM, IN_TRANSFER), gt = siteList_(box, FROM, TRANSFER_DEST), k = mv.indexOf(NAME);
    check('   sheet: in ' + FROM + ' "Asset In Transfer" with "' + TO + '"', k > -1 && gt[k] === TO);
    check('   sheet: no longer in ' + FROM + ' ' + CAT, list(OWN_TAB, FROM, CAT).indexOf(NAME) < 0);
    check('   ' + FROM + ' cannot dispatch it again while it is moving', /already on its way/.test(processWebTransfer('x', NAME, CAT, FROM, 'SANWARIYA', 'x', [], '').message || ''));
    var dTo = dash(TO), dFrom = dash(FROM);
    check('   ' + TO + ' dashboard shows it as incoming (can be received)', dTo && dTo.status === 'IN_TRANSIT' && dTo.dest === TO);
    check('   ' + FROM + ' dashboard shows it as on the way', dFrom && dFrom.status === 'IN_TRANSIT');
    check('   updater "Assets in Transfer" lists it (Google Receiving form list)', inUpdater());

    // 3. receive
    as('SANWARIYA');
    check('3. a site it was not sent to cannot receive it', !processWebReceive('x', NAME, 'SANWARIYA', CAT, 'x', [], '').success);
    as(TO);
    var rc = processWebReceive('x', NAME, TO, CAT, 'SELF TEST', [], 'self test');
    check('   ' + TO + ' receives it', rc && rc.success, rc && rc.message);
    s = status();
    check('   the system sees it AT BASE at ' + TO, s && s.status === 'AT_BASE' && s.location === TO, s && s.status + ' ' + s.location);
    check('   sheet: in ' + TO + ' ' + CAT, list(OWN_TAB, TO, CAT).indexOf(NAME) > -1);
    check('   sheet: out of every "Asset In Transfer" box', LOCATION_BLOCKS.every(function (b) { return list(OWN_TAB, b.name, IN_TRANSFER).indexOf(NAME) < 0; }));
    SpreadsheetApp.flush();
    check('   For Forms moved it from ' + FROM + ' to ' + TO, list(FORMS_TAB, TO, CAT).indexOf(NAME) > -1 && list(FORMS_TAB, FROM, CAT).indexOf(NAME) < 0);
    check('   updater no longer lists it as in transfer', !inUpdater());
    check('   receiving it twice is refused', !processWebReceive('x', NAME, TO, CAT, 'x', [], '').success);
    var hist = ss.getSheetByName('History').getDataRange().getDisplayValues().filter(function (r) { return r.join('|').indexOf(NAME) > -1; });
    check('   History shows the dispatch and the receipt', hist.length >= 1, hist.length + ' row(s)');
    var probs = healthCheck_().filter(function (p) { return String(p[1]).indexOf(NAME) > -1; });
    check('   Health Check finds nothing wrong with it', probs.length === 0, probs.map(function (p) { return p[0]; }).join('; '));
  } catch (e) {
    check('no crash', false, String(e && e.stack || e));
  } finally {
    assetsSession_ = realSession;
    log.push('Cleaning up: ' + cleanSelfTest_(ss, NAME));
  }
  // nothing left behind
  check('after clean-up: not in the asset list', !getGlobalAssetStatus_()[NAME]);
  var left = [OWN_TAB, CON_TAB, 'Asset Transfer Form', 'Asset Receiving Form', 'History', 'updater'].filter(function (n) {
    var sh = ss.getSheetByName(n); return sh && sh.getDataRange().getDisplayValues().some(function (r) { return r.join('|').indexOf(NAME) > -1; });
  });
  check('after clean-up: no trace in any tab', left.length === 0, left.join(', '));
  log.unshift(fails ? 'SELF-TEST: ' + fails + ' FAILED' : 'SELF-TEST: ALL PASSED', 'vehicle: ' + NAME);
  Logger.log(log.join('\n'));
  return log.join('\n');
}

/** Remove every trace of the self-test vehicle, then sync. */
function cleanSelfTest_(ss, name) {
  var done = [];
  ['Asset Transfer Form', 'Asset Receiving Form'].forEach(function (n) {
    var sh = ss.getSheetByName(n), v = sh.getDataRange().getValues();
    for (var r = v.length - 1; r >= 1; r--) if (v[r].some(function (x) { return String(x).trim() === name; })) { sh.deleteRow(r + 1); done.push(n + ' row ' + (r + 1)); }
  });
  [OWN_TAB, CON_TAB].forEach(function (n) {
    var t = readSiteTab_(ss, n);
    t.rows.forEach(function (row, i) { row.forEach(function (x, c) { if (String(x).trim() === name) { t.sheet.getRange(DATA_ROW + i, c + 1).setValue(''); done.push(n + ' cell'); } }); });
  });
  var ext = SpreadsheetApp.openById(VEHICLE_SHEET_ID).getSheetByName('DUMPER');
  if (ext) {
    var ev = ext.getDataRange().getValues();
    for (var r2 = ev.length - 1; r2 >= 0; r2--) if (ev[r2].some(function (x) { return String(x).trim() === name; })) { ext.deleteRow(r2 + 1); done.push('vehicle details row'); }
  }
  SpreadsheetApp.flush();
  runMasterSync();
  try { forgetVehicleDetails_(); } catch (e) {}
  return done.join(', ') || 'nothing to clean';
}
