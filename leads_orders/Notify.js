/*******************************************************
 * Notify.js — Telegram: personal reminders, date alerts and late-step alerts.
 *
 *   Bot        Settings → Telegram: the Admin pastes the token from @BotFather. It is kept in
 *              Script Properties (TG_TOKEN), never in a sheet, and never sent to a page.
 *   Linking    Reminders page → Connect Telegram → a one-time t.me link → "Start" in the bot.
 *              The bot is read with getUpdates (no webhook), by notifyTick and whenever the page asks.
 *   notifyTick every 5 minutes:
 *              · personal reminders that are due (once / daily / working days / weekly)
 *              · date alerts   (Admin: "when SAMPLING › ETA has a date → tell the owner on that date at 10:00")
 *              · late alerts   (Admin: per step — the responsible people when a tile turns late)
 *              · daily digest  (Admin: each person's late tiles, once a day)
 *   Every message has a key in "Notify Log", so nothing is sent twice.
 *******************************************************/

var TG_API = 'https://api.telegram.org/bot';

function tgProps_() { return PropertiesService.getScriptProperties(); }
function tgToken_() { return tgProps_().getProperty('TG_TOKEN') || ''; }
function tgBot_() { return tgProps_().getProperty('TG_BOT') || ''; }

function tgApi_(method, payload) {
  var t = tgToken_();
  if (!t) throw new Error('Telegram is not set up yet (Settings → Telegram).');
  var r = UrlFetchApp.fetch(TG_API + t + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true
  });
  var j = safeJson_(r.getContentText()) || {};
  if (!j.ok) throw new Error('Telegram: ' + (j.description || ('HTTP ' + r.getResponseCode())));
  return j.result;
}
function tgSend_(chatId, html) {
  return tgApi_('sendMessage', { chat_id: chatId, text: String(html).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true });
}
function h_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ---------------------------------------------------------------- linked people */

/** { usernameLower: { chat, tg, at, row } } */
function tgChats_() {
  if (MEMO_.tgChats) return MEMO_.tgChats;
  var out = {};
  rows_(TABS.TELEGRAM).forEach(function (r, i) {
    var u = String(r[0]).trim().toLowerCase(), chat = String(r[2]).trim();
    if (u && chat) out[u] = { chat: chat, tg: String(r[3] || ''), at: msOf_(r[4]), row: i + 2 };
  });
  return (MEMO_.tgChats = out);
}
function userByChat_(chatId) {
  var m = tgChats_(), id = String(chatId);
  for (var u in m) if (m[u].chat === id) return u;
  return '';
}
function linkChat_(username, chatId, tgName) {
  var sh = tab_(TABS.TELEGRAM), rows = rows_(TABS.TELEGRAM), u = String(username).toLowerCase(), user = ggmRows_()[u] || { username: username, name: username };
  var row = [user.username, user.name, String(chatId), tgName || '', new Date()];
  for (var i = 0; i < rows.length; i++) {
    var ru = String(rows[i][0]).trim().toLowerCase();
    if (ru === u) { sh.getRange(i + 2, 1, 1, 5).setValues([row]); MEMO_.tgChats = null; MEMO_['rows_' + TABS.TELEGRAM.name] = null; return; }
  }
  append_(TABS.TELEGRAM, row);
  MEMO_.tgChats = null;
}
function unlinkUser_(username) {
  var c = tgChats_()[String(username).toLowerCase()];
  if (!c) return;
  tab_(TABS.TELEGRAM).getRange(c.row, 3, 1, 3).setValues([['', '', '']]);
  MEMO_.tgChats = null; MEMO_['rows_' + TABS.TELEGRAM.name] = null;
}
function tgName_(from) {
  if (!from) return '';
  return [from.first_name, from.last_name].filter(String).join(' ') + (from.username ? ' (@' + from.username + ')' : '');
}

