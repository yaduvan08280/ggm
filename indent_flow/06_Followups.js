/**********************************************************************
 * File: 06_Followups.gs  —  Process-Coordinator follow-up log and the
 *                           phone-notification reminder engine.
 *
 *  Reminder delivery (as chosen):
 *    1. A Google Calendar event is created and the PC is invited as a
 *       guest, with popup alerts.  Her phone's Google Calendar app then
 *       raises a real notification-panel alert carrying the note.
 *    2. A 5-minute time trigger also e-mails her at the exact minute,
 *       as a belt-and-braces backup.
 *********************************************************************/

function shapeFollowup_(f) {
  return {
    id: f.Followup_ID, indentId: f.Indent_ID,
    stageKey: safeStr_(f.Stage_Key), stageName: safeStr_(f.Stage_Name),
    pcId: safeStr_(f.PC_ID), pcName: safeStr_(f.PC_Name),
    contactMode: safeStr_(f.Contact_Mode), calledWhom: safeStr_(f.Called_Whom),
    calledWhomPhone: safeStr_(f.Called_Whom_Phone),
    notes: safeStr_(f.Notes), outcome: safeStr_(f.Outcome),
    reminderSet: truthy_(f.Reminder_Set), reminderAt: iso_(f.Reminder_At),
    reminderNote: safeStr_(f.Reminder_Note), reminderId: safeStr_(f.Reminder_ID),
    createdAt: iso_(f.Created_At)
  };
}

function shapeReminder_(r) {
  return {
    id: r.Reminder_ID, followupId: safeStr_(r.Followup_ID), indentId: r.Indent_ID,
    stageKey: safeStr_(r.Stage_Key), stageName: safeStr_(r.Stage_Name),
    pcId: safeStr_(r.PC_ID), pcName: safeStr_(r.PC_Name), pcEmail: safeStr_(r.PC_Email),
    remindAt: iso_(r.Remind_At), note: safeStr_(r.Note), status: r.Status,
    calendarEventId: safeStr_(r.Calendar_Event_Id),
    createdAt: iso_(r.Created_At), sentAt: iso_(r.Sent_At)
  };
}

/* ================================================================== */
/*  Record a follow-up                                                 */
/* ================================================================== */

function addFollowup_(token, p) {
  var actor = requireRole_(token, ['PC', 'ADMIN']);
  return withLock_(function () {
    var ind = getIndentOrThrow_(p.indentId);

    var stageKey = safeStr_(p.stageKey) || String(ind.Current_Stage);
    var stage = stageByKey_(stageKey);
    if (!stage) throw new Error('Unknown step: ' + stageKey);

    var calledWhom = safeStr_(p.calledWhom);
    if (!calledWhom) throw new Error('Please record who you contacted.');
    var notes = safeStr_(p.notes);
    if (!notes) throw new Error('Please write down what they said.');

    var fid = 'FU-' + uuid_().slice(0, 8);
    var t   = now_();

    var reminderId = '';
    var reminderAt = null;
    var reminderWarning = '';

    if (p.reminderSet) {
      reminderAt = toDate_(p.reminderAt);
      if (!reminderAt) throw new Error('Pick a valid date & time for the reminder.');
      if (reminderAt.getTime() <= t.getTime() + 30000) {
        throw new Error('The reminder time must be in the future.');
      }
      var rn = safeStr_(p.reminderNote);
      if (!rn) throw new Error('Write what you need to do at the next follow-up.');
      var made = createReminder_({
        followupId: fid, indent: ind, stage: stage, actor: actor,
        remindAt: reminderAt, note: rn
      });
      reminderId = made.id;
      reminderWarning = made.warning || '';
    }

    insert_(SH.FOLLOWUPS, {
      Followup_ID: fid, Indent_ID: ind.Indent_ID,
      Stage_Key: stage.key, Stage_Name: stage.name,
      PC_ID: actor.User_ID, PC_Name: actor.Name,
      Contact_Mode: safeStr_(p.contactMode) || 'CALL',
      Called_Whom: calledWhom, Called_Whom_Phone: safeStr_(p.calledWhomPhone),
      Notes: notes, Outcome: safeStr_(p.outcome) || 'FOLLOWED_UP',
      Reminder_Set: p.reminderSet ? 'TRUE' : 'FALSE',
      Reminder_At: reminderAt || '', Reminder_Note: safeStr_(p.reminderNote),
      Reminder_ID: reminderId, Created_At: t
    });

    logHistory_(ind.Indent_ID, stage.key,
      'Follow-up with ' + calledWhom + (p.reminderSet ? ' (reminder set)' : ''),
      'FOLLOWUP', actor, ind.Status, ind.Status,
      { mode: safeStr_(p.contactMode) || 'CALL', outcome: safeStr_(p.outcome) || 'FOLLOWED_UP',
        reminderAt: reminderAt ? iso_(reminderAt) : '' }, notes);

    notify_('FOLLOWUP', ind, {
      actorId: actor.User_ID, stageKey: stage.key,
      note: actor.Name + ' called ' + calledWhom + ' about step ' + stage.no + ' (' + stage.name + '): ' + notes
    });

    return { followupId: fid, reminderId: reminderId, warning: reminderWarning };
  });
}

