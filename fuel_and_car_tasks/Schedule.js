/**
 * JPR FLEET DASHBOARD — SCHEDULE RULES
 * Version 5.0
 * ------------------------------------------------------------------
 * The MASTER "Freq" column (C) is now a RULE, not an interval.
 * A rule never moves, so postponing a task can never drift its schedule.
 *
 *   D  /  DAILY                → every day
 *   MONDAY                     → every Monday
 *   MON, THU                   → every Monday and Thursday
 *   17                         → the 17th of every month
 *   17, 21                     → the 17th and the 21st of every month
 *   W  /  M                    → legacy interval mode (still works, please migrate)
 *
 * Day names may be full or short (MON / MONDAY / TUES / THURS ...).
 * Separators may be comma, slash, semicolon, "&" or "and".
 * A monthly date larger than the month (31 in February) fires on the
 * last day of that month rather than being skipped.
 */

var WEEKDAYS_ = {
  'SUNDAY':0,'SUN':0,'SU':0,
  'MONDAY':1,'MON':1,'MO':1,
  'TUESDAY':2,'TUES':2,'TUE':2,'TU':2,
  'WEDNESDAY':3,'WED':3,'WE':3,
  'THURSDAY':4,'THURS':4,'THUR':4,'THU':4,'TH':4,
  'FRIDAY':5,'FRI':5,'FR':5,
  'SATURDAY':6,'SAT':6,'SA':6
};
var WEEKDAY_SHORT_ = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

/** How many days early a task becomes visible in the app, per rule kind. */
var WINDOW_BY_KIND_ = { daily: 0, weekly: 2, monthly: 7, interval: 2, invalid: 0 };

function daysInMonth_(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

function uniqSortNums_(arr) {
  var seen = {}, out = [];
  arr.forEach(function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } });
  return out.sort(function (a, b) { return a - b; });
}

/**
 * Turns the Freq cell into a schedule object.
 * Returns { kind, days?, dates?, unit?, label, short, raw }
 *   kind: 'daily' | 'weekly' | 'monthly' | 'interval' | 'invalid'
 */
function parseSchedule_(raw) {
  var s = String(raw == null ? '' : raw).trim().toUpperCase();

  if (!s) return { kind: 'invalid', raw: s, label: '(blank)', short: '?' };

  if (s === 'D' || s === 'DAILY' || s === 'EVERYDAY' || s === 'EVERY DAY') {
    return { kind: 'daily', raw: s, label: 'Daily', short: 'DAILY' };
  }
  if (s === 'W' || s === 'WEEKLY') {
    return { kind: 'interval', unit: 'W', raw: s, label: 'Weekly (legacy)', short: 'WEEKLY' };
  }
  if (s === 'M' || s === 'MONTHLY') {
    return { kind: 'interval', unit: 'M', raw: s, label: 'Monthly (legacy)', short: 'MONTHLY' };
  }

  var parts = s.replace(/\bAND\b/g, ',').split(/[,;/|&+]+/)
               .map(function (x) { return x.trim(); })
               .filter(function (x) { return x !== ''; });

  var days = [], dates = [], bad = false;

  parts.forEach(function (p) {
    if (/^\d{1,2}(ST|ND|RD|TH)?$/.test(p)) {
      var n = parseInt(p, 10);
      if (n >= 1 && n <= 31) dates.push(n); else bad = true;
    } else if (WEEKDAYS_[p] !== undefined) {
      days.push(WEEKDAYS_[p]);
    } else {
      bad = true;
    }
  });

  if (bad || parts.length === 0) return { kind: 'invalid', raw: s, label: s, short: '?' };
  if (days.length && dates.length) return { kind: 'invalid', raw: s, label: s, short: '?' };

  if (days.length) {
    var d = uniqSortNums_(days);
    var lbl = d.map(function (x) { return WEEKDAY_SHORT_[x]; }).join(', ');
    return { kind: 'weekly', days: d, raw: s, label: 'Every ' + lbl, short: lbl };
  }

  var dt = uniqSortNums_(dates);
  return {
    kind: 'monthly', dates: dt, raw: s,
    label: 'Day ' + dt.join(', ') + ' of every month',
    short: dt.join(' · ')
  };
}

/** Does this rule fire on this calendar date? */
function isOccurrence_(sch, date) {
  if (!sch) return false;
  if (sch.kind === 'daily') return true;
  if (sch.kind === 'weekly') return sch.days.indexOf(date.getDay()) >= 0;
  if (sch.kind === 'monthly') {
    var dom  = date.getDate();
    if (sch.dates.indexOf(dom) >= 0) return true;
    // 31 in a 30-day month fires on the last day instead of being skipped.
    var last = daysInMonth_(date.getFullYear(), date.getMonth());
    if (dom === last) {
      for (var i = 0; i < sch.dates.length; i++) if (sch.dates[i] > last) return true;
    }
    return false;
  }
  return false;   // interval / invalid have no rule-based calendar
}

/**
 * First date this rule fires on or after `from` (or strictly after when
 * inclusive is false). Falls back to interval maths for legacy W / M.
 */
function nextOccurrence_(sch, from, inclusive) {
  if (!sch) return null;

  if (sch.kind === 'interval') {
    return sch.unit === 'W' ? addDays_(from, inclusive ? 0 : 7)
                            : addMonths_(from, inclusive ? 0 : 1);
  }
  if (sch.kind === 'invalid') return null;
  if (sch.kind === 'daily') return inclusive ? new Date(from.getTime()) : addDays_(from, 1);

  var cursor = inclusive ? new Date(from.getTime()) : addDays_(from, 1);
  for (var i = 0; i < 400; i++) {
    if (isOccurrence_(sch, cursor)) return cursor;
    cursor = addDays_(cursor, 1);
  }
  return null;
}

/** Every date this rule fires on between `start` and `end`, both inclusive. */
function occurrencesBetween_(sch, start, end) {
  var out = [];
  if (!sch || sch.kind === 'invalid') return out;
  if (dayDiff_(start, end) < 0) return out;
  if (sch.kind === 'interval') return out;   // legacy has no calendar to walk

  var cursor = new Date(start.getTime());
  for (var i = 0; i < 400 && dayDiff_(cursor, end) >= 0; i++) {
    if (isOccurrence_(sch, cursor)) out.push(new Date(cursor.getTime()));
    cursor = addDays_(cursor, 1);
  }
  return out;
}

/** Days early this rule's tasks appear in the app. */
function windowForSchedule_(sch) {
  if (!sch) return 0;
  if (sch.kind === 'interval') return sch.unit === 'M' ? 7 : 2;
  var w = WINDOW_BY_KIND_[sch.kind];
  return w === undefined ? 0 : w;
}

/** Can this rule's tasks be postponed? Daily ones cannot. */
function schedulePostponable_(sch) {
  return !!sch && (sch.kind === 'weekly' || sch.kind === 'monthly' || sch.kind === 'interval');
}