/** Reads what people sent the bot: "/start <code>" links a person; /list and /stop work after that. */
function tgPoll_() {
  if (!tgToken_() || cache_().get('tg_polling')) return 0;
  cache_().put('tg_polling', '1', 25);
  try {
    var p = tgProps_(), off = Number(p.getProperty('TG_OFFSET') || 0), n = 0;
    var ups = tgApi_('getUpdates', off ? { offset: off, timeout: 0, allowed_updates: ['message'] } : { timeout: 0, allowed_updates: ['message'] });
    ups.forEach(function (up) {
      off = Math.max(off, up.update_id + 1);
      var m = up.message;
      if (!m || !m.chat || m.chat.type !== 'private') return;
      var txt = String(m.text || '').trim(), st = /^\/start(?:\s+(\S+))?/.exec(txt), who = userByChat_(m.chat.id);
      try {
        if (st && st[1]) {
          var un = cache_().get('tglink_' + st[1]);
          if (!un) { tgSend_(m.chat.id, 'This link has expired. Open Leads &amp; Orders → <b>Reminders</b> → <b>Connect Telegram</b> again.'); return; }
          cache_().remove('tglink_' + st[1]);
          linkChat_(un, m.chat.id, tgName_(m.from));
          var u = ggmRows_()[un.toLowerCase()] || { name: un };
          tgSend_(m.chat.id, '✅ Connected: <b>' + h_(u.name) + '</b>\nYour reminders and alerts from Leads &amp; Orders will come here.\n\n/list — your next reminders');
          n++;
          return;
        }
        if (/^\/stop\b/.test(txt) && who) { tgSend_(m.chat.id, 'Messages from Leads &amp; Orders cannot be switched off.'); return; }   // Admin decision: nobody stops them
        if (/^\/list\b/.test(txt) && who) { tgSend_(m.chat.id, upcomingText_(who)); return; }
        tgSend_(m.chat.id, who ? 'I send your reminders and alerts from Leads &amp; Orders.\n/list — your next reminders'
          : 'To connect, open Leads &amp; Orders → <b>Reminders</b> → <b>Connect Telegram</b>.');
      } catch (e) { Logger.log('tg reply: ' + e); }
    });
    if (ups.length) p.setProperty('TG_OFFSET', String(off));
    return n;
  } finally { cache_().remove('tg_polling'); }
}

/* ---------------------------------------------------------------- page: my Telegram + reminders */

function tgStatus_(me) {
  var c = tgChats_()[String(me.username).toLowerCase()];
  return { ready: !!tgToken_(), bot: tgBot_(), linked: !!c, tg: c ? c.tg : '', at: c ? c.at : null };
}

/** The Reminders page: my link state + my reminders. poll = also read the bot now (after "Start" in Telegram). */
function myReminders(token, poll) {
  var me = staff_(token);
  if (poll) { try { tgPoll_(); } catch (e) { Logger.log('poll: ' + e); } MEMO_.tgChats = null; MEMO_['rows_' + TABS.TELEGRAM.name] = null; }
  return { tg: tgStatus_(me), list: remList_(me.username) };
}

function tgLinkStart(token) {
  var me = staff_(token), bot = tgBot_();
  if (!bot || !tgToken_()) throw new Error('Telegram is not set up yet. Ask the Admin (Settings → Telegram).');
  var code = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  cache_().put('tglink_' + code, me.username, 1800);
  return { url: 'https://t.me/' + bot + '?start=' + code, bot: bot };
}
function tgTest(token) {
  var me = staff_(token), c = tgChats_()[me.username.toLowerCase()];
  if (!c) throw new Error('Connect Telegram first.');
  tgSend_(c.chat, '👋 Test from Leads &amp; Orders — this is where your reminders and alerts will arrive.');
  return { ok: true, msg: 'Test message sent to your Telegram.' };
}

var REPEATS = { '': 'Once', daily: 'Every day', workdays: 'Every working day', weekly: 'Every week' };

