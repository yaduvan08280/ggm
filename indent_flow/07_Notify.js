/**********************************************************************
 * File: 07_Notify.gs  —  Live Telegram notifications
 *
 *  Every workflow step calls notify_(). It resolves who should hear
 *  about it, sends them a push through the bot, and writes what it did
 *  to the Notifications tab.
 *
 *  Nothing in here is ever allowed to break a workflow step: every
 *  entry point is wrapped so a Telegram outage cannot stop the plant.
 *********************************************************************/

var TG_API = 'https://api.telegram.org/bot';

/* ================================================================== */
/*  Configuration                                                      */
/* ================================================================== */

/** The bot token lives in Script Properties, not in the spreadsheet. */
function tgToken_() {
  return PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '';
}
function tgSecret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('TELEGRAM_WEBHOOK_SECRET');
  if (!s) { s = uuid_().replace(/-/g, ''); p.setProperty('TELEGRAM_WEBHOOK_SECRET', s); }
  return s;
}
function tgEnabled_() {
  return truthy_(getSetting_('TELEGRAM_ENABLED')) && !!tgToken_();
}
function tgBotUsername_() { return safeStr_(getSetting_('TELEGRAM_BOT_USERNAME')).replace(/^@/, ''); }

function appUrl_() {
  var u = safeStr_(getSetting_('APP_URL'));
  if (u) return u;
  try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; }
}

function notifyEnabledFor_(eventKey) {
  var raw = getSetting_('NOTIFY_EVENTS_JSON');
  if (!raw) return true;
  try {
    var m = JSON.parse(raw);
    return m[eventKey] !== false;
  } catch (e) { return true; }
}

/* ================================================================== */
/*  Telegram transport                                                 */
/* ================================================================== */

var TG_SCOPE_HELP =
  'This script is not allowed to reach the internet yet. Open the Apps Script editor ▸ ' +
  'Project Settings ▸ tick "Show appsscript.json", then add ' +
  '"https://www.googleapis.com/auth/script.external_request" to oauthScopes, save, and run ' +
  'any function once to approve it. No Cloud Console project is needed.';

/** POST to the Bot API. Returns the parsed reply, or throws. */
function tgCall_(method, payload) {
  var token = tgToken_();
  if (!token) throw new Error('No Telegram bot token has been saved yet.');
  var res;
  try {
    res = UrlFetchApp.fetch(TG_API + token + '/' + method, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true
    });
  } catch (e) {
    var m = String(e && e.message ? e.message : e);
    if (/permission|scope|external_request|not sufficient/i.test(m)) {
      throw new Error(TG_SCOPE_HELP);
    }
    throw new Error('Could not reach Telegram: ' + m);
  }
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {
    throw new Error('Telegram sent back something unreadable (HTTP ' + res.getResponseCode() + ').');
  }
  if (!body.ok) throw new Error(body.description || ('Telegram refused the request (' + method + ').'));
  return body.result;
}

/** Send one message. `buttonUrl` adds a tap-through into the web app. */
function tgSend_(chatId, html, buttonUrl, buttonText) {
  var payload = {
    chat_id: String(chatId),
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (buttonUrl && /^https:\/\//.test(buttonUrl)) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: buttonText || 'Open in Indent Flow', url: buttonUrl }]]
    };
  }
  return tgCall_('sendMessage', payload);
}

/** Send the same message to many chats in one parallel batch.
 *  Returns [{ok, error}] lined up with the chat ids given. */
