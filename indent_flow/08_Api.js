/**********************************************************************
 * File: 08_Api.gs  —  Web entry point and the single API router.
 *
 *  The browser only ever calls  google.script.run.api(action, jsonPayload)
 *  and always receives a JSON *string*  {"ok":true,"data":…}  or
 *  {"ok":false,"error":"…"} — this keeps Date/serialisation quirks out
 *  of google.script.run entirely.
 *********************************************************************/

function doGet(e) {
  var gate = portalGate_(e);          // GGM Portal: launch pass / Portal-only (Portal.gs)
  if (gate.block) return gate.block;
  var t = HtmlService.createTemplateFromFile('Index');
  t.APP_NAME = APP.NAME;
  return portalInject_(t.evaluate(), gate)
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** The cheapest call in the system: no sheet is touched. The browser asks
 *  "has anything changed?" every few seconds and gets back a number. */
function pulse_(token) {
  var t = safeStr_(token);
  if (!t) throw new Error('Not signed in.');
  var who = null;
  try {
    var c = CacheService.getScriptCache().get('s_' + t);
    if (c) who = JSON.parse(c);
  } catch (e) {}
  if (!who) {                       // cache miss: fall back to the real check
    var u = requireAuth_(t);
    who = { u: u.User_ID, r: u.Role };
  }
  return { v: dataVersion_(), user: who.u, role: who.r, at: Date.now() };
}

/** Telegram posts its updates here once the webhook is installed. */
function doPost(e) {
  var portalRes = portalHandlePost_(e);   // requests from GGM Portal carry ?portal=1
  if (portalRes) return portalRes;
  try {
    if (!e || !e.parameter || e.parameter.tg !== tgSecret_()) {
      return ContentService.createTextOutput('no');
    }
    var update = JSON.parse(e.postData.contents);
    tgHandleUpdate_(update);   // idempotent: a redelivered update does nothing
    bumpIfDirty_();            // so open browsers notice the new connection
  } catch (err) {
    try { console.error('[doPost] ' + err); } catch (ignored) {}
  }
  return ContentService.createTextOutput('ok');
}

/** Used by Index.html to inline Styles.html / Scripts.html. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** The one and only server entry point. */
function api(action, payloadJson) {
  var p = {};
  try { p = payloadJson ? (typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson) : {}; }
  catch (e) { return JSON.stringify(err_('Malformed request payload.')); }

  var token = p.token || '';
  try {
    var data = route_(String(action), token, p);
    var out = ok_(data);
    // one stamp per request, so the browser knows in a few bytes that
    // something it is showing has changed
    out.v = bumpIfDirty_();
    return JSON.stringify(out);
  } catch (e) {
    var msg = (e && e.message) ? e.message : String(e);
    try {
      console.error('[api:' + action + '] ' + msg + '\n' + (e && e.stack ? e.stack : ''));
    } catch (ignored) {}
    return JSON.stringify(err_(msg));
  }
}

function route_(action, token, p) {
  switch (action) {

    /* ---- the heartbeat the browser polls ------------------------- */
    case 'pulse'       : return pulse_(token);

    /* ---- session ------------------------------------------------- */
    case 'ping'        : return { ok: true, time: iso_(now_()), app: APP.NAME, version: APP.VERSION };
    case 'login'       : return login_(p.userId, p.pin);
    case 'logout'      : return logout_(token);
    case 'me'          : var u = requireAuth_(token);
                         return { user: publicUser_(u), stages: stagesOut_() };
    case 'changePin'   : return changePin_(token, p.oldPin, p.newPin);
    case 'setLanguage' : return setLanguage_(token, p.language);
    case 'setLanguageFor': return setLanguageFor_(token, p.userId, p.language);

    /* ---- reads --------------------------------------------------- */
    case 'dashboard'   : return dashboard_(token);
    case 'listIndents' : return listIndents_(token, p.filter);
    case 'getIndent'   : return getIndent_(token, p.indentId);
    case 'masters'     : return masters_(token);
    case 'history'     : return getHistory_(token, p.filter);
    case 'pcBoard'     : return pcBoard_(token, p.filter);

    /* ---- indent lifecycle ---------------------------------------- */
    case 'createIndent'   : return createIndent_(token, p);
    case 'storeAction'    : return storeAction_(token, p);
    case 'relabelItem'    : return relabelIndentItem_(token, p);
    case 'purchaseSubmit' : return purchaseSubmit_(token, p);
    case 'shopPurchase'   : return shopPurchase_(token, p);
    case 'adminDecision'  : return adminDecision_(token, p);
    case 'setEta'         : return setEta_(token, p);
    case 'dispatchUpdate' : return dispatchUpdate_(token, p);
    case 'receiveCheck'   : return receiveCheck_(token, p);
    case 'sendToStation'  : return sendToStation_(token, p);
    case 'plantReceive'   : return plantReceive_(token, p);
    case 'confirmRequest' : return confirmRequester_(token, p);
    case 'cancelIndent'   : return cancelIndent_(token, p);

    /* ---- follow-ups & reminders ---------------------------------- */
    case 'addFollowup'       : return addFollowup_(token, p);
    case 'listReminders'     : return listReminders_(token, p.filter);
    case 'cancelReminder'    : return cancelReminder_(token, p);
    case 'rescheduleReminder': return rescheduleReminder_(token, p);

    /* ---- live notifications -------------------------------------- */
    case 'telegramStatus'  : return telegramStatus_(token);
    case 'telegramLink'    : return telegramLink_(token);
    case 'telegramUnlink'  : return telegramUnlink_(token);
    case 'telegramMute'    : return telegramMute_(token, p.muted);
    case 'telegramTest'    : return telegramTest_(token);
    case 'tgAdminState'    : return telegramAdminState_(token);
    case 'tgConfig'        : return telegramConfig_(token, p);
    case 'tgInstallHook'   : return telegramInstallWebhook_(token);
    case 'tgRemoveHook'    : return telegramRemoveWebhook_(token);
    case 'tgReset'         : return tgResetConnection_(token);
    case 'tgDiagnose'      : return tgDiagnose_(token);
    case 'tgRewind'        : return tgRewind_(token);
    case 'telegramCheckNow': return telegramForcePoll_(token);

    /* ---- inventory ------------------------------------------------ */
    case 'inventory'   : return listInventory_(token, p);
    case 'itemLookup'  : return itemLookup_(token, p);
    case 'addItem'     : return addInventoryItem_(token, p);
    case 'updateItem'  : return updateInventoryItem_(token, p);
    case 'reconcile'   : return reconcileStock_(token);
    case 'itemLedger'  : return itemLedger_(token, p);
    case 'stockHistory': return stockHistory_(token, p);
    case 'reorderList' : return reorderList_(token, p);
    case 'setOpening'  : return setOpeningStock_(token, p);

    /* ---- moving goods between two sites ---------------------------- */
    case 'transfers'     : return listTransfers_(token, p);
    case 'sendTransfer'  : return sendTransfer_(token, p);
    case 'receiveTransfer': return receiveTransfer_(token, p);
    case 'cancelTransfer': return cancelTransfer_(token, p);

    /* ---- item list changes, which the admin decides ---------------- */
    case 'itemRequests': return listItemRequests_(token, p);
    case 'decideItem'  : return decideItemRequest_(token, p);

    /* ---- masters / admin ----------------------------------------- */
    case 'listSections': return listSections_(token, p);
    case 'saveSection' : return saveSection_(token, p);
    case 'addVendor'   : return addVendor_(token, p);
    case 'listUsers'   : return listUsers_(token);
    case 'saveUser'    : return saveUser_(token, p);
    case 'saveSetting' : return saveSetting_(token, p);
    case 'saveSettings': return saveSettings_(token, p);
    case 'saveStages'  : return saveStages_(token, p);

    default: throw new Error('Unknown action: ' + action);
  }
}
