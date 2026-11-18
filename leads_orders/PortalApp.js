/*******************************************************
 * PortalApp.js — how GGM Portal (the hub) talks to Leads & Orders.
 * The shared login is GgmLogin.js (same file in every v2 app).
 *
 * Who can sign in: the tab "Portal Users LEADS" in this app's spreadsheet, written
 * by the hub when the IT admin ticks LEADS for someone in the Access grid with a
 * Role (Admin / Manager / Executive / Lead Generator / Order Generator). No doer name: the person who signs in is who
 * they are; their leads are found by their portal name (Settings → People adds
 * other spellings), and the admin assigns steps and leads inside the app.
 *
 * Setup: Script properties → PORTAL_KEY (hub: Portal Admin → Connect selected app),
 * or Leads & Orders menu → "Paste GGM Portal key". Hub Apps row: LEADS · Type
 * CONNECTED · Fields role · Sheet ID = this spreadsheet.
 *******************************************************/

var GGM_APP = {
  id: 'LEADS',
  name: 'Leads & Orders',
  hub: 'https://script.google.com/macros/s/AKfycbyWO02yOI3G9IcE1QjCMEvvJostJZL7_2o8DSYIMEswCtI9Ub8sI9uBTdMp_Zd0WSXvSQ/exec?app=LEADS',
  sheetId: '1sQ_3GJ5NuMqqMSKFJrezxFG2cyk35tmLq6_WXzj4FpI',   // "Leads & Orders App" (holds Portal Users LEADS + the app's tabs)

  /** Dropdown in the hub's Access grid: the role. */
  meta: function () {
    return { roles: ROLES.slice() };
  },

  /** Tile badge: tiles this person has to act on that are overdue or nearly due. */
  counts: function (list) {
    var out = {}, tiles = openTiles_();
    list.forEach(function (x) {
      try {
        var u = ggmRows_()[String(x.u).toLowerCase()] || { username: x.u, name: x.u, role: x.r }, role = roleOf_(u), n = 0;
        if (GEN_FLOW[role]) { out[x.u] = 0; return; }      // form-only roles have no tiles
        tiles.forEach(function (t) {
          if (t.due !== 'over' && t.due !== 'warn') return;
          // Executive: own tiles overdue or nearly due · Admin / Manager: every overdue tile
          if (role === 'exec' ? canAct_(u, t.fid, t.lead, t.step) : t.due === 'over') n++;
        });
        out[x.u] = n;
      } catch (e) { out[x.u] = 0; }
    });
    return out;
  }
};

/** Requests from GGM Portal (badges, dropdowns, connection test). */
function doPost(e) {
  return ggmHandlePost_(e) || ContentService.createTextOutput('Not found');
}