function tgSendMany_(chatIds, html, buttonUrl, lang) {
  if (!chatIds || !chatIds.length) return [];
  var token = tgToken_();
  if (!token) return chatIds.map(function () {
    return { ok: false, error: 'No Telegram bot token has been saved yet.' };
  });

  var markup = (buttonUrl && /^https:\/\//.test(buttonUrl))
    ? { inline_keyboard: [[{ text: tr_('Open in Indent Flow', lang), url: buttonUrl }]] } : null;

  var requests = chatIds.map(function (id) {
    var body = { chat_id: String(id), text: html, parse_mode: 'HTML',
                 disable_web_page_preview: true };
    if (markup) body.reply_markup = markup;
    return { url: TG_API + token + '/sendMessage', method: 'post',
             contentType: 'application/json', payload: JSON.stringify(body),
             muteHttpExceptions: true };
  });

  var responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch (e) {
    var m = String(e && e.message ? e.message : e);
    if (/permission|scope|external_request|not sufficient/i.test(m)) m = TG_SCOPE_HELP;
    return chatIds.map(function () { return { ok: false, error: m }; });
  }

  return responses.map(function (res) {
    try {
      var body = JSON.parse(res.getContentText());
      return body.ok ? { ok: true, error: '' }
                     : { ok: false, error: body.description || 'Telegram refused the message.' };
    } catch (e) {
      return { ok: false, error: 'Telegram sent back something unreadable.' };
    }
  });
}

/* ================================================================== */
/*  Who hears about it                                                 */
/* ================================================================== */

/** Active users who should receive `event` for `indent`. */
function notifyTargets_(eventKey, indent, extra) {
  var def = NOTIFY_EVENTS[eventKey];
  if (!def) return [];
  var users = readAll_(SH.USERS).filter(function (u) { return truthy_(u.Active); });
  var want = def.to;

  function sameSite(u) {
    var up = String(u.Site || '').toUpperCase();
    if (!up || up === 'ALL') return true;
    if (!indent) return true;
    return up === String(indent.Site || '').toUpperCase();
  }

  var list = [];
  if (want === 'REQUESTER') {
    users.forEach(function (u) {
      if (indent && String(u.User_ID) === String(indent.Requester_ID)) list.push(u);
    });
  } else if (want === 'STAGE_OWNER') {
    var key = (extra && extra.stageKey) || (indent && indent.Current_Stage);
    var st  = stageByKey_(key);
    if (st && st.key === 'CONFIRM_REQUEST') {
      users.forEach(function (u) {
        if (indent && String(u.User_ID) === String(indent.Requester_ID)) list.push(u);
      });
    } else if (st) {
      // a step two teams share notifies both of them
      users.forEach(function (u) {
        if (roleOwnsStage_(u.Role, st) && sameSite(u)) list.push(u);
      });
    }
  } else {
    users.forEach(function (u) {
      if (String(u.Role).toUpperCase() === want && sameSite(u)) list.push(u);
    });
  }

  if (def.alsoAdmin) {
    users.forEach(function (u) {
      if (String(u.Role).toUpperCase() !== 'ADMIN') return;
      var already = false;
      list.forEach(function (x) { if (String(x.User_ID) === String(u.User_ID)) already = true; });
      if (!already) list.push(u);
    });
  }

  // never ping the person who just did the thing
  if (extra && extra.actorId) {
    list = list.filter(function (u) { return String(u.User_ID) !== String(extra.actorId); });
  }
  // only people who have linked the bot and have not muted it
  return list.filter(function (u) {
    return safeStr_(u.Telegram_Chat_ID) && String(u.Notify_Telegram).toUpperCase() !== 'FALSE';
  });
}

/* ================================================================== */
/*  The message                                                        */
/* ================================================================== */

function esc_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function notifyText_(eventKey, indent, extra, lang) {
  lang = lang || 'EN';
  var T = function (p) { return tr_(p, lang); };
  var def = NOTIFY_EVENTS[eventKey];
  var st  = indent ? stageByKey_(indent.Current_Stage) : null;
  var L = [];
  L.push('<b>' + def.icon + ' ' + esc_(T(def.title)) + '</b>');
  if (indent) {
    L.push('');
    L.push('<b>' + esc_(indent.Indent_ID) + '</b> · ' + esc_(indent.Part_Name) +
           (safeStr_(indent.Part_Number) ? ' (' + esc_(indent.Part_Number) + ')' : ''));
    L.push(T('Qty') + ': <b>' + esc_(indent.Quantity) + ' ' + esc_(indent.Unit || '') + '</b>' +
           ' · ' + esc_(siteLabel_(indent.Site, indent.Section)));
    L.push(T('Raised by') + ' ' + esc_(indent.Requested_By));
    if (safeStr_(indent.Priority) && String(indent.Priority).toUpperCase() !== 'NORMAL') {
      L.push(T('Priority') + ': <b>' + esc_(indent.Priority) + '</b>');
    }
    if (safeStr_(indent.Final_Vendor)) L.push(T('Vendor') + ': ' + esc_(indent.Final_Vendor));
    if (st) L.push(T('Now at step') + ' ' + st.no + '/10 — ' + esc_(T(st.name)));
  }
  if (def.line) { L.push(''); L.push(esc_(T(def.line))); }
  if (extra && extra.note) { L.push(''); L.push('<i>' + esc_(extra.note) + '</i>'); }
  if (extra && extra.overdueMins) {
    L.push('');
    L.push('⚠️ <b>' + fmtMins_(extra.overdueMins, lang) + ' ' + T('past its due time.') + '</b>');
  }
  return L.join('\n');
}

function fmtMins_(m, lang) {
  m = Math.max(0, Math.round(Number(m) || 0));
  if (m < 60) return m + ' ' + tr_('min', lang);
  var h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return h + 'h' + (r ? ' ' + r + 'm' : '');
  var d = Math.floor(h / 24);
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}

/* ================================================================== */
/*  The one entry point every workflow step calls                      */
/* ================================================================== */

/** Fire and forget. Never throws. */
function notify_(eventKey, indent, extra) {
  // Inside a write lock: send once the lock is released (see withLock_).
  if (_LOCK_DEPTH > 0) { _NOTIFY_Q.push([eventKey, indent, extra]); return 0; }
  try {
    if (!NOTIFY_EVENTS[eventKey]) return 0;
    if (!tgEnabled_()) return 0;
    if (!notifyEnabledFor_(eventKey)) return 0;

    var targets = notifyTargets_(eventKey, indent, extra);
    if (!targets.length) return 0;

    var url = appUrl_();

    // Everybody hears about it in their own language. One parallel batch per
    // language, not one round trip per person.
    var byLang = {};
    targets.forEach(function (u) {
      var l = langOf_(u);
      (byLang[l] = byLang[l] || []).push(u);
    });

    var sent = 0;
    var rows = [];
    Object.keys(byLang).forEach(function (lang) {
      var group = byLang[lang];
      var text  = notifyText_(eventKey, indent, extra, lang);
      var plain = text.replace(/<[^>]+>/g, '').slice(0, 400);
      var results = tgSendMany_(group.map(function (u) { return u.Telegram_Chat_ID; }),
                                text, url, lang);
      group.forEach(function (u, i) {
        var r = results[i] || { ok: false, error: 'no response' };
        if (r.ok) sent++;
        rows.push({
          Notification_ID: 'NTF-' + uuid_().slice(0, 8), Timestamp: now_(),
          Event: eventKey, Indent_ID: indent ? indent.Indent_ID : '',
          Channel: 'TELEGRAM', Recipient_ID: u.User_ID, Recipient_Name: u.Name,
          Target: safeStr_(u.Telegram_Chat_ID), Status: r.ok ? 'SENT' : 'FAILED',
          Error: r.ok ? '' : String(r.error).slice(0, 250), Message: plain
        });
      });
    });
    withLock_(function () { insertMany_(SH.NOTIFY, rows); });   // two senders must not pick the same row
    return sent;
  } catch (e) {
    try {
      insert_(SH.NOTIFY, {
        Notification_ID: 'NTF-' + uuid_().slice(0, 8), Timestamp: now_(), Event: eventKey,
        Indent_ID: indent ? indent.Indent_ID : '', Channel: 'TELEGRAM',
        Status: 'FAILED', Error: String(e && e.message ? e.message : e).slice(0, 250)
      });
    } catch (ignored) {}
    return 0;
  }
}

/* ================================================================== */
/*  Linking a person to the bot                                        */
/* ================================================================== */

/** Give the signed-in user a fresh one-time code and the link to tap. */
function telegramLink_(token) {
  var u = requireAuth_(token);
  var bot = tgBotUsername_();
  if (!bot) throw new Error('The administrator has not set the bot name yet.');
  var code = 'GG' + uuid_().replace(/-/g, '').slice(0, 10).toUpperCase();
  update_(SH.USERS, u.__row, {
    Telegram_Link_Code: code,
    Telegram_Code_Expires: addHours_(now_(), 24)
  });
  return {
    code: code,
    botUsername: bot,
    url: 'https://t.me/' + bot + '?start=' + code,
    expiresAt: iso_(addHours_(now_(), 24))
  };
}

function telegramStatus_(token) {
  var u = requireAuth_(token);
  var myLang = langOf_(u);
  // While somebody is sitting on the connect screen waiting, check Telegram
  // right now instead of making them wait for the five-minute trigger.
  if (!safeStr_(u.Telegram_Chat_ID) && safeStr_(u.Telegram_Link_Code)) {
    try { pollTelegram(); } catch (e) {}
    u = findBy_(SH.USERS, 'User_ID', u.User_ID) || u;
  }
  return {
    configured : !!tgBotUsername_() && !!tgToken_(),
    enabled    : tgEnabled_(),
    botUsername: tgBotUsername_(),
    linked     : !!safeStr_(u.Telegram_Chat_ID),
    handle     : safeStr_(u.Telegram_Username),
    linkedAt   : iso_(u.Telegram_Linked_At),
    muted      : String(u.Notify_Telegram).toUpperCase() === 'FALSE',
    language   : myLang
  };
}

function telegramUnlink_(token) {
  var u = requireAuth_(token);
  update_(SH.USERS, u.__row, {
    Telegram_Chat_ID: '', Telegram_Username: '', Telegram_Linked_At: '',
    Telegram_Link_Code: '', Telegram_Code_Expires: ''
  });
  return true;
}

function telegramMute_(token, muted) {
  var u = requireAuth_(token);
  update_(SH.USERS, u.__row, { Notify_Telegram: muted ? 'FALSE' : 'TRUE' });
  return { muted: !!muted };
}

function telegramTest_(token) {
  var u = requireAuth_(token);
  if (!safeStr_(u.Telegram_Chat_ID)) throw new Error('Connect Telegram first.');
  if (!tgToken_()) throw new Error('The administrator has not saved the bot token yet.');
  var l = langOf_(u);
  tgSend_(u.Telegram_Chat_ID,
    '<b>✅ ' + tr_('Test message', l) + '</b>\n\n' +
    tr_('Hello', l) + ' ' + esc_(u.Name) + ', ' + tr_('notifications are working.', l) + '\n' +
    tr_('You will get a message here whenever an indent needs you.', l),
    appUrl_(), tr_('Open in Indent Flow', l));
  return true;
}

/* ---------------- admin side ---------------- */

function telegramConfig_(token, p) {
  requireRole_(token, ['ADMIN']);
  var props = PropertiesService.getScriptProperties();
  if (p && p.botToken !== undefined && safeStr_(p.botToken)) {
    var t = safeStr_(p.botToken);
    if (!/^\d+:[A-Za-z0-9_\-]{20,}$/.test(t)) {
      throw new Error('That does not look like a bot token. BotFather gives you something like 7891234567:AAH…');
    }
    props.setProperty('TELEGRAM_BOT_TOKEN', t);
    // confirm the token really works, and learn the bot's handle
    var me = tgCall_('getMe', {});
    if (me && me.username) setSetting_('TELEGRAM_BOT_USERNAME', me.username, 'Your bot handle, without the @');
  }
  if (p && p.botUsername !== undefined && safeStr_(p.botUsername)) {
    setSetting_('TELEGRAM_BOT_USERNAME', safeStr_(p.botUsername).replace(/^@/, ''), '');
  }
  if (p && p.enabled !== undefined) {
    setSetting_('TELEGRAM_ENABLED', p.enabled ? 'TRUE' : 'FALSE', 'Send live Telegram notifications');
  }
  if (p && p.appUrl !== undefined && safeStr_(p.appUrl)) {
    setSetting_('APP_URL', safeStr_(p.appUrl), 'Web app /exec link');
  }
  if (p && p.events) {
    setSetting_('NOTIFY_EVENTS_JSON', JSON.stringify(p.events), 'Which notifications are switched on');
  }
  return telegramAdminState_(token);
}

/** Can this script talk to the internet at all? Cheap, and never throws. */
function tgReachable_() {
  try {
    UrlFetchApp.fetch('https://api.telegram.org', { muteHttpExceptions: true });
    return { ok: true, error: '' };
  } catch (e) {
    var m = String(e && e.message ? e.message : e);
    return { ok: false, error: /permission|scope|external_request|not sufficient/i.test(m)
                               ? TG_SCOPE_HELP : m };
  }
}

function telegramAdminState_(token) {
  requireRole_(token, ['ADMIN']);
  var reach = tgReachable_();
  var evs = {};
  try { evs = JSON.parse(getSetting_('NOTIFY_EVENTS_JSON') || '{}'); } catch (e) {}
  var users = readAll_(SH.USERS).filter(function (u) { return truthy_(u.Active); });
  return {
    hasToken   : !!tgToken_(),
    reachable  : reach.ok,
    reachError : reach.error,
    webhookSet : (function () {
                   if (!reach.ok) return false;
                   try { var i = tgCall_('getWebhookInfo', {}); return !!(i && i.url); }
                   catch (e) { return false; }
                 })(),
    botUsername: tgBotUsername_(),
    enabled    : truthy_(getSetting_('TELEGRAM_ENABLED')),
    appUrl     : appUrl_(),
    webhookUrl : appUrl_() ? (appUrl_() + '?tg=' + tgSecret_()) : '',
    manualReset: tgToken_()
                 ? (TG_API + tgToken_() + '/deleteWebhook?drop_pending_updates=true') : '',
    events     : Object.keys(NOTIFY_EVENTS).map(function (k) {
                   return { key: k, title: NOTIFY_EVENTS[k].title, to: NOTIFY_EVENTS[k].to,
                            icon: NOTIFY_EVENTS[k].icon, on: evs[k] !== false };
                 }),
    people     : users.map(function (u) {
                   return { id: u.User_ID, name: u.Name, role: u.Role,
                            linked: !!safeStr_(u.Telegram_Chat_ID),
                            handle: safeStr_(u.Telegram_Username),
                            muted: String(u.Notify_Telegram).toUpperCase() === 'FALSE' };
                 }),
    recent     : readAll_(SH.NOTIFY).slice(-40).reverse().map(function (n) {
                   return { at: iso_(n.Timestamp), event: n.Event, indentId: safeStr_(n.Indent_ID),
                            to: safeStr_(n.Recipient_Name), status: n.Status, error: safeStr_(n.Error) };
                 })
  };
}

/** Point the bot at this web app so linking is instant. Admin only. */
function telegramInstallWebhook_(token) {
  requireRole_(token, ['ADMIN']);
  var url = appUrl_();
  if (!url) throw new Error('Save the web app URL first (Settings ▸ APP_URL).');
  tgCall_('setWebhook', {
    url: url + '?tg=' + tgSecret_(),
    allowed_updates: ['message'],
    drop_pending_updates: true
  });
  return { webhook: url + '?tg=' + tgSecret_() };
}

function telegramRemoveWebhook_(token) {
  requireRole_(token, ['ADMIN']);
  tgCall_('deleteWebhook', { drop_pending_updates: false });
  return true;
}

/* ================================================================== */
/*  Receiving "/start CODE" from the bot                               */
/*                                                                     */
/*  Telegram redelivers an update whenever it does not get a clean 200 */
/*  back — and an Apps Script web app answers a POST with a 302, so it */
/*  redelivers for hours. Everything below is written to be idempotent:*/
/*  the same update handled twenty times must do exactly what it did   */
/*  the first time, and say nothing further.                           */
/* ================================================================== */

/** True the first time we see this update_id, false every time after. */
function tgSeen_(updateId) {
  if (updateId === undefined || updateId === null || updateId === '') return false;
  var key = 'tgu_' + updateId;
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return true;
    cache.put(key, '1', 21600);              // six hours is far longer than Telegram retries
  } catch (e) { /* cache unavailable — fall through to the durable list */ }

  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('TG_SEEN') || '';
  var ids = raw ? raw.split(',') : [];
  if (ids.indexOf(String(updateId)) !== -1) return true;
  ids.push(String(updateId));
  if (ids.length > 300) ids = ids.slice(ids.length - 300);
  props.setProperty('TG_SEEN', ids.join(','));
  return false;
}

