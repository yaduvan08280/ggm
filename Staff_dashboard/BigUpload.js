/**************************************************************************
 * BIG ATTACHMENTS (up to 50 MB) — shared by the apps that take documents
 * Master copy: portal_connector/BigUpload.js. Copy it unchanged into
 * Main Admin, Staff, Newai and Tonk; never edit one copy alone.
 *
 * Why: one google.script.run call carries roughly 50 MB, and a file sent as
 * text is a third larger, so a 40–50 MB PDF cannot go in one call. Files over
 * 5 MB therefore go straight into Drive in 8 MB pieces (Drive "resumable
 * upload"); the page then sends { filename, mimeType, fileId } instead of the
 * file itself, and the app's own save code takes the file with bigUploadTake_().
 * Smaller files keep travelling exactly as before.
 *
 * Needs: Drive (the app already saves files with DriveApp) and
 * "connect to an external service" (approved for all four apps).
 * Page side: doGet wraps its page with bigUploadPage_(...) which adds
 * window.GGMUpload.pack(file, token) → Promise<{filename, mimeType, base64 | fileId}>.
 **************************************************************************/

var BIG_UPLOAD_MAX = 50 * 1024 * 1024;     // bytes per file
var BIG_UPLOAD_CHUNK = 8 * 1024 * 1024;    // a multiple of 256 KB, as Drive requires
var BIG_UPLOAD_DIRECT = 5 * 1024 * 1024;   // at or under this, the old one-call path is used

/** Where the pieces land; the app's save code then moves the file to its own folder. */
function bigUploadFolder_() {
  return DriveApp.getFolderById(DRIVE_FOLDER_ID);
}

/** Opens a Drive upload for one file. Signed-in people only. */
function bigUploadStart(token, name, mimeType, size) {
  var rec = portalCheck_(token);
  size = Number(size);
  if (!(size > 0)) throw new Error('That file is empty.');
  if (size > BIG_UPLOAD_MAX) throw new Error('Files can be up to 50 MB. This one is ' + Math.ceil(size / 1048576) + ' MB.');
  var meta = {
    name: String(name || 'attachment').slice(0, 200),
    mimeType: String(mimeType || 'application/octet-stream'),
    parents: [bigUploadFolder_().getId()]
  };
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify(meta),
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': meta.mimeType,
      'X-Upload-Content-Length': String(size)
    },
    muteHttpExceptions: true
  });
  var h = res.getHeaders() || {};
  var url = h.Location || h.location;
  if (res.getResponseCode() !== 200 || !url) throw new Error('Google Drive did not accept the upload (' + res.getResponseCode() + '). Try again.');
  var key = Utilities.getUuid();
  CacheService.getScriptCache().put('bu_' + key, JSON.stringify({ url: url, size: size, got: 0, u: rec.u }), 21600);
  return { key: key, chunk: BIG_UPLOAD_CHUNK };
}