/** Create the reminder row + Calendar event. Never throws on delivery failure. */
function createReminder_(o) {
  var id = 'REM-' + uuid_().slice(0, 8);
  var email = safeStr_(o.actor.Email);
  var warning = '';
  var eventId = '';

  if (truthy_(getSetting_('REMINDER_CALENDAR_ENABLED'))) {
    try {
      eventId = createCalendarAlert_(email, o);
    } catch (e) {
      warning = 'Reminder saved, but the calendar alert could not be created (' + e.message + ').';
    }
  }
  if (!email) {
    warning = 'Reminder saved, but no e-mail address is set on your account, so the phone ' +
              'notification cannot be delivered. Ask the admin to add your Google address.';
  }

  insert_(SH.REMINDERS, {
    Reminder_ID: id, Followup_ID: o.followupId, Indent_ID: o.indent.Indent_ID,
    Stage_Key: o.stage.key, Stage_Name: o.stage.name,
    PC_ID: o.actor.User_ID, PC_Name: o.actor.Name, PC_Email: email,
    Remind_At: o.remindAt, Note: o.note, Status: 'SCHEDULED',
    Calendar_Event_Id: eventId, Created_At: now_(), Sent_At: ''
  });

  logHistory_(o.indent.Indent_ID, o.stage.key, 'Reminder set for ' + fmt_(o.remindAt),
    'REMINDER', o.actor, '', '', { reminderId: id, at: iso_(o.remindAt) }, o.note);

  return { id: id, warning: warning };
}

/** Calendar event, PC invited as a guest so it lands on her phone. */
function createCalendarAlert_(email, o) {
  var cal = CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('no default calendar');
  var start = o.remindAt;
  var end   = new Date(start.getTime() + 15 * 60000);
  var title = '🔔 Follow-up: ' + o.indent.Indent_ID + ' — ' + o.indent.Part_Name;
  var body  = [
    'FOLLOW-UP REMINDER',
    '',
    'Indent   : ' + o.indent.Indent_ID + '  (' + o.indent.Part_Name + ' × ' + o.indent.Quantity + ')',
    'Site     : ' + siteLabel_(o.indent.Site, o.indent.Section),
    'Step     : ' + o.stage.no + '. ' + o.stage.name,
    'Raised by: ' + o.indent.Requested_By,
    '',
    'WHAT TO DO:',
    o.note
  ].join('\n');

  var opts = { description: body, location: siteLabel_(o.indent.Site, o.indent.Section) };
  if (email) { opts.guests = email; opts.sendInvites = true; }

  var ev = cal.createEvent(title, start, end, opts);
  try { ev.addPopupReminder(0); }  catch (e) {}
  try { ev.addPopupReminder(10); } catch (e) {}
  return ev.getId();
}