/** One reply per chat per hour for the "something is wrong" messages, so a
 *  retry storm can never turn into a message storm. */
function tgMaySay_(chatId, kind) {
  var key = 'tgsay_' + kind + '_' + chatId;
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return false;
    cache.put(key, '1', 3600);
    return true;
  } catch (e) { return true; }
}

function tgUserByChat_(chatId) {
  var found = null;
  readAll_(SH.USERS).forEach(function (u) {
    if (!found && safeStr_(u.Telegram_Chat_ID) === String(chatId)) found = u;
  });
  return found;
}

/** Handle one Telegram update. Returns a short description of what happened. */
function tgHandleUpdate_(update) {
  var msg = update && update.message;
  if (!msg || !msg.chat) return 'ignored';
  if (tgSeen_(update.update_id)) return 'duplicate';

  var chatId = msg.chat.id;
  var text   = safeStr_(msg.text);
  var linked = tgUserByChat_(chatId);

  var m = text.match(/^\/start(?:\s+(\S+))?/i);
  if (!m) {
    if (tgMaySay_(chatId, 'help')) {
      trySend_(chatId, linked
        ? ('You are connected as <b>' + esc_(linked.Name) + '</b>. Nothing to do here — ' +
           'alerts will arrive by themselves.')
        : 'Open the app, go to <b>Notifications</b> and tap <b>Connect Telegram</b> to link this chat.');
    }
    return 'no-command';
  }
  var code = safeStr_(m[1]).toUpperCase();
  if (!code) {
    if (tgMaySay_(chatId, 'greet')) {
      trySend_(chatId, linked
        ? ('✅ Already connected as <b>' + esc_(linked.Name) + '</b>.')
        : ('👋 Welcome to <b>Indent Flow</b>.\n\nOpen the app, go to <b>Notifications</b>, ' +
           'and tap <b>Connect Telegram</b>. It will give you a link that connects this chat.'));
    }
    return linked ? 'already-linked' : 'no-code';
  }

  var user = null;
  readAll_(SH.USERS).forEach(function (u) {
    if (!user && safeStr_(u.Telegram_Link_Code).toUpperCase() === code) user = u;
  });

  if (!user) {
    // The overwhelmingly common case: this chat is ALREADY linked and the code
    // was burned when it worked the first time. Say something reassuring, once.
    if (linked) {
      if (tgMaySay_(chatId, 'already')) {
        trySend_(chatId, '✅ You are already connected as <b>' + esc_(linked.Name) + '</b>. ' +
                         'That code has already been used — nothing more to do.');
      }
      return 'already-linked';
    }
    if (tgMaySay_(chatId, 'badcode')) {
      trySend_(chatId, '❌ That code is not recognised. Open the app ▸ Notifications ▸ ' +
                       'Connect Telegram to get a fresh one.');
    }
    return 'bad-code';
  }
  var exp = toDate_(user.Telegram_Code_Expires);
  if (exp && exp.getTime() < Date.now()) {
    if (tgMaySay_(chatId, 'expired')) {
      trySend_(chatId, '⌛ That code has expired. Open the app and generate a fresh one.');
    }
    return 'expired';
  }
  if (!truthy_(user.Active)) {
    if (tgMaySay_(chatId, 'inactive')) {
      trySend_(chatId, '🚫 That account is deactivated. Speak to your administrator.');
    }
    return 'inactive';
  }
  // already linked to this very chat and the code is still live — no-op
  if (linked && String(linked.User_ID) === String(user.User_ID)) {
    update_(SH.USERS, user.__row, { Telegram_Link_Code: '', Telegram_Code_Expires: '' });
    return 'already-linked';
  }

  var ulang = langOf_(user);
  update_(SH.USERS, user.__row, {
    Telegram_Chat_ID: String(chatId),
    Telegram_Username: safeStr_(msg.from && msg.from.username),
    Telegram_Linked_At: now_(),
    Telegram_Link_Code: '', Telegram_Code_Expires: '',
    Notify_Telegram: 'TRUE'
  });
  trySend_(chatId, '✅ <b>' + tr_('Connected.', ulang) + '</b>\n\n' +
                   tr_('Hello', ulang) + ' ' + esc_(user.Name) + ' (' + esc_(user.Role) + ').\n' +
                   tr_('You will now get a message here the moment an indent needs you.', ulang),
                   appUrl_());
  return 'linked:' + user.User_ID;
}

