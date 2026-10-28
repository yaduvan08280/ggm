/**
 * JPR FLEET DASHBOARD — AUTHENTICATION
 * Version 4.0
 * ------------------------------------------------------------------
 * Email + password login. Default password is 1234 for every new user.
 * Sessions live in a hidden _AUTH sheet and never expire until logout.
 * Password reset is done with a 6-digit OTP emailed to the user.
 *
 * ADMIN WORKFLOW: add a row in the Users sheet with EMAIL + NAME.
 * That's it — the user can log in immediately with password 1234.
 */

// ═══════════════════ HASHING ═══════════════════

function authSalt_() {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('AUTH_SALT');
  if (!salt) {
    salt = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('AUTH_SALT', salt);
  }
  return salt;
}

function hashPassword_(plain) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    authSalt_() + '::' + String(plain),
    Utilities.Charset.UTF_8
  );
  return raw.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}


// ═══════════════════ USER LOOKUP ═══════════════════

function usersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_USERS);
  if (!sh) throw new Error('Sheet "' + SHEET_USERS + '" not found.');
  return sh;
}

/**
 * Finds a user row by email (case-insensitive).
 * Returns { row, cols, data } or null.  data is the raw row array.
 */
function findUser_(email) {
  var sh   = usersSheet_();
  var cols = ensureUserCols_(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  var width = sh.getLastColumn();
  var vals  = sh.getRange(2, 1, lastRow - 1, width).getDisplayValues();
  var target = String(email || '').trim().toLowerCase();
  if (!target) return null;

  for (var i = 0; i < vals.length; i++) {
    var e = String(vals[i][cols.EMAIL - 1] || '').trim().toLowerCase();
    if (e && e === target) {
      return { row: i + 2, cols: cols, data: vals[i], sheet: sh };
    }
  }
  return null;
}


// ═══════════════════ SESSION STORE ═══════════════════

function authSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_AUTH);
  if (!sh) {
    sh = ss.insertSheet(SHEET_AUTH);
    sh.getRange(1, 1, 1, 5)
      .setValues([['TOKEN', 'EMAIL', 'NAME', 'CREATED', 'LAST_SEEN']])
      .setFontWeight('bold');
    sh.hideSheet();
  }
  return sh;
}

function createSession_(email, name) {
  var sh = authSheet_();
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var now = fmtStamp_(new Date());
  sh.appendRow([token, email, name, now, now]);
  return token;
}

/** Returns { email, name, role } for a live token, or null. */
function validateSession_(token) {
  if (!token) return null;
  var tok0 = String(token).trim();
  // GGM Portal: Portal-only accepts only portal sessions ("P…"). While it is OFF, portal, own-link
  // portal ("D…") and old email + password sessions all work.
  if (portalOnly_() && tok0.charAt(0) !== 'P') return null;
  // SPEED: every page call validates; the answer is kept 5 min (cleared on logout / portal switch-off)
  // instead of reading _AUTH and Users each time.
  var ck = 'fs_' + tok0;
  try { var hit = CacheService.getScriptCache().get(ck); if (hit) return JSON.parse(hit); } catch (e) {}
  var sh = authSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  var vals = sh.getRange(2, 1, lastRow - 1, 5).getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(token).trim()) {
      var tok = String(vals[i][0]).trim();
      if ((tok.charAt(0) === 'P' || tok.charAt(0) === 'D') && portalFuelExpired_(vals[i][3])) return null;   // portal sessions expire
      var email = String(vals[i][1]).trim();
      var u = findUser_(email);
      if (!u) return null;
      var status = String(u.data[u.cols.STATUS - 1] || '').trim().toUpperCase();
      if (status === 'DISABLED' || status === 'INACTIVE') return null;
      var name = String(u.data[u.cols.NAME - 1] || '').trim() || email;
      var s = {
        email: email,
        name : name,
        role : String(u.data[u.cols.ROLE - 1] || 'USER').trim().toUpperCase(),
        username: String(u.data[u.cols.USERNAME - 1] || '').trim() || name   // who "filled" a form
      };
      try { CacheService.getScriptCache().put(ck, JSON.stringify(s), 300); } catch (e) {}
      return s;
    }
  }
  return null;
}

/** Throws if the token is not a live session. Used by every write API. */
function requireSession_(token) {
  var s = validateSession_(token);
  if (!s) throw new Error('SESSION_EXPIRED');
  return s;
}


// ═══════════════════ PUBLIC API (called from the browser) ═══════════════════

/**
 * Log in with email + password.
 * A blank PASSWORD cell is treated as the default 1234, so a freshly
 * added user works without the admin touching anything else.
 */
