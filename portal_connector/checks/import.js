// "Give access as the apps have it": Import tab → Access grid (adds only, dropdown-safe).
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'main hub app', 'Code.js'), 'utf8'), ctx);
const R = c => vm.runInContext(c, ctx);
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const H1 = ['USER', '', 'PURCHASE', '', '', 'JAIPUR CHECKLIST', '', '', 'STAFF DASHBOARD', '', 'SYNC'];
const H2 = ['Username', 'Name', '✓', 'Role', 'Site', '✓', 'Role', 'Doer name', '✓', 'Doer name', 'Status'];
ctx.ACC = [H1, H2,
  ['admin', 'Nikhil', true, 'ADMIN', '', false, '', '', false, '', '✓'],
  ['AAYUSHI', 'Aayushi', false, '', '', false, '', '', true, 'JPR - AAYUSHI', '✓'],
  ['ABHISHEK KUMAWAT', 'Abhishek', false, '', '', false, '', '', false, '', '']];
ctx.IMP = [['Source App', 'Local ID', 'Name', 'Phone', 'Email', 'Role', 'Site', 'Suggested Username', 'Match'],
  ['JAIPUR CHECKLIST', 'NIKHIL YADAV', 'NIKHIL YADAV', '8569966304', '', 'USER', '', 'admin', 'phone'],
  ['JAIPUR CHECKLIST', 'AAYUSHI KHANDELWAL', 'A', '9680827521', '', 'USER', '', 'AAYUSHI', 'phone'],
  ['STAFF DASHBOARD', 'JPR - AAYUSHI OTHER', 'A', '9680827521', '', '', '', 'AAYUSHI', 'phone'],
  ['JAIPUR CHECKLIST', 'ABHISHEK KUMAWAT', 'ABHISHEK KUMAWAT', '9999999999', '', 'USER', '', 'abhishek.k', 'new'],
  ['NEWAI CHECKLIST', 'DINESH', 'DINESH', '8619001832', '', 'SORTER', '', 'dinesh', 'new'],
  ['PURCHASE', 'ADMIN', 'Nikhil', '8569966304', '', 'PURCHASE', 'ALL', 'admin', 'phone']];
ctx.WROTE = [];
R(`
  syncAccessLocked_ = () => {}; log_ = () => {}; forgetTabs_ = () => {};
  SpreadsheetApp = { flush: () => {} };
  allUsers_ = () => [{ username: 'admin', phone: '8569966304' }, { username: 'AAYUSHI', phone: '9680827521' }, { username: 'ABHISHEK KUMAWAT', phone: '8302445019' }];
  listsMap_ = () => ({ PURCHASE_SITES: { values: ['NEWAI', 'TONK'] }, PURCHASE_ROLES: { values: ['ADMIN', 'PURCHASE'] }, 'JAIPUR CHECKLIST_ROLES': { values: ['User', 'ADMIN'] } });
  values_ = tab => tab === TABS.IMPORT ? IMP.map(r => r.slice()) : ACC.map(r => r.slice());
  sheet_ = () => ({ getDataRange: () => ({ getValues: () => ACC.map(r => r.slice()) }),
                    getRange: (r, c) => ({ setValue: v => { WROTE.push([r, c, v]); } }) });
`);
const res = R(`applyImport_()`);
const W = ctx.WROTE, at = (r, c) => (W.find(x => x[0] === r && x[1] === c) || [])[2];
// sheet rows: admin 3, AAYUSHI 4, ABHISHEK 5; 1-based columns: Purchase site 5, Jaipur ✓ 6, role 7, doer 8, Staff doer 10
t('admin: Jaipur ticked, role in the list spelling (User), doer NIKHIL YADAV', at(3, 6) === true && at(3, 7) === 'User' && at(3, 8) === 'NIKHIL YADAV');
t('site "ALL" not in the dropdown: left empty and reported', at(3, 5) === undefined && res.kept.some(k => /site "ALL" is not in the dropdown/.test(k)));
t('existing Purchase role kept and reported', res.kept.some(k => /PURCHASE · admin: role "ADMIN"/.test(k)));
t('AAYUSHI: Jaipur set, existing Staff doer not rewritten', at(4, 6) === true && at(4, 10) === undefined);
t('ABHISHEK KUMAWAT linked by username (placeholder phone)', at(5, 6) === true && at(5, 8) === 'ABHISHEK KUMAWAT');
t('DINESH: not in Users → listed', res.unmatched.some(u => /DINESH/.test(u)));
t('only changed cells are written', W.length === res.ticked + res.filled);
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