function trySend_(chatId, html, url) {
  try { tgSend_(chatId, html, url); } catch (e) { /* the person may have blocked the bot */ }
}

/** Ask Telegram for anything new and deal with it. Safe to call often. */
function pollTelegram() {
  if (!tgToken_()) return 0;
  var props = PropertiesService.getScriptProperties();
  try {
    var info = tgCall_('getWebhookInfo', {});
    if (info && info.url) return 0;            // a webhook is doing the work already
  } catch (e) { return 0; }

  var offset = Number(props.getProperty('TELEGRAM_OFFSET') || 0);
  var updates;
  try {
    updates = tgCall_('getUpdates', { offset: offset, timeout: 0, limit: 50,
                                      allowed_updates: ['message'] });
  } catch (e) { return 0; }
  if (!updates || !updates.length) return 0;

  // Advance the offset FIRST. If handling throws we must never see these again.
  updates.forEach(function (u) { if (u.update_id >= offset) offset = u.update_id + 1; });
  props.setProperty('TELEGRAM_OFFSET', String(offset));

  var handled = 0;
  updates.forEach(function (u) {
    try { tgHandleUpdate_(u); handled++; } catch (e) {}
  });
  bumpIfDirty_();
  return handled;
}

/* ================================================================== */
/*  Panic button — stop a retry storm dead                             */
/* ================================================================== */

