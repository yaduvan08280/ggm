// 50 MB attachments: files over 5 MB go to Drive in 8 MB pieces (resumable upload),
// only signed-in people can upload, and only a file that was just uploaded can be attached.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const SRC = fs.readFileSync(path.join(ROOT, 'portal_connector', 'BigUpload.js'), 'utf8');

const APPS = ['main_admin_dashboard', 'Staff_dashboard', 'newai_checklist', 'tonk_checklist'];
APPS.forEach(a => t(a + ' has the master BigUpload.js', fs.readFileSync(path.join(ROOT, a, 'BigUpload.js'), 'utf8') === SRC));
APPS.forEach(a => {
  const code = fs.readFileSync(path.join(ROOT, a, 'Code.js'), 'utf8');
  t(a + ': page gets the helper, save code takes uploaded files', /portalInject_\(bigUploadPage_\(/.test(code) && /bigUploadTake_\(f, folder\)/.test(code));
});
const pages = { main_admin_dashboard: 'Index.html', Staff_dashboard: 'Index.html', newai_checklist: 'index.html', tonk_checklist: 'index.html' };
APPS.forEach(a => {
  const h = fs.readFileSync(path.join(ROOT, a, pages[a]), 'utf8');
  t(a + ': limit is 50 MB, no 3/8 MB cap left', /50 \* 1024 \* 1024/.test(h) && !/\b(3|8) \* 1024 \* 1024/.test(h) && /GGMUpload\.pack\(/.test(h));
});
t('indent: photo limit 50 MB', /f\.size > 50 \* 1024 \* 1024/.test(fs.readFileSync(path.join(ROOT, 'indent_flow', 'Scripts.html'), 'utf8')));

/* ---------- server, with fake Drive ---------- */
const cache = {}, puts = [], files = {}; let moved = null, shared = null, sessions = 0;
const ctx = vm.createContext({ JSON, String, Number, Math, Object, Array, Error,
  DRIVE_FOLDER_ID: 'STAGE',
  portalCheck_: tok => { if (tok !== 'good') throw new Error('SESSION_EXPIRED'); return { u: 'harshit' }; },
  CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  ScriptApp: { getOAuthToken: () => 'oauth' },
  Utilities: { getUuid: () => 'key1', base64Decode: s => Array.from(Buffer.from(s, 'base64')) },
  DriveApp: { Access: { ANYONE_WITH_LINK: 'a' }, Permission: { VIEW: 'v' },
    getFolderById: id => ({ getId: () => id }),
    getFileById: id => { if (!files[id]) throw new Error('no file'); return { moveTo: f => { moved = f.getId(); }, setSharing: () => { shared = id; }, getUrl: () => 'https://drive/' + id }; } },
  UrlFetchApp: { fetch: (url, o) => {
    if (o.method === 'post') { sessions++; return { getResponseCode: () => 200, getHeaders: () => ({ Location: 'https://upload/session1' }), getContentText: () => '' }; }
    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(o.headers['Content-Range']); puts.push(o.payload.length);
    const last = +m[2] + 1 === +m[3];
    if (last) files.F1 = true;
    return { getResponseCode: () => (last ? 200 : 308), getHeaders: () => ({}), getContentText: () => (last ? '{"id":"F1"}' : '') };
  } },
  HtmlService: { createHtmlOutput: h => ({ html: h }) } });
vm.runInContext(SRC, ctx);
const R = c => vm.runInContext(c, ctx);
const thr = c => { try { R(c); return ''; } catch (e) { return e.message; } };

t('no upload without a sign-in', /SESSION_EXPIRED/.test(thr(`bigUploadStart('bad', 'a.pdf', 'application/pdf', 1000)`)));
t('over 50 MB refused with the size in the message', /up to 50 MB\. This one is 51 MB/.test(thr(`bigUploadStart('good', 'a.pdf', 'application/pdf', ${51 * 1048576})`)));
const s = R(`bigUploadStart('good', 'big.pdf', 'application/pdf', 20000000)`);
t('start opens one Drive upload, pieces of 8 MB', s.key === 'key1' && s.chunk === 8 * 1048576 && sessions === 1);
const piece = n => Buffer.alloc(n, 7).toString('base64');
const c1 = R(`bigUploadChunk('good', 'key1', 0, '${piece(8 * 1048576)}')`);
t('piece 1 accepted, Drive says continue', c1.done === false && c1.got === 8 * 1048576);
t('a piece out of order is refused', /out of step/.test(thr(`bigUploadChunk('good', 'key1', 0, '${piece(10)}')`)));
t('another person cannot continue my upload', /expired/.test(thr(`(function(){ portalCheck_ = function(){ return { u: 'someone' }; }; try { return bigUploadChunk('x', 'key1', ${8 * 1048576}, 'AA=='); } finally { portalCheck_ = function (tok) { if (tok !== 'good') throw new Error('SESSION_EXPIRED'); return { u: 'harshit' }; }; } })()`)));
R(`bigUploadChunk('good', 'key1', ${8 * 1048576}, '${piece(8 * 1048576)}')`);
const c3 = R(`bigUploadChunk('good', 'key1', ${16 * 1048576}, '${piece(20000000 - 16 * 1048576)}')`);
t('last piece finishes the file', c3.done === true && c3.fileId === 'F1' && puts.join() === [8 * 1048576, 8 * 1048576, 20000000 - 16 * 1048576].join());
t('an existing private Drive file cannot be attached by id', /expired/.test(thr(`bigUploadTake_({ fileId: 'SOMEONES_PRIVATE_FILE' }, null)`)));
const url = R(`bigUploadTake_({ fileId: 'F1' }, { getId: function () { return 'RENEWALS'; } })`);
t('uploaded file moved to the app folder, shared like other attachments, link returned', url === 'https://drive/F1' && moved === 'RENEWALS' && shared === 'F1');
const page = R(`bigUploadPage_({ getContent: function () { return '<html><head><title>x</title></head><body></body></html>'; } })`).html;
t('page helper added before </head> with the 5 MB / 50 MB limits', /\)\(5242880,52428800\);<\/script><\/head>/.test(page) && page.split('</script>').length === 2);

console.log(ok + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