/** [{ id, text, when, repeat, fid, lead, title, status, last }] of one person, newest first. */
function remList_(username) {
  var u = String(username).toLowerCase(), out = [];
  rows_(TABS.REMINDERS).forEach(function (r) {
    if (String(r[1]).trim().toLowerCase() !== u || r[8] === 'deleted') return;
    var fid = String(r[6] || ''), id = String(r[7] || ''), title = '';
    if (fid && id && FLOWS[fid]) { try { var l = findBoardLead_(fid, id); title = l ? leadTitle_(fid, l) : ''; } catch (e) {} }
    out.push({ id: String(r[0]), text: String(r[3]), when: msOf_(r[4]), repeat: String(r[5] || ''), fid: fid, lead: id, title: title,
               status: String(r[8] || 'open'), last: msOf_(r[10]) });
  });
  return out.sort(function (a, b) { return (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.status === 'open' ? a.when - b.when : b.when - a.when); });
}

/** r = { id?, text, when: 'yyyy-MM-ddTHH:mm' (India time), repeat, fid?, lead? } */
function saveReminder(token, r) {
  var me = staff_(token);
  r = r || {};
  var text = String(r.text || '').trim().slice(0, 600);
  if (text.length < 2) throw new Error('Write what to do.');
  var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(r.when || ''));
  if (!m) throw new Error('Pick the date and time.');
  var when = new Date(m[1] + 'T' + m[2] + ':' + m[3] + ':00+05:30');
  var repeat = REPEATS[r.repeat] != null ? String(r.repeat || '') : '';
  if (!repeat && when.getTime() < Date.now() - 60000) throw new Error('That time has already passed.');
  var fid = FLOWS[r.fid] ? r.fid : '', lead = fid ? String(r.lead || '').trim() : '';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = tab_(TABS.REMINDERS), rows = rows_(TABS.REMINDERS);
    if (r.id) {
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) !== String(r.id)) continue;
        if (String(rows[i][1]).toLowerCase() !== me.username.toLowerCase()) throw new Error('That is not your reminder.');
        sh.getRange(i + 2, 4, 1, 6).setValues([[text, when, repeat, fid, lead, 'open']]);
        MEMO_['rows_' + TABS.REMINDERS.name] = null;
        return { ok: true, msg: 'Reminder updated.', list: remList_(me.username) };
      }
      throw new Error('Reminder not found.');
    }
    var id = 'R' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    append_(TABS.REMINDERS, [id, me.username, me.name, text, when, repeat, fid, lead, 'open', new Date(), '']);
  } finally { lock.releaseLock(); }
  var linked = !!tgChats_()[me.username.toLowerCase()];
  return { ok: true, msg: linked ? 'Reminder set — it will come on Telegram.' : 'Reminder saved. Connect Telegram to receive it.', list: remList_(me.username) };
}

/** A reminder written by the app itself (e.g. "Asked to call later" on Log call). */
function addReminder_(me, text, when, repeat, fid, lead) {
  var id = 'R' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  append_(TABS.REMINDERS, [id, me.username, me.name, String(text).slice(0, 600), when, repeat || '', fid || '', lead || '', 'open', new Date(), '']);
  return id;
}

function deleteReminder(token, id) {
  var me = staff_(token), sh = tab_(TABS.REMINDERS), rows = rows_(TABS.REMINDERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(id)) continue;
    if (String(rows[i][1]).toLowerCase() !== me.username.toLowerCase()) throw new Error('That is not your reminder.');
    sh.getRange(i + 2, 9).setValue('deleted');
    MEMO_['rows_' + TABS.REMINDERS.name] = null;
    return { ok: true, msg: 'Reminder deleted.', list: remList_(me.username) };
  }
  throw new Error('Reminder not found.');
}