/** Drop every pending update, remove the webhook, forget the backlog.
 *  This is what stops a flood immediately. */
function tgResetConnection_(token) {
  requireRole_(token, ['ADMIN']);
  return tgResetConnectionCore_();
}

/** Runnable straight from the Apps Script editor, no sign-in needed. */
function tgResetConnection() { portalAssertEditor_(); return tgResetConnectionCore_(); }
function tgResetConnectionCore_() {
  var props = PropertiesService.getScriptProperties();
  var out = { webhookRemoved: false, dropped: 0 };
  try { tgCall_('deleteWebhook', { drop_pending_updates: true }); out.webhookRemoved = true; } catch (e) {}
  // drain whatever is still queued without acting on any of it
  for (var i = 0; i < 10; i++) {
    var batch;
    try { batch = tgCall_('getUpdates', { offset: -1, timeout: 0, limit: 100 }); } catch (e) { break; }
    if (!batch || !batch.length) break;
    var last = batch[batch.length - 1].update_id + 1;
    out.dropped += batch.length;
    props.setProperty('TELEGRAM_OFFSET', String(last));
    try { tgCall_('getUpdates', { offset: last, timeout: 0, limit: 1 }); } catch (e) {}
    if (batch.length < 100) break;
  }
  props.deleteProperty('TG_SEEN');
  return out;
}

