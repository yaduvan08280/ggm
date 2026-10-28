/**
 * JPR FLEET DASHBOARD — TASK REMARKS
 * Version 6.0
 * ------------------------------------------------------------------
 * Anyone can attach a remark to a weekly / monthly / day / date task.
 * Remarks stay on the task until somebody marks it Done, then they are
 * written into that day's Checklist cell underneath the doer's name.
 *
 * A remark is never editable once saved — that is the point of it.
 * Multiple remarks are kept separate, in the order they were written.
 *
 * Daily tasks take no remarks: they come round again tomorrow anyway.
 *
 * _NOTES sheet (hidden — unhide it any time for the full history):
 *   A NOTE_ID | B CREATED | C TASK_ID | D CAR | E TASK | F ANCHOR
 *   G AUTHOR_EMAIL | H AUTHOR_NAME | I NOTE | J STATUS | K CLOSED_ON
 */

var NOTE_COL = {
  ID: 1, CREATED: 2, TASK_ID: 3, CAR: 4, TASK: 5, ANCHOR: 6,
  AUTHOR_EMAIL: 7, AUTHOR_NAME: 8, NOTE: 9, STATUS: 10, CLOSED_ON: 11
};
var NOTE_WIDTH = 11;

function notesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NOTES);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NOTES);
    sh.getRange(1, 1, 1, NOTE_WIDTH).setValues([[
      'NOTE_ID', 'CREATED', 'TASK_ID', 'CAR', 'TASK', 'ANCHOR',
      'AUTHOR_EMAIL', 'AUTHOR_NAME', 'NOTE', 'STATUS', 'CLOSED_ON'
    ]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

/** Every open remark, grouped by TASK_ID. Read once per dashboard refresh. */
function allOpenNotes_() {
  var out = {};
  try {
    var sh = notesSheet_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return out;

    var vals = sh.getRange(2, 1, lastRow - 1, NOTE_WIDTH).getDisplayValues();
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      if (String(r[NOTE_COL.STATUS - 1] || '').trim().toUpperCase() !== 'OPEN') continue;
      var taskId = String(r[NOTE_COL.TASK_ID - 1] || '').trim();
      if (!taskId) continue;
      (out[taskId] = out[taskId] || []).push({
        id     : String(r[NOTE_COL.ID - 1] || '').trim(),
        when   : String(r[NOTE_COL.CREATED - 1] || '').trim(),
        email  : String(r[NOTE_COL.AUTHOR_EMAIL - 1] || '').trim().toLowerCase(),
        author : String(r[NOTE_COL.AUTHOR_NAME - 1] || '').trim(),
        text   : String(r[NOTE_COL.NOTE - 1] || '').trim(),
        row    : i + 2
      });
    }
  } catch (e) {
    Logger.log('allOpenNotes_ error: ' + e);
  }
  return out;
}

function openNotesFor_(taskId) {
  return allOpenNotes_()[String(taskId).trim()] || [];
}

/** Marks a task's open remarks as used up once they reach the Checklist. */
function closeNotes_(notes, whenStr) {
  if (!notes || !notes.length) return;
  var sh = notesSheet_();
  notes.forEach(function (n) {
    if (!n.row) return;
    sh.getRange(n.row, NOTE_COL.STATUS).setValue('CLOSED');
    sh.getRange(n.row, NOTE_COL.CLOSED_ON).setValue(whenStr);
  });
}

/**
 * Turns the doer + their remarks into the text for one Checklist cell.
 *
 *   GAJENDRA MEENA
 *   (01:03 PM)
 *   Rear left tyre losing pressure          <- remark by the same person
 *   HARSHIT JAIN (wiper blade torn)         <- remark by somebody else
 */
function buildChecklistEntry_(doerName, doerEmail, timeStr, late, notes) {
  var lines = [(late ? MARK_LATE + ' ' : '') + doerName, '(' + timeStr + ')'];
  var me = String(doerEmail || '').trim().toLowerCase();

  (notes || []).forEach(function (n) {
    if (!n.text) return;
    lines.push(n.email && n.email === me ? n.text : n.author + ' (' + n.text + ')');
  });

  return lines.join('\n');
}


// ═══════════════════ PUBLIC API ═══════════════════

/**
 * payload = { token, rowIdx, taskName, note }
 */
function apiAddTaskNote(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var session = requireSession_(payload && payload.token);

    var note = String(payload.note == null ? '' : payload.note).trim();
    if (!note) return { success: false, message: 'Write something first.' };
    if (note.length > NOTE_MAX_LEN) {
      return { success: false, message: 'Keep the remark under ' + NOTE_MAX_LEN + ' characters.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mSheet = ss.getSheetByName(SHEET_MASTER);
    if (!mSheet) return { success: false, message: 'MASTER sheet not found.' };

    var cols   = ensureMasterCols_(mSheet);
    var rowIdx = parseInt(payload.rowIdx, 10);
    if (!rowIdx || rowIdx < 2) return { success: false, message: 'Bad task row.' };

    var width = Math.max(mSheet.getLastColumn(), cols.MISSED_COUNT);
    var live  = mSheet.getRange(rowIdx, 1, 1, width).getDisplayValues()[0];
    var taskId = String(live[0] || '').trim();
    var car    = String(live[1] || '').trim();
    var task   = String(live[3] || '').trim();
    var sch    = parseSchedule_(live[2]);

    if (!taskId) return { success: false, message: 'That task row has no Task ID.' };
    if (task && payload.taskName &&
        task.toUpperCase() !== String(payload.taskName).trim().toUpperCase()) {
      return { success: false, message: 'This task moved in the sheet. Refresh and try again.' };
    }
    if (sch.kind === 'daily') {
      return { success: false, message: 'Remarks are for weekly and monthly tasks only.' };
    }

    var existing = openNotesFor_(taskId);
    if (existing.length >= MAX_NOTES_PER_TASK) {
      return { success: false, message: 'This task already has ' + MAX_NOTES_PER_TASK +
                                        ' open remarks. Mark it done to clear them.' };
    }

    var anchor = resolveAnchor_(sch, live[cols.ANCHOR - 1], live[4], todayStart_());
    var now = new Date();

    notesSheet_().appendRow([
      Utilities.getUuid(), fmtStamp_(now), taskId, car, task,
      anchor ? fmtDMY_(anchor) : '', session.email, session.name,
      note, 'OPEN', ''
    ]);
    SpreadsheetApp.flush();

    return {
      success: true,
      note: { id: '', when: fmtStamp_(now), email: session.email,
              author: session.name, text: note }
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