function upcomingText_(username) {
  var list = remList_(username).filter(function (r) { return r.status === 'open'; }).slice(0, 10);
  if (!list.length) return 'No reminders set. Add one in Leads &amp; Orders → <b>Reminders</b>.';
  return '<b>Your next reminders</b>\n' + list.map(function (r) {
    return '• ' + fmtWhen_(r.when) + (r.repeat ? ' (' + REPEATS[r.repeat].toLowerCase() + ')' : '') + ' — ' + h_(r.text) + (r.lead ? ' · ' + h_(r.lead) : '');
  }).join('\n');
}

/* ---------------------------------------------------------------- Admin: bot + rules */

function tgAdmin_() {
  var chats = tgChats_();
  return {
    ready: !!tgToken_(), bot: tgBot_(),
    people: userList_().filter(function (u) { return !GEN_FLOW[u.r]; }).map(function (u) {
      var c = chats[u.u.toLowerCase()];
      return { u: u.u, n: u.n, r: u.r, linked: !!c, tg: c ? c.tg : '', at: c ? c.at : null };
    }),
    dateAlerts: dateAlerts_(), lateAlerts: lateAlerts_(), digest: digestCfg_()
  };
}
function tgAdminData(token) { var me = staff_(token); mustAdmin_(me); return tgAdmin_(); }

/** The Admin pastes the bot token (from @BotFather). It is checked with Telegram, then kept in Script Properties. */
function tgSetToken(token, botToken) {
  var me = staff_(token);
  mustAdmin_(me);
  var tok = String(botToken || '').trim(), p = tgProps_();
  if (!tok) { p.deleteProperty('TG_TOKEN'); p.deleteProperty('TG_BOT'); p.deleteProperty('TG_OFFSET'); logEvent_(me, '', '', '', 'SETTINGS', 'telegram bot removed'); return tgAdmin_(); }
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(tok)) throw new Error('That does not look like a bot token. It looks like 123456789:AAH… (from @BotFather).');
  var old = p.getProperty('TG_TOKEN'), bot;
  p.setProperty('TG_TOKEN', tok);
  try {
    bot = tgApi_('getMe');
    tgApi_('deleteWebhook', { drop_pending_updates: false });
  } catch (e) {
    if (old) p.setProperty('TG_TOKEN', old); else p.deleteProperty('TG_TOKEN');
    throw new Error(/external_request|UrlFetch|permission/i.test(String(e)) ? 'The app may not reach Telegram yet: the sheet owner opens the app sheet → Leads & Orders → Set up / repair once and allows "connect to an external service".' : String(e.message || e));
  }
  p.setProperty('TG_BOT', bot.username);
  if (old !== tok) p.deleteProperty('TG_OFFSET');
  installNotifyTrigger_();
  logEvent_(me, '', '', '', 'SETTINGS', 'telegram bot @' + bot.username);
  return tgAdmin_();
}

/**
 * Date alerts: [{ id, fid, ref: 'SAMPLING:ETA', to: ['owner' | 'step:KEY' | 'u:username'], at: '10:00', before: 0,
 *                 show: [refs], note, off }]
 */
function dateAlerts_() { var v = settings_().dateAlerts; return Array.isArray(v) ? v : []; }
/** Late alerts: { fid: { KEY: { on, extra: [usernames] } } } */
function lateAlerts_() { var v = settings_().lateAlerts; return v && typeof v === 'object' ? v : {}; }
/** Daily digest of late tiles: { on, at: '10:30' } */
function digestCfg_() { var v = settings_().lateDigest; return v && typeof v === 'object' ? v : { on: false, at: '10:30' }; }