/* ================================================================== */
/*  Reminder maintenance                                               */
/* ================================================================== */

function listReminders_(token, f) {
  var actor = requireRole_(token, ['PC', 'ADMIN']);
  f = f || {};
  var rows = readAll_(SH.REMINDERS);
  if (String(actor.Role).toUpperCase() === 'PC') {
    rows = rows.filter(function (r) { return String(r.PC_ID) === String(actor.User_ID); });
  }
  if (f.status) rows = rows.filter(function (r) { return String(r.Status) === String(f.status); });
  if (f.indentId) rows = rows.filter(function (r) { return String(r.Indent_ID) === String(f.indentId); });
  rows.sort(function (a, b) { return (toDate_(a.Remind_At) || 0) - (toDate_(b.Remind_At) || 0); });
  return rows.map(shapeReminder_);
}

function cancelReminder_(token, p) {
  var actor = requireRole_(token, ['PC', 'ADMIN']);
  var r = findBy_(SH.REMINDERS, 'Reminder_ID', safeStr_(p.reminderId));
  if (!r) throw new Error('Reminder not found.');
  if (String(actor.Role).toUpperCase() === 'PC' && String(r.PC_ID) !== String(actor.User_ID)) {
    throw new Error('You can only cancel your own reminders.');
  }
  if (String(r.Status) !== 'SCHEDULED') throw new Error('That reminder is already ' + r.Status + '.');
  if (safeStr_(r.Calendar_Event_Id)) {
    try { CalendarApp.getDefaultCalendar().getEventById(r.Calendar_Event_Id).deleteEvent(); } catch (e) {}
  }
  update_(SH.REMINDERS, r.__row, { Status: 'CANCELLED' });
  return { id: r.Reminder_ID, status: 'CANCELLED' };
}

function rescheduleReminder_(token, p) {
  var actor = requireRole_(token, ['PC', 'ADMIN']);
  var r = findBy_(SH.REMINDERS, 'Reminder_ID', safeStr_(p.reminderId));
  if (!r) throw new Error('Reminder not found.');
  if (String(r.Status) !== 'SCHEDULED') throw new Error('That reminder is already ' + r.Status + '.');
  var at = toDate_(p.remindAt);
  if (!at || at.getTime() <= Date.now()) throw new Error('Pick a future date & time.');
  if (safeStr_(r.Calendar_Event_Id)) {
    try {
      var ev = CalendarApp.getDefaultCalendar().getEventById(r.Calendar_Event_Id);
      ev.setTime(at, new Date(at.getTime() + 15 * 60000));
    } catch (e) {}
  }
  update_(SH.REMINDERS, r.__row, { Remind_At: at, Note: safeStr_(p.note) || r.Note });
  return { id: r.Reminder_ID, remindAt: iso_(at) };
}

/* ================================================================== */
/*  TRIGGER: runs every 5 minutes                                      */
/* ================================================================== */

