/**
 * JPR FLEET DASHBOARD — TASK ENGINE
 * Version 5.0  (rule-based scheduling)
 * ------------------------------------------------------------------
 * MASTER columns:
 *   A Task ID | B CAR | C Freq(RULE) | D Task | E Due | F Status | G Name
 *   H LAST_DONE | I SHIFT_USED | J LAST_NOTE | K ANCHOR | L MISSED_COUNT
 *
 * THE ANCHOR IS THE WHOLE IDEA.
 *   ANCHOR  = the rule's own occurrence date that is currently outstanding.
 *             It only ever moves to another date the RULE produces, so a
 *             MONDAY task is always back on Monday next week no matter what
 *             happened this week.
 *   Due (E) = ANCHOR + SHIFT_USED.  This is what the user sees and what
 *             decides overdue/due/upcoming.  Postponing moves Due only —
 *             never the anchor, never the rule.
 *
 * WHAT LANDS IN THE CHECKLIST CALENDAR
 *   (blank)            the task was not scheduled that day
 *   NAME (time)        done on a day it was due
 *   ⚠ NAME (time)      done, but later than it was due
 *   ❌                  it was due that day and nobody did it
 *   ⏭ +2d (NAME)       it was due that day and was postponed instead
 */

// ═══════════════════ CHECKLIST WRITE (with a real result) ═══════════════════

/**
 * Writes one entry into the Checklist calendar and SAYS WHETHER IT WORKED.
 * The old code guarded every write with `if (cRow > 0 && col)` and returned
 * success regardless, so a header the parser could not read meant every entry
 * vanished with no error anywhere. Now the caller gets a reason back.
 *
 * Returns { ok: true } or { ok: false, reason: '...' }.
 */
function stampChecklist_(cSheet, car, task, dateObj, text, color) {
  if (!cSheet) return { ok: false, reason: 'The "' + SHEET_CHECKLIST + '" sheet was not found.' };

  var layout = checklistLayout_(cSheet);
  if (!layout) {
    return { ok: false, reason: 'The Checklist calendar headers could not be read — ' +
             'check that a MONTH name sits above the row of day numbers.' };
  }

  var cData = cSheet.getDataRange().getDisplayValues();
  var cRow  = checklistRowIndex_(cData, layout.dataStart - 1, car, task);
  if (cRow < 0) {
    return { ok: false, reason: 'No Checklist row for "' + car + '" / "' + task + '".' };
  }

  var col = checklistColFor_(layout, dateObj);
  if (!col) {
    return { ok: false, reason: 'The Checklist has no column for ' + fmtDMY_(dateObj) +
             ' — add that month to the calendar.' };
  }

  flushChecklistWrites_(cSheet, [{
    row: cRow, col: col, text: text, color: color, align: 'center'
  }]);
  return { ok: true, row: cRow, col: col };
}


// ═══════════════════ STATE ENGINE ═══════════════════

/**
 * What a task row means today.
 * `due` here is the shifted date (anchor + shiftUsed).
 */
function computeTaskState_(sch, due, lastDone, shiftUsed, today) {
  // A DAILY task is due again every single day, so yesterday's miss is not a
  // backlog — it is simply recorded with a ❌ in the Checklist. Clamp its due
  // date to today so it always sits in "Today", never in "Overdue", even if
  // the nightly rollover has not run yet (trigger late, failed, or app opened
  // at 00:02).
  var effDue = due;
  if (sch && sch.kind === 'daily' && dayDiff_(today, due) < 0) effDue = today;

  var diff = dayDiff_(today, effDue);           // >0 future, 0 today, <0 late
  var doneToday = !!(lastDone && dayDiff_(today, lastDone) === 0);

  var state;
  if (doneToday && diff > 0)      state = 'done';
  else if (diff < 0)              state = 'overdue';
  else if (diff === 0)            state = doneToday ? 'done' : 'due';
  else                            state = 'upcoming';

  var win     = windowForSchedule_(sch);
  var visible = (state !== 'upcoming') || (diff <= win);

  var shiftLeft = Math.max(0, MAX_SHIFT_DAYS - (parseInt(shiftUsed, 10) || 0));
  var canShift  = schedulePostponable_(sch) && shiftLeft > 0 && state !== 'done';

  return {
    state: state, visible: visible,
    overdueDays: diff < 0 ? -diff : 0,
    daysToGo:    diff > 0 ?  diff : 0,
    canShift: canShift, shiftLeft: shiftLeft, window: win,
    effectiveDue: effDue
  };
}