function tgSaveRules(token, patch) {
  var me = staff_(token);
  mustAdmin_(me);
  patch = patch || {};
  var hm = function (s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '')) ? String(s) : '10:00'; };
  if (patch.dateAlerts) {
    var clean = patch.dateAlerts.slice(0, 40).map(function (r, i) {
      checkFlow_(r.fid);
      var lay = layout_(r.fid);
      if (!fieldOf_(lay, String(r.ref || ''))) throw new Error('Date alert ' + (i + 1) + ': pick the date field.');
      var to = (r.to || []).map(String).filter(function (x) { return /^(owner|step:[A-Z0-9_]+|u:.+)$/.test(x); });
      if (!to.length) throw new Error('Date alert ' + (i + 1) + ': pick who gets it.');
      return { id: String(r.id || ('D' + Date.now().toString(36) + i)), fid: r.fid, ref: String(r.ref), to: to, at: hm(r.at),
               before: Math.max(0, Math.min(30, Math.round(Number(r.before) || 0))), show: (r.show || []).map(String).slice(0, 12),
               note: String(r.note || '').slice(0, 300), off: !!r.off, since: Number(r.since) || Date.now() };
    });
    setSetting_('dateAlerts', clean, me.username);
  }
  if (patch.lateAlerts) {
    var la = {}, old = lateAlerts_();
    Object.keys(patch.lateAlerts).forEach(function (fid) {
      checkFlow_(fid);
      la[fid] = {};
      Object.keys(patch.lateAlerts[fid] || {}).forEach(function (k) {
        var x = patch.lateAlerts[fid][k] || {};
        if (!x.on) return;
        var prev = (old[fid] || {})[k];
        la[fid][k] = { on: true, extra: (x.extra || []).map(String).slice(0, 10), since: prev && prev.on ? prev.since : Date.now() };
      });
    });
    setSetting_('lateAlerts', la, me.username);
  }
  if (patch.digest) setSetting_('lateDigest', { on: !!patch.digest.on, at: hm(patch.digest.at) }, me.username);
  if (tgToken_()) installNotifyTrigger_();
  logEvent_(me, '', '', '', 'SETTINGS', 'telegram alerts');
  return tgAdmin_();
}

function installNotifyTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'notifyTick'; });
  if (!has) ScriptApp.newTrigger('notifyTick').timeBased().everyMinutes(5).create();
}

/* ---------------------------------------------------------------- the 5-minute job */

function notifyTick() {
  if (!tgToken_()) return;
  try { tgPoll_(); } catch (e) { Logger.log('poll: ' + e); }
  var now = Date.now(), sent = sentKeys_(), out = [];
  try { out = out.concat(remindersDue_(now)); } catch (e) { Logger.log('reminders: ' + e); }
  try { out = out.concat(dateAlertsDue_(now, sent)); } catch (e) { Logger.log('date alerts: ' + e); }
  try { out = out.concat(lateAlertsDue_(now, sent)); } catch (e) { Logger.log('late alerts: ' + e); }
  try { out = out.concat(digestDue_(now, sent)); } catch (e) { Logger.log('digest: ' + e); }
  deliver_(out);
  trimLog_();
}

/** Keys of everything sent in the last ~4000 log lines. */
function sentKeys_() {
  var sh = tab_(TABS.NOTIFY_LOG), n = sh.getLastRow() - 1, out = {};
  if (n <= 0) return out;
  var from = Math.max(0, n - 4000);
  sh.getRange(2 + from, 4, n - from, 1).getValues().forEach(function (r) { if (r[0]) out[String(r[0])] = 1; });
  return out;
}
function trimLog_() {
  var sh = tab_(TABS.NOTIFY_LOG), n = sh.getLastRow() - 1;
  if (n > 20000) sh.deleteRows(2, n - 15000);
}