/** Belt and braces: the same thing, named so it is obvious in the editor. */
function stopTelegramFlood() {
  portalAssertEditor_();
  var r = tgResetConnection();
  return 'Stopped. Webhook removed: ' + r.webhookRemoved + ', pending updates dropped: ' + r.dropped;
}

/* ================================================================== */
/*  Overdue nudges — the hourly sweep                                  */
/* ================================================================== */

function overdueSweep() {
  if (!tgEnabled_() || !notifyEnabledFor_('OVERDUE')) return 0;
  var gapMins = num_(getSetting_('OVERDUE_ALERT_EVERY_HOURS'), 12) * 60;
  var nowMs = Date.now();
  var sent = 0;

  readAll_(SH.INDENTS).forEach(function (ind) {
    if (isClosed_(ind.Status)) return;
    var planned = toDate_(ind.Stage_Planned_At);
    if (!planned || planned.getTime() >= nowMs) return;

    var last = toDate_(ind.Last_Alert_At);
    if (last && (nowMs - last.getTime()) / 60000 < gapMins) return;

    var over = Math.round((nowMs - planned.getTime()) / 60000);
    var n = notify_('OVERDUE', ind, { stageKey: ind.Current_Stage, overdueMins: over });
    if (n) { update_(SH.INDENTS, ind.__row, { Last_Alert_At: now_() }); sent += n; }
  });
  bumpIfDirty_();
  return sent;
}

