// Indent user sync: a blank phone/email in the portal must not wipe what Indent has.
const vm = require('vm'), fs = require('fs'), path = require('path');
const row = { __row: 2, User_ID: 'RAMESH.K', Name: 'Ramesh', Role: 'STORE', Site: 'TONK', Phone: '9829011111', Email: 'r@ggm.com', Active: 'TRUE' };
let patched = null;
const ctx = vm.createContext({ String, Object, JSON,
  ROLES: ['ADMIN', 'STORE', 'PURCHASE', 'PC', 'USER'], SH: { USERS: 'Users' },
  safeStr_: v => v == null ? '' : String(v).trim(), truthy_: v => /^(true|yes|1)$/i.test(String(v)),
  normaliseUserSite_: (r, s) => s, findBy_: () => row, update_: (n, r, p) => { patched = p; }, insert_: () => {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'indent_flow', '13_Portal.js'), 'utf8'), ctx);
const msg = vm.runInContext(`portalIndentProvision_({ localId: 'ramesh.k', name: 'Ramesh Kumar', role: 'STORE', site: 'TONK', phone: '', email: '', active: true })`, ctx);
const ok = msg === 'updated' && patched && !('Phone' in patched) && !('Email' in patched) && patched.Name === 'Ramesh Kumar';
console.log(ok ? 'PASS blank phone/email kept, name updated' : 'FAIL ' + msg + ' ' + JSON.stringify(patched));
patched = null;
const same = vm.runInContext(`portalIndentProvision_({ localId: 'ramesh.k', name: 'Ramesh', role: 'STORE', site: 'TONK', phone: '9829011111', email: 'r@ggm.com', active: true })`, ctx);
console.log(same === 'already up to date' && !patched ? 'PASS unchanged user: no write' : 'FAIL ' + same);