/** items: [{ u: usernameLower, kind, key, text }] → Telegram (in batches), one log line each. */
function deliver_(items) {
  if (!items.length) return;
  var chats = tgChats_(), tok = tgToken_(), logRows = [], reqs = [], idx = [];
  items.forEach(function (it, i) {
    var c = chats[String(it.u).toLowerCase()];
    if (!c) { logRows[i] = [new Date(), it.u, it.kind, it.key, String(it.text).slice(0, 400), 'not connected']; return; }
    reqs.push({ url: TG_API + tok + '/sendMessage', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
                payload: JSON.stringify({ chat_id: c.chat, text: String(it.text).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }) });
    idx.push(i);
  });
  for (var s = 0; s < reqs.length; s += 25) {
    var res = [];
    try { res = UrlFetchApp.fetchAll(reqs.slice(s, s + 25)); } catch (e) { res = []; Logger.log('send: ' + e); }
    idx.slice(s, s + 25).forEach(function (i, j) {
      var r = res[j], j2 = r ? safeJson_(r.getContentText()) || {} : {}, it = items[i];
      logRows[i] = [new Date(), it.u, it.kind, it.key, String(it.text).slice(0, 400), j2.ok ? 'sent' : 'failed: ' + (j2.description || 'no answer')];
      if (!j2.ok && /blocked|chat not found|deactivated/i.test(j2.description || '')) { try { unlinkUser_(it.u); } catch (e) {} }
    });
  }
  var rows = logRows.filter(Boolean);
  if (rows.length) { var sh = tab_(TABS.NOTIFY_LOG); sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows); }
}

/* ---- personal reminders */
function remindersDue_(now) {
  var sh = tab_(TABS.REMINDERS), rows = rows_(TABS.REMINDERS), cal = layout_('L2O').cal, out = [];
  rows.forEach(function (r, i) {
    var when = msOf_(r[4]);
    if (String(r[8] || 'open') !== 'open' || !when || when > now) return;
    var u = String(r[1]).trim().toLowerCase(), fid = String(r[6] || ''), id = String(r[7] || ''), lead = '';
    if (FLOWS[fid] && id) { var l = findBoardLead_(fid, id); if (l) lead = '\n' + leadLine_(fid, l); else lead = '\n' + h_(id); }
    out.push({ u: u, kind: 'reminder', key: 'rem|' + r[0] + '|' + when,
               text: '⏰ <b>Reminder</b>' + (now - when > 3600000 ? ' (was due ' + fmtWhen_(when) + ')' : '') + '\n' + h_(r[3]) + lead + appLink_() });
    var rep = String(r[5] || ''), next = null;
    if (rep) { next = when; var guard = 0; while (next <= now && guard++ < 800) next = nextWhen_(next, rep, cal); }
    if (next) sh.getRange(i + 2, 5).setValue(new Date(next));           // repeating: moves to its next time
    sh.getRange(i + 2, 9).setValue(next ? 'open' : 'sent');
    sh.getRange(i + 2, 11).setValue(new Date());
  });
  MEMO_['rows_' + TABS.REMINDERS.name] = null;
  return out;
}
function nextWhen_(ms, rep, cal) {
  if (rep === 'daily') return ms + W_D;
  if (rep === 'weekly') return ms + 7 * W_D;
  if (rep === 'workdays') { var d = wDay(ms), nd = wNext(d, 1, cal); return ms + (nd - d) * W_D; }
  return null;
}

/* ---- date alerts */
function dateAlertsDue_(now, sent) {
  var out = [], users = allUsers_();
  dateAlerts_().forEach(function (r) {
    if (r.off || !FLOWS[r.fid]) return;
    var fid = r.fid, hm = hmMs_(r.at), lay = layout_(fid), fl = fieldOf_(lay, r.ref);
    if (!fl) return;
    boardData_(fid).leads.forEach(function (l) {
      if (l.closed || l.slim) return;
      var v = msOf_(refVal_(l, r.ref));
      if (!v) return;
      var at = (wDay(v) - (Number(r.before) || 0)) * W_D - W_OFF + hm;
      if (now < at || now - at > 36 * W_H) return;                 // its moment came in the last 36 hours
      var key = 'date|' + r.id + '|' + fid + '|' + l.id + '|' + isoOf_(v);
      var when = r.before ? (r.before === 1 ? 'tomorrow' : 'in ' + r.before + ' days') : 'today';
      var text = '📅 <b>' + h_(fieldLabel_(r.ref)) + '</b> is ' + when + ' (' + fmtDay_(v) + ')\n' + leadLine_(fid, l) +
        showLines_(fid, l, r.show) + (r.note ? '\n📝 ' + h_(r.note) : '') + appLink_();
      recipients_(fid, l, r.to, users).forEach(function (u) {
        var k = key + '|' + u;
        if (!sent[k]) out.push({ u: u, kind: 'date', key: k, text: text });
      });
    });
  });
  return out;
}