/* ==================================================================
   Diagnostics — check every link in the chain and say, in plain
   words, which one is broken and exactly how to mend it.
   ================================================================== */

function tgDiagnose_(token) {
  requireRole_(token, ['ADMIN']);
  return tgDiagnoseCore_();
}

/** Also runnable straight from the Apps Script editor. */
function tgDiagnose() { portalAssertEditor_(); return tgDiagnoseCore_(); }
function tgDiagnoseCore_() {
  var checks = [];
  function add(label, ok, detail, fix) {
    checks.push({ label: label, ok: !!ok, detail: safeStr_(detail), fix: safeStr_(fix) });
  }

  /* 1 — is there a token at all? */
  var token = tgToken_();
  add('Bot token saved', !!token,
      token ? ('…' + token.slice(-6)) : 'nothing stored',
      token ? '' : 'Admin ▸ Notifications ▸ paste the token from @BotFather ▸ Save.');
  if (!token) return { checks: checks, pending: [], canLink: false };

  /* 2 — can this script reach the internet? */
  var reach = tgReachable_();
  add('Script may reach the internet', reach.ok,
      reach.ok ? 'UrlFetchApp works' : reach.error,
      reach.ok ? '' : TG_SCOPE_HELP);
  if (!reach.ok) return { checks: checks, pending: [], canLink: false };

  /* 3 — does Telegram accept the token? */
  var me = null, meErr = '';
  try { me = tgCall_('getMe', {}); } catch (e) { meErr = String(e.message || e); }
  add('Telegram accepts the token', !!me,
      me ? ('@' + me.username) : meErr,
      me ? '' : 'The token is wrong or has been revoked. Get a fresh one from @BotFather ' +
                '(/token or /revoke) and save it in Admin ▸ Notifications.');
  if (!me) return { checks: checks, pending: [], canLink: false };

  /* 4 — the bot handle the app hands out must match the real bot */
  var saved = tgBotUsername_();
  add('Bot handle matches', saved && saved.toLowerCase() === String(me.username).toLowerCase(),
      'app says @' + (saved || '—') + ', Telegram says @' + me.username,
      (saved && saved.toLowerCase() === String(me.username).toLowerCase()) ? ''
        : 'Press Save on the Notifications screen — it re-reads the handle from Telegram.');

  /* 5 — no webhook, so getUpdates is allowed to work */
  var hook = '';
  try { var wi = tgCall_('getWebhookInfo', {}); hook = safeStr_(wi && wi.url); } catch (e) {}
  add('No webhook in the way', !hook,
      hook ? ('webhook set to ' + hook) : 'none — the app polls, which is the reliable way',
      hook ? 'Press "Stop bot chatter / reset". While a webhook is set, Telegram refuses to hand ' +
             'messages to the app any other way, so linking cannot complete.' : '');

  /* 6 — is the whole feature switched on? */
  add('Notifications switched on', truthy_(getSetting_('TELEGRAM_ENABLED')),
      truthy_(getSetting_('TELEGRAM_ENABLED')) ? 'on' : 'off',
      truthy_(getSetting_('TELEGRAM_ENABLED')) ? '' : 'Tick "Send live notifications" and Save.');

  /* 7 — the button inside each message needs a real /exec link */
  var url = appUrl_();
  add('Web app link looks right', /\/exec\s*$/.test(url), url || 'not set',
      /\/exec\s*$/.test(url) ? '' : 'Paste the deployment URL ending in /exec into Web app URL.');

  /* 8 — is the safety-net trigger installed? */
  var handlers = [];
  try { handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); }
  catch (e) {}
  add('Background check installed', handlers.indexOf('pollTelegram') !== -1,
      handlers.length ? handlers.join(', ') : 'none found',
      handlers.indexOf('pollTelegram') !== -1 ? ''
        : 'Run installTriggers() once from the Apps Script editor.');

  /* 9 — what is actually waiting at Telegram right now? */
  var offset = Number(PropertiesService.getScriptProperties().getProperty('TELEGRAM_OFFSET') || 0);
  var pending = [];
  if (!hook) {
    try {
      // peek WITHOUT consuming: no offset means "give me the current queue"
      var ups = tgCall_('getUpdates', { timeout: 0, limit: 20, allowed_updates: ['message'] });
      pending = (ups || []).map(function (u) {
        var msg = u.message || {};
        return { updateId: u.update_id, chatId: msg.chat ? msg.chat.id : '',
                 from: safeStr_(msg.from && (msg.from.username || msg.from.first_name)),
                 text: safeStr_(msg.text).slice(0, 60),
                 alreadyPast: u.update_id < offset };
      });
    } catch (e) {}
  }
  var stale = pending.filter(function (p) { return p.alreadyPast; }).length;
  add('Messages reaching Telegram', true,
      pending.length ? (pending.length + ' waiting' + (stale ? ', ' + stale + ' already processed' : ''))
                     : 'nothing queued right now', '');
  if (stale && stale === pending.length && pending.length) {
    add('Read position', false,
        'the app thinks it is past every queued message (offset ' + offset + ')',
        'Press "Re-read from the start" to rewind, then tap Start in Telegram again.');
  }

  /* 10 — who is connected */
  var users = readAll_(SH.USERS).filter(function (u) { return truthy_(u.Active); });
  var linked = users.filter(function (u) { return safeStr_(u.Telegram_Chat_ID); });
  add('People connected', true, linked.length + ' of ' + users.length, '');

  return {
    checks: checks,
    pending: pending,
    offset: offset,
    canLink: checks.every(function (c) { return c.ok; })
  };
}

/** Check Telegram this very second — the "it is not linking" button. */
function telegramForcePoll_(token) {
  var u = requireAuth_(token);
  var handled = 0, err = '';
  try { handled = pollTelegram(); } catch (e) { err = String(e.message || e); }
  var fresh = findBy_(SH.USERS, 'User_ID', u.User_ID) || u;
  return { handled: handled, linked: !!safeStr_(fresh.Telegram_Chat_ID), error: err };
}

/** Rewind so queued messages are read again. Admin only — used when the read
 *  position has run ahead of the queue and a /start is stuck behind it. */
function tgRewind_(token) {
  requireRole_(token, ['ADMIN']);
  PropertiesService.getScriptProperties().deleteProperty('TELEGRAM_OFFSET');
  PropertiesService.getScriptProperties().deleteProperty('TG_SEEN');
  var handled = 0;
  try { handled = pollTelegram(); } catch (e) {}
  return { handled: handled };
}