function apiLogin(email, password) {
  // Connected to GGM Portal: the portal username/phone + password are tried first (checked by the hub).
  // While Portal-only is OFF the old email + password keeps working too.
  var portalMsg = '';
  if (portalEnabled_()) {
    try {
      var b = portalRemoteLogin_(email, password);
      return { success: true, token: b.token, name: b.name, email: b.email, role: b.role,
               username: b.username, usingDefaultPassword: false };
    } catch (e) {
      if (portalOnly_()) return { success: false, message: e.message || String(e) };
      portalMsg = e.message || String(e);
    }
  }
  var old = emailLogin_(email, password);
  if (!old.success && portalMsg && /not registered|Enter your email/.test(old.message)) return { success: false, message: portalMsg };
  return old;
}

/** The app's own login: email + password from the Users sheet. */
function emailLogin_(email, password) {
  try {
    email    = String(email || '').trim().toLowerCase();
    password = String(password == null ? '' : password);

    if (!email || !password) {
      return { success: false, message: 'Enter your email and password.' };
    }

    var u = findUser_(email);
    if (!u) {
      return { success: false, message: 'This email is not registered. Ask your admin to add it in the Users sheet.' };
    }

    var status = String(u.data[u.cols.STATUS - 1] || '').trim().toUpperCase();
    if (status === 'DISABLED' || status === 'INACTIVE') {
      return { success: false, message: 'This account has been disabled.' };
    }

    var stored = String(u.data[u.cols.PASSWORD - 1] || '').trim();
    var ok, usingDefault = false;

    if (!stored) {
      // Never logged in: accept the default password and store its hash.
      ok = (password === DEFAULT_PASSWORD);
      if (ok) {
        u.sheet.getRange(u.row, u.cols.PASSWORD).setValue(hashPassword_(DEFAULT_PASSWORD));
        usingDefault = true;
      }
    } else {
      ok = (stored === hashPassword_(password));
      if (ok) usingDefault = (password === DEFAULT_PASSWORD);
    }

    if (!ok) return { success: false, message: 'Wrong password. Try again or use "Forgot password".' };

    var name  = String(u.data[u.cols.NAME - 1] || '').trim() || email;
    var token = createSession_(email, name);

    u.sheet.getRange(u.row, u.cols.LAST_LOGIN).setValue(fmtStamp_(new Date()));
    if (!String(u.data[u.cols.STATUS - 1] || '').trim()) {
      u.sheet.getRange(u.row, u.cols.STATUS).setValue('ACTIVE');
    }
    SpreadsheetApp.flush();

    return {
      success: true,
      token: token,
      name: name,
      email: email,
      role: String(u.data[u.cols.ROLE - 1] || 'USER').trim().toUpperCase(),
      username: String(u.data[u.cols.USERNAME - 1] || '').trim() || name,
      usingDefaultPassword: usingDefault
    };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  }
}

/** Called on app start with the saved token. */
function apiValidateSession(token) {
  try {
    var s = validateSession_(token);
    if (!s) return { success: false };
    return { success: true, name: s.name, email: s.email, role: s.role, username: s.username };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  }
}

function apiLogout(token) {
  try {
    if (!token) return { success: true };
    try { CacheService.getScriptCache().remove('fs_' + String(token).trim()); } catch (e) {}
    var sh = authSheet_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { success: true };
    var vals = sh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0]).trim() === String(token).trim()) {
        sh.deleteRow(i + 2);
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  }
}


// ═══════════════════ PASSWORD RESET (OTP) ═══════════════════

function apiSendResetOtp(email) {
  if (portalOnly_()) return { success: false, message: 'Passwords are managed in GGM Portal. Use "Forgot password?" there.' };
  try {
    email = String(email || '').trim().toLowerCase();
    if (!email) return { success: false, message: 'Enter your email first.' };

    var u = findUser_(email);
    if (!u) {
      return { success: false, message: 'This email is not registered.' };
    }

    var otp = String(Math.floor(100000 + Math.random() * 900000));
    var expiry = new Date(new Date().getTime() + OTP_TTL_MIN * 60000);

    u.sheet.getRange(u.row, u.cols.OTP).setValue("'" + otp);
    u.sheet.getRange(u.row, u.cols.OTP_EXPIRY).setValue(fmtStamp_(expiry));
    SpreadsheetApp.flush();

    var name = String(u.data[u.cols.NAME - 1] || '').trim() || 'there';

    MailApp.sendEmail({
      to: email,
      subject: 'JPR Fleet — your password reset code is ' + otp,
      htmlBody:
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;">' +
          '<div style="font-size:13px;letter-spacing:2px;color:#64748B;font-weight:700;">JPR FLEET</div>' +
          '<h2 style="margin:8px 0 4px;color:#0F172A;">Password reset</h2>' +
          '<p style="color:#475569;font-size:14px;line-height:1.6;">Hi ' + esc_(name) + ', use this code to set a new password.</p>' +
          '<div style="margin:24px 0;padding:18px;background:#EEF2FF;border:1px solid #C7D2FE;border-radius:12px;text-align:center;">' +
            '<div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#4338CA;">' + otp + '</div>' +
          '</div>' +
          '<p style="color:#64748B;font-size:13px;">This code expires in ' + OTP_TTL_MIN + ' minutes. ' +
          'If you did not request it, you can ignore this email — your password stays unchanged.</p>' +
        '</div>',
      name: 'JPR Fleet Dashboard'
    });

    return { success: true, message: 'Code sent to ' + email };
  } catch (e) {
    return { success: false, message: 'Could not send the email: ' + (e.message || e) };
  }
}