/* ---- late alerts: when a tile turns late at a watched step */
function lateAlertsDue_(now, sent) {
  var cfg = lateAlerts_(), out = [], users = allUsers_();
  FLOW_IDS.forEach(function (fid) {
    var steps = cfg[fid] || {};
    if (!Object.keys(steps).length) return;
    var lay = layout_(fid);
    boardData_(fid).leads.forEach(function (l) {
      if (l.closed) return;
      (l.cur ? [l.cur] : []).concat(l.side || []).forEach(function (k) {
        var c = steps[k], x = (l.s || {})[k] || {};
        if (!c || !c.on || !x.p || x.p > now) return;
        if (x.p < (c.since || 0) || now - x.p > 3 * W_D) return;   // only tiles that turned late after the alert was switched on (and recently)
        var st = stepByKey_(lay, k), key = 'late|' + fid + '|' + l.id + '|' + k + '|' + x.p;
        var text = '🔴 <b>Late:</b> ' + h_(stepLabel_(fid, k)) + '\n' + leadLine_(fid, l) + '\nDeadline was ' + fmtWhen_(x.p) +
          ' · late by ' + fmtDur(now - x.p) + (st && st.how ? '\nHow: ' + h_(st.how) : '') + appLink_();
        var to = responsible_(fid, l, k, users).concat((c.extra || []).map(function (u) { return String(u).toLowerCase(); }));
        uniq_(to).forEach(function (u) {
          var kk = key + '|' + u;
          if (!sent[kk]) out.push({ u: u, kind: 'late', key: kk, text: text });
        });
      });
    });
  });
  return out;
}

/* ---- daily digest of late tiles (one message per person) */
function digestDue_(now, sent) {
  var d = digestCfg_(), cal = layout_('L2O').cal, today = wDay(now);
  if (!d.on || !wIsWork(today, cal)) return [];
  var at = today * W_D - W_OFF + hmMs_(d.at);
  if (now < at || now - at > 6 * W_H) return [];
  var per = {}, users = allUsers_();
  FLOW_IDS.forEach(function (fid) {
    boardData_(fid).leads.forEach(function (l) {
      if (l.closed) return;
      (l.cur ? [l.cur] : []).concat(l.side || []).forEach(function (k) {
        var x = (l.s || {})[k] || {};
        if (!x.p || x.p > now) return;
        responsible_(fid, l, k, users).forEach(function (u) { (per[u] = per[u] || []).push({ fid: fid, l: l, k: k, p: x.p }); });
      });
    });
  });
  var out = [], iso = isoOf_(now);
  Object.keys(per).forEach(function (u) {
    var key = 'digest|' + iso + '|' + u;
    if (sent[key]) return;
    var list = per[u].sort(function (a, b) { return a.p - b.p; });
    out.push({ u: u, kind: 'digest', key: key, text: '🗓 <b>Late today: ' + list.length + ' tile' + (list.length === 1 ? '' : 's') + '</b>\n' +
      list.slice(0, 25).map(function (t) { return '• ' + h_(t.l.id) + ' ' + h_(leadTitle_(t.fid, t.l)) + ' — ' + h_(stepLabel_(t.fid, t.k)) + ' · ' + fmtDur(now - t.p) + ' late'; }).join('\n') +
      (list.length > 25 ? '\n… and ' + (list.length - 25) + ' more' : '') + appLink_() });
  });
  return out;
}

/* ---------------------------------------------------------------- helpers */