/**
 * Where the anchor should sit for a row, creating it the first time.
 * Never invents a date the rule would not produce.
 */
function resolveAnchor_(sch, anchorStr, dueStr, today) {
  var a = parseDMY_(anchorStr);
  if (a) return a;

  // First run for this row — adopt the existing Due date when the rule
  // agrees with it, otherwise snap to the next date the rule produces.
  var due = parseDMY_(dueStr);
  if (due && (sch.kind === 'interval' || isOccurrence_(sch, due))) return due;
  return nextOccurrence_(sch, today, true);
}

/** Next anchor after a completion: the rule's next date strictly after `after`. */
function advanceAnchor_(sch, after) {
  return nextOccurrence_(sch, after, false);
}


// ═══════════════════ MIDNIGHT ROLLOVER ═══════════════════

/**
 * Runs every night at 00:05 IST. Idempotent — safe to run by hand.
 *
 * For every outstanding task it stamps ❌ on each day the rule fired and
 * nobody acted, then leaves the task sitting on its anchor so it keeps
 * nagging. Nothing is ever silently skipped.
 */
function dailyRollover() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('dailyRollover: busy, skipped.'); return; }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mSheet = ss.getSheetByName(SHEET_MASTER);
    if (!mSheet) throw new Error('MASTER sheet not found.');
    var cSheet = ss.getSheetByName(SHEET_CHECKLIST);

    var cols  = ensureMasterCols_(mSheet);
    var today = todayStart_();
    var yesterday = addDays_(today, -1);

    var lastRow = mSheet.getLastRow();
    if (lastRow < 2) return;

    var lastCol = Math.max(mSheet.getLastColumn(), cols.MISSED_COUNT);
    var vals    = mSheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

    var layout    = checklistLayout_(cSheet);
    if (cSheet && !layout) {
      Logger.log('dailyRollover WARNING: the Checklist calendar headers could not be read. ' +
                 'No missed-day marks will be written. Run "Check Checklist calendar" from the JPR Fleet menu.');
    }
    var cData     = cSheet ? cSheet.getDataRange().getDisplayValues() : [];
    var dataStart = layout ? layout.dataStart - 1 : 3;

    var blockStart = 5;
    var blockWidth = lastCol - blockStart + 1;
    var block = mSheet.getRange(2, blockStart, lastRow - 1, blockWidth).getDisplayValues();

    var iDue    = 5 - blockStart;
    var iStatus = 6 - blockStart;
    var iName   = 7 - blockStart;
    var iDone   = cols.LAST_DONE    - blockStart;
    var iShift  = cols.SHIFT_USED   - blockStart;
    var iNote   = cols.LAST_NOTE    - blockStart;
    var iAnchor = cols.ANCHOR       - blockStart;
    var iMissed = cols.MISSED_COUNT - blockStart;

    var writes = [], dirty = {}, stamped = 0, badRules = 0;

    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];
      if (!String(row[0] || '').trim()) continue;

      var car  = String(row[1] || '').trim();
      var task = String(row[3] || '').trim();
      var sch  = parseSchedule_(row[2]);

      if (sch.kind === 'invalid') {
        badRules++;
        if (String(block[i][iStatus] || '') !== 'CHECK FREQ') {
          block[i][iStatus] = 'CHECK FREQ';
          block[i][iNote]   = 'Freq "' + sch.raw + '" not understood. Use D, a day name (MONDAY), or dates (17, 21).';
          dirty[i] = true;
        }
        continue;
      }

      var anchor = resolveAnchor_(sch, row[cols.ANCHOR - 1], row[4], today);
      if (!anchor) continue;

      var shift    = parseInt(row[cols.SHIFT_USED - 1], 10) || 0;
      var due      = addDays_(anchor, shift);
      var lastDone = parseDMY_(row[cols.LAST_DONE - 1]);

      // Write the anchor back the first time we work it out.
      if (fmtDMY_(anchor) !== String(row[cols.ANCHOR - 1] || '').trim()) {
        block[i][iAnchor] = fmtDMY_(anchor);
        dirty[i] = true;
      }
      if (String(block[i][iDue] || '').trim() !== fmtDMY_(due)) {
        block[i][iDue] = fmtDMY_(due);
        dirty[i] = true;
      }

      // A "Done" left over from an earlier cycle must not linger.
      var doneThisCycle = lastDone && dayDiff_(lastDone, anchor) <= 0;
      if (!doneThisCycle && String(block[i][iStatus] || '').trim() === 'Done') {
        block[i][iStatus] = '';
        block[i][iName]   = '';
        dirty[i] = true;
      }

      // Still in the future (or due today) — nothing was missed.
      if (dayDiff_(today, due) >= 0) continue;

      // ── Outstanding ──────────────────────────────────────────────
      var cRow = (layout && cSheet) ? checklistRowIndex_(cData, dataStart, car, task) : -1;
      var missed = parseInt(row[cols.MISSED_COUNT - 1], 10) || 0;

      // Every day the RULE fired between the anchor and yesterday.
      var days = occurrencesBetween_(sch, anchor, yesterday);
      // Plus the shifted date itself, when the postponed day has also passed.
      if (shift > 0 && dayDiff_(today, due) < 0 && !isOccurrence_(sch, due)) days.push(due);

      if (cRow > 0) {
        days.forEach(function (d) {
          var col = checklistColFor_(layout, d);
          if (!col) return;
          writes.push({ row: cRow, col: col, text: MARK_MISSED, color: '#DC2626',
                        align: 'center', onlyIfEmpty: true });
          stamped++;
        });
      }

      if (sch.kind === 'daily') {
        // Daily tasks never build a backlog. The skipped days are already
        // recorded with ❌ above; the task simply comes up fresh today.
        block[i][iAnchor] = fmtDMY_(today);
        block[i][iDue]    = fmtDMY_(today);
        block[i][iStatus] = '';
        block[i][iName]   = '';
        block[i][iShift]  = 0;
        block[i][iMissed] = 0;
        block[i][iNote]   = 'Auto-rolled to ' + fmtDMY_(today) +
                            (days.length ? ' · ' + days.length + ' day(s) not done' : '');
      } else {
        // Weekly / monthly / day / date rules stay overdue until someone acts.
        if (days.length > missed) missed = days.length;
        block[i][iStatus] = 'OVERDUE';
        block[i][iName]   = '';
        block[i][iMissed] = missed;
      }
      dirty[i] = true;
    }

    Object.keys(dirty).forEach(function (k) {
      var i = parseInt(k, 10);
      mSheet.getRange(i + 2, blockStart, 1, blockWidth).setValues([block[i]]);
    });
    flushChecklistWrites_(cSheet, writes);
    SpreadsheetApp.flush();

    Logger.log('dailyRollover: ' + Object.keys(dirty).length + ' rows, ' +
               stamped + ' missed stamps, ' + badRules + ' bad rules.');
  } catch (e) {
    Logger.log('dailyRollover ERROR: ' + e);
    throw e;
  } finally {
    lock.releaseLock();
  }
}