function processReminders() {
  purgeSessionsHourly_();          // housekeeping that used to slow down sign-in
  var nowMs = Date.now();
  var due = readWhere_(SH.REMINDERS, function (r) {
    if (String(r.Status) !== 'SCHEDULED') return false;
    var at = toDate_(r.Remind_At);
    return at && at.getTime() <= nowMs;
  });
  if (!due.length) return 0;

  var emailOn = truthy_(getSetting_('REMINDER_EMAIL_ENABLED'));
  var sent = 0;

  due.forEach(function (r) {
    try {
      var ind = findBy_(SH.INDENTS, 'Indent_ID', r.Indent_ID);
      if (emailOn && safeStr_(r.PC_Email)) {
        var pcu = findBy_(SH.USERS, 'User_ID', r.PC_ID);
        var el2 = langOf_(pcu);
        MailApp.sendEmail({
          to: r.PC_Email,
          subject: '🔔 ' + tr_('Follow-up due', el2) + ': ' + r.Indent_ID +
                   ' — ' + (ind ? ind.Part_Name : ''),
          htmlBody: reminderHtml_(r, ind, el2)
        });
      }
      try {
        var pc = findBy_(SH.USERS, 'User_ID', r.PC_ID);
        if (pc && safeStr_(pc.Telegram_Chat_ID) && tgEnabled_() && notifyEnabledFor_('REMINDER')) {
          var pl = langOf_(pc);
          tgSend_(pc.Telegram_Chat_ID,
            '<b>🔔 ' + tr_('Follow-up reminder', pl) + '</b>\n\n' +
            '<b>' + esc_(r.Indent_ID) + '</b> · ' + esc_(ind ? ind.Part_Name : '') + '\n' +
            tr_('Step', pl) + ': ' + esc_(tr_(String(r.Stage_Name), pl)) + '\n' +
            (ind ? tr_('Status', pl) + ': ' + esc_(tr_(String(ind.Status), pl)) + '\n' : '') +
            '\n<b>' + tr_('What you have to do:', pl) + '</b>\n' + esc_(r.Note),
            appUrl_(), pl);
        }
      } catch (tgErr) { /* the e-mail still went */ }
      update_(SH.REMINDERS, r.__row, { Status: 'SENT', Sent_At: now_() });
      sent++;
    } catch (e) {
      update_(SH.REMINDERS, r.__row, { Status: 'FAILED', Note: safeStr_(r.Note) + ' | ' + e.message });
    }
  });
  bumpIfDirty_();
  return sent;
}

function reminderHtml_(r, ind, lang) {
  var T = function (p) { return tr_(p, lang); };
  var stage = stageByKey_(r.Stage_Key);
  return '' +
  '<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#F1F5F9;padding:24px">' +
  '<div style="max-width:560px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;' +
  'box-shadow:0 12px 32px rgba(15,23,42,.12)">' +
  '<div style="background:linear-gradient(135deg,#8B5CF6,#6366F1);padding:22px 26px;color:#fff">' +
  '<div style="font-size:13px;letter-spacing:.14em;opacity:.85">' + T('FOLLOW-UP REMINDER') + '</div>' +
  '<div style="font-size:23px;font-weight:700;margin-top:6px">' + r.Indent_ID + ' — ' +
  (ind ? ind.Part_Name : '') + '</div></div>' +
  '<div style="padding:24px 26px;color:#0F172A;font-size:15px;line-height:1.6">' +
  '<p style="margin:0 0 14px"><b>' + T('Step') + ':</b> ' +
  (stage ? stage.no + '. ' + T(stage.name) : T(String(r.Stage_Name))) + '<br>' +
  '<b>' + T('Site') + ':</b> ' + (ind ? esc_(siteLabel_(ind.Site, ind.Section)) : '') + '<br>' +
  '<b>' + T('Quantity') + ':</b> ' + (ind ? ind.Quantity : '') + '<br>' +
  '<b>' + T('Raised by') + ':</b> ' + (ind ? ind.Requested_By : '') + '<br>' +
  '<b>' + T('Current status') + ':</b> ' + (ind ? T(String(ind.Status)) : '') + '</p>' +
  '<div style="background:#F5F3FF;border-left:4px solid #8B5CF6;border-radius:10px;padding:14px 16px">' +
  '<div style="font-size:12px;letter-spacing:.1em;color:#7C3AED;font-weight:700">' +
  T('WHAT YOU HAVE TO DO') + '</div>' +
  '<div style="margin-top:6px;white-space:pre-wrap">' + safeStr_(r.Note) + '</div></div>' +
  '<p style="margin:18px 0 0;font-size:13px;color:#64748B">' + T('Set by') + ' ' + r.PC_Name +
  ' &middot; ' + T('scheduled for') + ' ' + fmt_(r.Remind_At) + '</p>' +
  '</div></div></div>';
}