function allUsers_() { var rows = ggmRows_(); return Object.keys(rows).map(function (k) { return rows[k]; }); }
function uniq_(a) { var m = {}; return a.filter(function (x) { x = String(x).toLowerCase(); if (!x || m[x]) return false; m[x] = 1; return true; }); }

/** 'owner' · 'step:KEY' (who answers that step) · 'u:username' → usernames (lower case). */
function recipients_(fid, l, to, users) {
  var out = [];
  (to || []).forEach(function (t) {
    if (t === 'owner') users.forEach(function (u) { if (isOwner_(u, l)) out.push(u.username); });
    else if (t.indexOf('step:') === 0) out = out.concat(responsible_(fid, l, t.slice(5), users));
    else if (t.indexOf('u:') === 0) out.push(t.slice(2));
  });
  return uniq_(out).map(function (x) { return String(x).toLowerCase(); });
}

function findBoardLead_(fid, id) {
  var a = boardData_(fid).leads;
  for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
  return null;
}
function leadTitle_(fid, l) {
  var t = '';
  FLOWS[fid].titles.forEach(function (h) { if (!t) t = String(pick_(l.b, h) || '').trim(); });
  return t || '(no name)';
}
function stepLabel_(fid, k) { var c = stepCfg_(fid)[k]; return (c && c.label) || k; }
function leadLine_(fid, l) {
  return '<b>' + h_(l.id) + ' · ' + h_(leadTitle_(fid, l)) + '</b>\n' + h_(FLOWS[fid].title) +
    (l.closed ? ' · closed' : l.cur ? ' · now at: ' + h_(stepLabel_(fid, l.cur)) : '') + (l.owner ? ' · ' + h_(l.owner) : '');
}
function showLines_(fid, l, refs) {
  var lay = layout_(fid);
  return (refs || []).map(function (ref) {
    var v = refVal_(l, ref), fl = fieldOf_(lay, ref);
    if (v === '' || v == null) return '';
    if (fl && (fl.t === 'date' || fl.t === 'datetime') && typeof v === 'number') v = fmtDay_(v);
    return '\n' + h_(fieldLabel_(ref)) + ': <b>' + h_(v) + '</b>';
  }).join('');
}
function fieldLabel_(ref) {
  var h = ref.slice(ref.indexOf(':') + 1), k = String(h).trim().replace(/\s+/g, ' ');
  var map = { 'Prev. Dt.': 'Ready by', 'EST. DEL. Dt.': 'Est. delivery', 'DISPATCH DATE': 'Sample sent', 'ETA': 'ETA', 'ETD': 'ETD', 'EDD': 'EDD',
              'Act. Date': 'Dispatched', 'Mines/Factory': 'Mine', 'Mat. Gr.': 'Material', 'QTY.': 'Qty', 'PARTY NAME': 'Party',
              'Contact Details': 'Phone', 'PRODUCT NAME': 'Product', 'QUANTITY': 'Qty', 'COUNTRY / CITY': 'Place', 'CONTACT PERSON': 'Contact',
              'TPT. NAME': 'Transporter', 'VEH.': 'Vehicle', 'WT.': 'Weight', 'MOB.': 'Driver mob.', 'Company Name': 'Company' };
  if (map[k]) return map[k];
  return /[a-z]/.test(k) || k.length < 4 ? k : k.charAt(0) + k.slice(1).toLowerCase();
}
function hmMs_(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (Number(m[1]) * 60 + Number(m[2])) * 60000 : 10 * W_H; }
function fmtDay_(ms) { return Utilities.formatDate(new Date(ms), 'Asia/Kolkata', 'EEE d MMM'); }
function fmtWhen_(ms) { return Utilities.formatDate(new Date(ms), 'Asia/Kolkata', 'EEE d MMM, h:mm a'); }
function appLink_() { return GGM_APP.hub ? '\n\n<a href="' + h_(GGM_APP.hub) + '">Open Leads &amp; Orders</a>' : ''; }