function apiResetPassword(email, otp, newPassword) {
  if (portalOnly_()) return { success: false, message: 'Passwords are managed in GGM Portal. Use "Forgot password?" there.' };
  try {
    email = String(email || '').trim().toLowerCase();
    otp   = String(otp || '').trim();
    newPassword = String(newPassword == null ? '' : newPassword);

    if (newPassword.length < 4) {
      return { success: false, message: 'New password must be at least 4 characters.' };
    }

    var u = findUser_(email);
    if (!u) return { success: false, message: 'This email is not registered.' };

    var storedOtp = String(u.data[u.cols.OTP - 1] || '').trim();
    var expStr    = String(u.data[u.cols.OTP_EXPIRY - 1] || '').trim();

    if (!storedOtp) return { success: false, message: 'No code requested. Press "Send code" first.' };
    if (storedOtp !== otp) return { success: false, message: 'That code is not correct.' };

    // Expiry check — "dd/MM/yyyy HH:mm"
    var expOk = true;
    var bits = expStr.split(' ');
    var dPart = parseDMY_(bits[0]);
    if (dPart && bits[1]) {
      var hm = bits[1].split(':');
      dPart.setHours(parseInt(hm[0], 10) || 0, parseInt(hm[1], 10) || 0, 0, 0);
      expOk = (new Date().getTime() <= dPart.getTime());
    }
    if (!expOk) return { success: false, message: 'That code has expired. Request a new one.' };

    u.sheet.getRange(u.row, u.cols.PASSWORD).setValue(hashPassword_(newPassword));
    u.sheet.getRange(u.row, u.cols.OTP).setValue('');
    u.sheet.getRange(u.row, u.cols.OTP_EXPIRY).setValue('');
    SpreadsheetApp.flush();

    return { success: true, message: 'Password updated. You can log in now.' };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  }
}

/** Change password while logged in (no OTP needed). */
function apiChangePassword(token, oldPassword, newPassword) {
  if (portalOnly_()) return { success: false, message: 'Your password is managed in GGM Portal: account menu → Change password.' };
  try {
    var s = requireSession_(token);
    newPassword = String(newPassword == null ? '' : newPassword);
    if (newPassword.length < 4) {
      return { success: false, message: 'New password must be at least 4 characters.' };
    }

    var u = findUser_(s.email);
    if (!u) return { success: false, message: 'User not found.' };

    var stored = String(u.data[u.cols.PASSWORD - 1] || '').trim();
    var ok = stored ? (stored === hashPassword_(oldPassword))
                    : (String(oldPassword) === DEFAULT_PASSWORD);
    if (!ok) return { success: false, message: 'Current password is not correct.' };

    u.sheet.getRange(u.row, u.cols.PASSWORD).setValue(hashPassword_(newPassword));
    SpreadsheetApp.flush();
    return { success: true, message: 'Password changed.' };
  } catch (e) {
    if (String(e.message).indexOf('SESSION_EXPIRED') >= 0) {
      return { success: false, expired: true, message: 'Session expired. Please log in again.' };
    }
    return { success: false, message: e.message || String(e) };
  }
}


// ═══════════════════ ADMIN HELPERS (run from the Sheet menu) ═══════════════════

/** Wipes a user's password back to 1234. */
function adminResetToDefault() {
  portalAssertEditor_();
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Reset password', 'Email of the user to reset to ' + DEFAULT_PASSWORD + ':', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var u = findUser_(res.getResponseText());
  if (!u) { ui.alert('That email is not in the Users sheet.'); return; }

  u.sheet.getRange(u.row, u.cols.PASSWORD).setValue('');
  u.sheet.getRange(u.row, u.cols.OTP).setValue('');
  u.sheet.getRange(u.row, u.cols.OTP_EXPIRY).setValue('');
  ui.alert('Done. That user can now log in with ' + DEFAULT_PASSWORD + '.');
}

/** Signs everyone out everywhere. */
function adminLogoutAllSessions() {
  portalAssertEditor_();
  var sh = authSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow > 1) sh.deleteRows(2, lastRow - 1);
  SpreadsheetApp.getUi().alert('All sessions cleared. Everyone will be asked to log in again.');
}