// ═══════════════════ COMPLETE A TASK ═══════════════════

/**
 * payload = { token, rowIdx, taskName }
 * The doer's name comes from the login.
 */
function submitTaskCompletion(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var session = requireSession_(payload && payload.token);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mSheet = ss.getSheetByName(SHEET_MASTER);
    var cSheet = ss.getSheetByName(SHEET_CHECKLIST);
    if (!mSheet) return { success: false, message: 'MASTER sheet not found.' };

    var cols  = ensureMasterCols_(mSheet);
    var now   = new Date();
    var today = todayStart_();

    var rowIdx = parseInt(payload.rowIdx, 10);
    if (!rowIdx || rowIdx < 2) return { success: false, message: 'Bad task row.' };

    var width = Math.max(mSheet.getLastColumn(), cols.MISSED_COUNT);
    var live  = mSheet.getRange(rowIdx, 1, 1, width).getDisplayValues()[0];
    var car   = String(live[1] || '').trim();
    var task  = String(live[3] || '').trim();
    var sch   = parseSchedule_(live[2]);

    if (sch.kind === 'invalid') {
      return { success: false, message: 'The Freq value "' + sch.raw + '" is not a valid schedule. Ask your admin to fix it.' };
    }
    if (task && payload.taskName && task.toUpperCase() !== String(payload.taskName).trim().toUpperCase()) {
      return { success: false, message: 'This task moved in the sheet. Refresh and try again.' };
    }

    var anchor = resolveAnchor_(sch, live[cols.ANCHOR - 1], live[4], today);
    if (!anchor) return { success: false, message: 'Could not work out this task\'s schedule.' };

    var shift    = parseInt(live[cols.SHIFT_USED - 1], 10) || 0;
    var due      = addDays_(anchor, shift);
    var lastDone = parseDMY_(live[cols.LAST_DONE - 1]);

    if (lastDone && dayDiff_(today, lastDone) === 0 && dayDiff_(today, due) < 0) {
      return { success: false, message: 'Already marked done today by ' + (live[6] || 'someone') + '.' };
    }

    // On time if today is not past the due date, or today is itself a rule day.
    var late    = dayDiff_(today, due) < 0 && !isOccurrence_(sch, today);
    var nextAnc = advanceAnchor_(sch, dayDiff_(today, anchor) > 0 ? anchor : today);
    if (!nextAnc) nextAnc = addDays_(today, 1);

    mSheet.getRange(rowIdx, 5).setValue(fmtDMY_(nextAnc));
    mSheet.getRange(rowIdx, 6).setValue('Done');
    mSheet.getRange(rowIdx, 7).setValue(session.name);
    mSheet.getRange(rowIdx, cols.LAST_DONE).setValue(fmtStamp_(now));
    mSheet.getRange(rowIdx, cols.SHIFT_USED).setValue(0);
    mSheet.getRange(rowIdx, cols.ANCHOR).setValue(fmtDMY_(nextAnc));
    mSheet.getRange(rowIdx, cols.MISSED_COUNT).setValue(0);
    mSheet.getRange(rowIdx, cols.LAST_NOTE)
          .setValue(late ? 'Completed late on ' + fmtDMY_(today) + ' (was due ' + fmtDMY_(due) + ')' : '');

    // Any remarks left on this task ride along into the Checklist cell.
    var taskId = String(live[0] || '').trim();
    var notes  = taskId ? openNotesFor_(taskId) : [];

    var stamp = stampChecklist_(
      cSheet, car, task, today,
      buildChecklistEntry_(session.name, session.email, fmtClock_(now), late, notes),
      late ? '#B45309' : '#047857');

    // Only retire the remarks once they have actually landed — otherwise they
    // stay on the task and go in on the next attempt.
    if (stamp.ok && notes.length) closeNotes_(notes, fmtStamp_(now));

    if (!stamp.ok) {
      Logger.log('Checklist NOT updated for row ' + rowIdx + ': ' + stamp.reason);
      mSheet.getRange(rowIdx, cols.LAST_NOTE)
            .setValue('Checklist not updated: ' + stamp.reason);
    }

    SpreadsheetApp.flush();
    return {
      success: true, doneBy: session.name, doneAt: fmtClock_(now),
      late: late, nextDue: fmtDMY_(nextAnc),
      notesUsed: stamp.ok ? notes.length : 0,
      checklistOk: stamp.ok,
      warning: stamp.ok ? '' : stamp.reason
    };

  } catch (e) {
    if (String(e.message || e).indexOf('SESSION_EXPIRED') >= 0) {
      return { success: false, expired: true, message: 'Your session ended. Please log in again.' };
    }
    return { success: false, message: e.message || String(e) };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}


