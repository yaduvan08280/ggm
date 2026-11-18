/*******************************************************
 * Work.js — working-hours maths, the same as the FMS "Planned" formula:
 * the clock runs only between Opening and Closing time (Config A1 / A2) on
 * working days (Config A3, Mon..Sun, 1 = off) that are not in Holidays.
 * India time (+5:30, no summer time). Shared with the page (sharedJs_).
 *******************************************************/

var W_H = 3600000, W_D = 86400000, W_OFF = 19800000;

/** cal = { open: 10, close: 18, mask: '0000001', hol: [dayNumbers] } → adds a fast lookup. */
function wCal(cal) {
  if (cal._h) return cal;
  var h = {};
  (cal.hol || []).forEach(function (d) { h[d] = 1; });
  cal._h = h;
  return cal;
}

function wDay(ms) { return Math.floor((ms + W_OFF) / W_D); }

function wIsWork(day, cal) {
  var dow = (day + 4) % 7;                 // 0 = Sunday (1 Jan 1970 was a Thursday)
  var i = (dow + 6) % 7;                   // mask index: Monday first
  return String(cal.mask || '0000001').charAt(i) !== '1' && !wCal(cal)._h[day];
}

/** WORKDAY.INTL(day, n): the n-th working day after day (n = 0 → day itself). */
function wNext(day, n, cal) {
  var d = day, guard = 0;
  while (n > 0 && guard++ < 4000) { d++; if (wIsWork(d, cal)) n--; }
  return d;
}

/** start + tat working hours → deadline (ms). Mirrors the sheets' LET(...) formula line by line. */
function workAdd(startMs, tatH, cal) {
  if (startMs == null || startMs === '' || isNaN(startMs) || !(tatH >= 0)) return null;
  var open = cal.open, close = cal.close, eps = 1e-7;
  var loc = startMs + W_OFF, sd = Math.floor(loc / W_D), st = (loc - sd * W_D) / W_H, first;
  if (wIsWork(sd, cal)) first = st < open ? sd * 24 + open : (st >= close ? wNext(sd, 1, cal) * 24 + open : sd * 24 + st);
  else first = wNext(sd, 1, cal) * 24 + open;
  var fd = Math.floor(first / 24 + eps), ft = first - fd * 24, avail = close - Math.max(ft, open), res;
  if (tatH <= avail + eps) res = first + tatH;
  else {
    var rem1 = tatH - avail, len = close - open, k = Math.floor(rem1 / len + eps), rem2 = rem1 - k * len;
    if (rem2 < eps) res = wNext(fd, k, cal) * 24 + close;
    else res = wNext(fd, 1 + k, cal) * 24 + open + rem2;
  }
  return Math.round(res * W_H - W_OFF);
}

/** Working hours between a and b (b > a; negative when b < a). */
function workHours(aMs, bMs, cal) {
  if (aMs == null || bMs == null) return 0;
  if (bMs < aMs) return -workHours(bMs, aMs, cal);
  var d0 = wDay(aMs), d1 = wDay(bMs), sum = 0;
  if (d1 - d0 > 800) d0 = d1 - 800;
  for (var d = d0; d <= d1; d++) {
    if (!wIsWork(d, cal)) continue;
    var s = d * W_D - W_OFF + cal.open * W_H, e = d * W_D - W_OFF + cal.close * W_H;
    var lo = Math.max(s, aMs), hi = Math.min(e, bMs);
    if (hi > lo) sum += (hi - lo) / W_H;
  }
  return sum;
}

/** 'over' (past deadline) · 'warn' (less than warnPct % of the step's time left) · 'ok' · 'none' (no deadline yet). */
function dueState(planMs, tatH, nowMs, cal, warnPct) {
  if (!planMs) return 'none';
  if (nowMs > planMs) return 'over';
  var left = workHours(nowMs, planMs, cal);
  var lim = Math.max(1, (tatH || 8) * (warnPct == null ? 30 : warnPct) / 100);
  return left <= lim ? 'warn' : 'ok';
}

/** "3h 20m", "2d 4h" (wall clock). */
function fmtDur(ms) {
  ms = Math.abs(ms);
  var m = Math.round(ms / 60000);
  if (m < 60) return m + 'm';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  var d = Math.floor(h / 24);
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}

/** Names in the sheets are typed by hand: "SURAJ" = "Suraj Kumar" = "suraj ji". */
function nameKey(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ JI$/, '');
}
function namesMatch(a, b) {
  a = nameKey(a); b = nameKey(b);
  if (!a || !b) return false;
  if (a === b) return true;
  var aw = a.split(' '), bw = b.split(' ');
  var s = aw.length <= bw.length ? aw : bw, l = aw.length <= bw.length ? bw : aw;
  return s.join(' ') === l.slice(0, s.length).join(' ');
}

/** What an answer does: 'next' | 'stay' | 'won' | 'lost' | 'back:KEY'. stepRules = { answer: action } of that one step. */
function ruleOf(stepRules, stepKey, answer, isLast) {
  var r = stepRules && stepRules[answer];
  if (!r || r === 'next') return isLast ? 'won' : 'next';
  return r;
}