/** One piece (base64). Returns { done: false, got } or, after the last piece, { done: true, fileId }. */
function bigUploadChunk(token, key, offset, b64) {
  var rec = portalCheck_(token);
  var cache = CacheService.getScriptCache();
  var st = JSON.parse(cache.get('bu_' + key) || 'null');
  if (!st || st.u !== rec.u) throw new Error('This upload has expired. Attach the file again.');
  if (Number(offset) !== st.got) throw new Error('The upload got out of step. Attach the file again.');
  var bytes = Utilities.base64Decode(String(b64 || ''));
  if (!bytes.length) throw new Error('Empty piece. Attach the file again.');
  var end = st.got + bytes.length - 1;
  if (end >= st.size) throw new Error('The file is larger than announced. Attach it again.');
  var res = UrlFetchApp.fetch(st.url, {
    method: 'put',
    contentType: 'application/octet-stream',
    payload: bytes,
    headers: { 'Content-Range': 'bytes ' + st.got + '-' + end + '/' + st.size },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code === 308) {
    st.got = end + 1;
    cache.put('bu_' + key, JSON.stringify(st), 21600);
    return { done: false, got: st.got };
  }
  if (code === 200 || code === 201) {
    var id = JSON.parse(res.getContentText()).id;
    cache.remove('bu_' + key);
    cache.put('bf_' + id, rec.u, 21600);          // only files made here can be attached (see bigUploadTake_)
    return { done: true, fileId: id };
  }
  throw new Error('Google Drive stopped the upload (' + code + '). Try again.');
}

/** For the app's save code: a file the page uploaded in pieces → moved to `folder`, shared like the others, its link returned.
 *  Refuses any other Drive file id, so nobody can attach (and make public) a file that was not just uploaded. */
function bigUploadTake_(f, folder) {
  var id = String((f && f.fileId) || '');
  if (!id || !CacheService.getScriptCache().get('bf_' + id)) throw new Error('An attachment upload has expired. Attach the file again.');
  var file = DriveApp.getFileById(id);
  if (folder && folder.getId() !== bigUploadFolder_().getId()) file.moveTo(folder);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return file.getUrl();
}

/** Adds the page helper (window.GGMUpload) to an HtmlOutput before portalInject_. */
function bigUploadPage_(out) {
  var tag = '<script>(' + bigUploadKit_.toString() + ')(' + BIG_UPLOAD_DIRECT + ',' + BIG_UPLOAD_MAX + ');' + String.fromCharCode(60) + '/script>';
  var html = out.getContent();
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, function (m) { return tag + m; }) : tag + html;
  return HtmlService.createHtmlOutput(html);
}

/** Runs in the browser, never on the server. */
function bigUploadKit_(DIRECT, MAX) {
  if (window.GGMUpload) return;
  function readB64(blob) {
    return new Promise(function (ok, bad) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { bad(new Error('Could not read the file.')); };
      r.readAsDataURL(blob);
    });
  }
  function call(fn, args) {
    return new Promise(function (ok, bad) {
      var run = google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) { bad(e instanceof Error ? e : new Error(String((e && e.message) || e))); });
      run[fn].apply(run, args);
    });
  }
  var bar = null;
  function progress(name, pct) {
    if (!bar) {
      bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147482000;background:#111827;color:#fff;' +
        'padding:10px 16px;border-radius:12px;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3);min-width:240px;max-width:90vw';
      bar.innerHTML = '<div></div><div style="height:6px;background:rgba(255,255,255,.2);border-radius:4px;margin-top:8px;overflow:hidden"><i style="display:block;height:100%;width:0;background:#34D399;transition:width .2s"></i></div>';
      document.body.appendChild(bar);
    }
    bar.firstChild.textContent = 'Uploading ' + name + ' — ' + pct + '%';
    bar.querySelector('i').style.width = pct + '%';
    bar.style.display = 'block';
  }
  function done() { if (bar) bar.style.display = 'none'; }

  /** { filename, mimeType, base64 } for small files (as before); bigger ones go to Drive first → { filename, mimeType, fileId }. */
  function pack(file, token) {
    var name = file.name || 'attachment', type = file.type || 'application/octet-stream';
    if (file.size > MAX) return Promise.reject(new Error(name + ' is ' + Math.ceil(file.size / 1048576) + ' MB. Files can be up to 50 MB.'));
    if (file.size <= DIRECT) return readB64(file).then(function (b64) { return { filename: name, mimeType: type, base64: b64 }; });
    return call('bigUploadStart', [token, name, type, file.size]).then(function (s) {
      var off = 0;
      function next() {
        progress(name, Math.round(off * 100 / file.size));
        return readB64(file.slice(off, off + s.chunk)).then(function (b64) {
          return call('bigUploadChunk', [token, s.key, off, b64]);
        }).then(function (r) {
          if (r.done) { done(); return { filename: name, mimeType: type, fileId: r.fileId }; }
          off = r.got;
          return next();
        });
      }
      return next();
    }).catch(function (e) { done(); throw e; });
  }
  window.GGMUpload = { pack: pack, max: MAX };
}