// ═══════════════════ SHIFT (POSTPONE) ═══════════════════

/**
 * payload = { token, rowIdx, days }   days = 1 or 2
 * Moves only THIS cycle's due date. The rule and the anchor never move,
 * so a MONDAY task is back on Monday next week.
 */
function shiftTask(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var session = requireSession_(payload && payload.token);

    var days = parseInt(payload.days, 10);
    if (!(days >= 1 && days <= MAX_SHIFT_DAYS)) {
      return { success: false, message: 'You can postpone by 1 or 2 days only.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mSheet = ss.getSheetByName(SHEET_MASTER);
    var cSheet = ss.getSheetByName(SHEET_CHECKLIST);
    if (!mSheet) return { success: false, message: 'MASTER sheet not found.' };

    var cols   = ensureMasterCols_(mSheet);
    var today  = todayStart_();
    var rowIdx = parseInt(payload.rowIdx, 10);
    if (!rowIdx || rowIdx < 2) return { success: false, message: 'Bad task row.' };

    var width = Math.max(mSheet.getLastColumn(), cols.MISSED_COUNT);
    var live  = mSheet.getRange(rowIdx, 1, 1, width).getDisplayValues()[0];
    var car   = String(live[1] || '').trim();
    var task  = String(live[3] || '').trim();
    var sch   = parseSchedule_(live[2]);

    if (!schedulePostponable_(sch)) {
      return { success: false, message: 'Daily tasks cannot be postponed.' };
    }

    var anchor = resolveAnchor_(sch, live[cols.ANCHOR - 1], live[4], today);
    if (!anchor) return { success: false, message: 'This task has no valid schedule.' };

    var used = parseInt(live[cols.SHIFT_USED - 1], 10) || 0;
    if (used + days > MAX_SHIFT_DAYS) {
      var left = MAX_SHIFT_DAYS - used;
      return { success: false, message: left > 0
        ? 'Only ' + left + ' more day can be added to this task.'
        : 'This task has already been postponed the maximum of ' + MAX_SHIFT_DAYS + ' days.' };
    }

    var fromDate = addDays_(anchor, used);        // the day being pushed away from
    var newDue   = addDays_(anchor, used + days);

    mSheet.getRange(rowIdx, 5).setValue(fmtDMY_(newDue));
    mSheet.getRange(rowIdx, cols.SHIFT_USED).setValue(used + days);
    mSheet.getRange(rowIdx, cols.ANCHOR).setValue(fmtDMY_(anchor));
    mSheet.getRange(rowIdx, 6).setValue('Shifted');
    mSheet.getRange(rowIdx, cols.LAST_NOTE)
          .setValue('Postponed +' + days + 'd by ' + session.name + ' on ' + fmtDMY_(today) +
                    ' · still ' + sch.label);

    var stamp = stampChecklist_(cSheet, car, task, fromDate,
      MARK_SHIFT + ' +' + days + 'd\n(' + session.name + ')', '#B45309');
    if (!stamp.ok) Logger.log('Checklist NOT updated (shift) row ' + rowIdx + ': ' + stamp.reason);

    SpreadsheetApp.flush();
    return { success: true, newDue: fmtDMY_(newDue),
             shiftLeft: MAX_SHIFT_DAYS - (used + days),
             checklistOk: stamp.ok, warning: stamp.ok ? '' : stamp.reason };

  } catch (e) {
    if (String(e.message || e).indexOf('SESSION_EXPIRED') >= 0) {
      return { success: false, expired: true, message: 'Your session ended. Please log in again.' };
    }
    return { success: false, message: e.message || String(e) };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}


// ═══════════════════ TRIGGERS, SETUP & ADMIN ═══════════════════

function installTriggers() {
  portalAssertEditor_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyRollover') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('dailyRollover').timeBased()
    .atHour(0).nearMinute(5).everyDays(1).create();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var m = ss.getSheetByName(SHEET_MASTER);  if (m) ensureMasterCols_(m);
  var u = ss.getSheetByName(SHEET_USERS);   if (u) ensureUserCols_(u);
  authSheet_();
  authSalt_();

  return 'Nightly rollover installed for ~00:05 ' + TZ + '.';
}

function setupEverything() {
  portalAssertEditor_();
  var msg = installTriggers();
  SpreadsheetApp.getUi().alert(
    'Setup complete\n\n' + msg +
    '\n\nMASTER now has ANCHOR and MISSED_COUNT columns. ' +
    'Users now has EMAIL / NAME / PASSWORD — fill in EMAIL and NAME for each person. ' +
    'Everyone starts with password ' + DEFAULT_PASSWORD + '.'
  );
}

/** Lists any Freq value the scheduler cannot read. */
function auditSchedules() {
  portalAssertEditor_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var m  = ss.getSheetByName(SHEET_MASTER);
  if (!m) { SpreadsheetApp.getUi().alert('MASTER sheet not found.'); return; }

  var lastRow = m.getLastRow();
  if (lastRow < 2) { SpreadsheetApp.getUi().alert('No task rows.'); return; }

  var vals = m.getRange(2, 1, lastRow - 1, 5).getDisplayValues();
  var bad = [], legacy = [], counts = {};

  vals.forEach(function (r, i) {
    if (!String(r[0] || '').trim()) return;
    var sch = parseSchedule_(r[2]);
    counts[sch.kind] = (counts[sch.kind] || 0) + 1;
    if (sch.kind === 'invalid') bad.push('Row ' + (i + 2) + ': "' + r[2] + '"  — ' + r[3]);
    if (sch.kind === 'interval') legacy.push('Row ' + (i + 2) + ': ' + r[2] + '  — ' + r[1] + ' / ' + r[3]);
  });

  var msg = 'Schedule audit\n\n' +
    'daily: ' + (counts.daily || 0) + '   weekly-by-day: ' + (counts.weekly || 0) +
    '   monthly-by-date: ' + (counts.monthly || 0) + '\n' +
    'legacy W/M: ' + (counts.interval || 0) + '   unreadable: ' + (counts.invalid || 0) + '\n\n';

  if (bad.length)    msg += 'FIX THESE:\n' + bad.slice(0, 20).join('\n') + '\n\n';
  if (legacy.length) msg += 'Still on legacy W/M (replace with MONDAY or 17, 21):\n' +
                            legacy.slice(0, 25).join('\n');
  if (!bad.length && !legacy.length) msg += 'Every row uses a proper rule. Nothing to fix.';

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Reports exactly what the parser sees in the Checklist calendar.
 * Run this whenever entries stop appearing.
 */
function diagnoseChecklist() {
  portalAssertEditor_();
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cSheet = ss.getSheetByName(SHEET_CHECKLIST);
  if (!cSheet) { ui.alert('The "' + SHEET_CHECKLIST + '" sheet was not found.'); return; }

  var layout = checklistLayout_(cSheet);
  if (!layout) {
    ui.alert('Checklist calendar: NOT READABLE\n\n' +
      'A row of day numbers was found, but no MONTH name above it.\n\n' +
      'Most common cause: the month header is merged down across two rows, so the ' +
      'value only exists in the top row of the merge.\n\n' +
      'Nothing will be written to the Checklist until this is fixed.');
    return;
  }

  var today  = todayStart_();
  var colToday = checklistColFor_(layout, today);
  var msg = 'Checklist calendar: OK\n\n' +
    'Month header row: ' + layout.monthRow + '\n' +
    'Day number row:   ' + layout.dayRow + '\n' +
    'Task rows start:  ' + layout.dataStart + '\n' +
    'Days mapped:      ' + layout.mapped + '\n\n' +
    'Today (' + fmtDMY_(today) + ') → ' +
    (colToday ? 'column ' + colToday : 'NO COLUMN — add this month to the calendar') + '\n\n';

  // Do the task rows line up with MASTER?
  var m = ss.getSheetByName(SHEET_MASTER);
  if (m && m.getLastRow() > 1) {
    var mv = m.getRange(2, 1, m.getLastRow() - 1, 4).getDisplayValues();
    var cData = cSheet.getDataRange().getDisplayValues();
    var missing = [];
    mv.forEach(function (r) {
      if (!String(r[0] || '').trim()) return;
      if (checklistRowIndex_(cData, layout.dataStart - 1, String(r[1]).trim(), String(r[3]).trim()) < 0) {
        missing.push(r[1] + ' / ' + r[3]);
      }
    });
    msg += missing.length
      ? 'MASTER tasks with no Checklist row (' + missing.length + '):\n' + missing.slice(0, 15).join('\n')
      : 'Every MASTER task has a matching Checklist row.';
  }

  ui.alert(msg);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('JPR Fleet')
    .addItem('Run setup (first time)', 'setupEverything')
    .addItem('Run rollover now', 'dailyRollover')
    .addItem('Audit schedule column', 'auditSchedules')
    .addItem('Check Checklist calendar', 'diagnoseChecklist')
    .addSeparator()
    .addItem('Reset a password to ' + DEFAULT_PASSWORD, 'adminResetToDefault')
    .addItem('Log everyone out', 'adminLogoutAllSessions')
    .addToUi();
}
