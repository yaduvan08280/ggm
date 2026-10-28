// Designations → Access / Sheets / Forms, and the portal's Sheets / Forms menus.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'main hub app', 'Code.js'), 'utf8'), ctx);
const R = c => vm.runInContext(c, ctx);
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message || e)); } };

// ---- fake tabs
ctx.T = {
  Access: [['USER', '', 'PURCHASE', '', '', 'STAFF', '', 'MINES', 'SYNC'],
           ['Username', 'Name', '✓', 'Role', 'Site', '✓', 'Doer name', '✓', 'Status'],
           ['ramesh', 'Ramesh', false, '', '', true, 'JPR - RAMESH', false, ''],
           ['mohan', 'Mohan', false, '', '', false, '', false, ''],
           ['sita', 'Sita', true, 'ADMIN', '', false, '', false, '']],
  Designations: [['DESIGNATION', 'PURCHASE', '', 'STAFF', 'MINES'],
                 ['Designation', '✓', 'Role', '✓', '✓'],
                 ['Store Keeper', true, 'STORE', true, false],
                 ['Supervisor', false, '', true, true]],
  Sheets: [['Name', 'Link', 'Site', 'Designation', 'ramesh', 'mohan', 'sita'],
           ['', '', '', '', 'Ramesh', 'Mohan', 'Sita'],
           ['Stock Register', 'https://docs.google.com/spreadsheets/d/AAA/edit', 'TONK', 'Store Keeper', false, false, false],
           ['Diesel Log', 'https://docs.google.com/spreadsheets/d/BBB/edit', 'NEWAI', '', false, false, true],
           ['No Link Yet', '', '', '', true, false, false]],
  Forms: [['Name', 'Link', 'Site', 'Designation', 'ramesh', 'mohan', 'sita'],
          ['', '', '', '', 'Ramesh', 'Mohan', 'Sita'],
          ['Daily Report', 'https://docs.google.com/forms/d/e/CCC/viewform', '', '', false, false, false]],
  'Designation Links': [['DESIGNATION', 'SHEETS', '', 'FORMS'],
                        ['Designation', 'Stock Register', 'Diesel Log', 'Daily Report'],
                        ['Store Keeper', true, false, true],
                        ['Supervisor', false, true, false]]
};
ctx.USERS = [{ username: 'ramesh', name: 'Ramesh', designation: '' }, { username: 'mohan', name: 'Mohan', designation: 'Supervisor' }, { username: 'sita', name: 'Sita', designation: 'Supervisor' }];
R(`
  forgetTabs_ = () => { MEMO_ = {}; }; log_ = () => {};
  values_ = tab => T[tab.name].map(r => r.slice());
  allUsers_ = () => USERS;
  sheet_ = tab => ({ getDataRange: () => ({ getValues: () => T[tab.name].map(r => r.slice()) }),
                     getRange: (r, c) => ({ setValue: v => { T[tab.name][r - 1][c - 1] = v; } }) });
  requireSession_ = s => ({ username: s, name: s });
  PORTAL_CFG.LOG_OPENS = false;
`);

// 1. picking a designation
R(`applyDesignation_('ramesh', 'Store Keeper', '')`);
const A = ctx.T.Access, S = ctx.T.Sheets, F = ctx.T.Forms;
t('Store Keeper → Purchase ticked with role STORE', A[2][2] === true && A[2][3] === 'STORE');
t('Store Keeper → Staff kept (already ticked, doer untouched)', A[2][5] === true && A[2][6] === 'JPR - RAMESH');
t('Store Keeper → Stock Register sheet and Daily Report form ticked', S[2][4] === true && F[2][4] === true);
t('…but not Diesel Log (not for Store Keeper)', S[3][4] === false);

// 2. changing designation: removes only what the old one gave
ctx.T.Sheets[4][4] = true;                                 // a sheet ticked by hand earlier
R(`applyDesignation_('ramesh', 'Supervisor', 'Store Keeper')`);
t('→ Supervisor: Purchase (old only) unticked, Mines ticked', A[2][2] === false && A[2][7] === true);
t('→ Supervisor: Staff stays (both have it)', A[2][5] === true);
t('→ Supervisor: Stock Register removed, Diesel Log added', S[2][4] === false && S[3][4] === true);
t('→ Supervisor: Daily Report form removed (old only)', F[2][4] === false);
t('→ a sheet ticked by hand stays', S[4][4] === true);

// 3. editing a designation applies to everyone with it
ctx.USERS[0].designation = 'Supervisor';
R(`applyDesignationCell_('Supervisor', 'PURCHASE', 'tick', true)`);
t('Supervisor gets Purchase → all 3 supervisors ticked', A[2][2] === true && A[3][2] === true && A[4][2] === true);
R(`applyDesignationCell_('Supervisor', 'PURCHASE', 'role', 'PURCHASE')`);
t('Supervisor role PURCHASE → set for all (overwrites Sita ADMIN)', A[2][3] === 'PURCHASE' && A[4][3] === 'PURCHASE');
R(`applyDesignationCell_('Supervisor', 'PURCHASE', 'role', '')`);
t('clearing the designation role does not clear people roles', A[3][3] === 'PURCHASE');
R(`applyDesigLinkCell_('Supervisor', 'form', 'Daily Report', true)`);
t('Daily Report ticked for Supervisor → all supervisors get it', F[2][4] === true && F[2][5] === true && F[2][6] === true);
R(`applyDesigLinkCell_('Supervisor', 'form', 'Daily Report', false)`);
t('…and unticked for all', F[2][4] === false && F[2][5] === false && F[2][6] === false);

// 4. portal menus
R(`MEMO_ = {}`);
const items = R(`JSON.stringify(linkItemsFor_('sheet', 'sita'))`);
t('Sita sees only her ticked sheets, with names and site, no links', items === JSON.stringify([{ name: 'Diesel Log', site: 'NEWAI', desig: '' }]));
t('a ticked row without a link is not shown', !/No Link Yet/.test(R(`JSON.stringify(linkItemsFor_('sheet', 'ramesh'))`)));
t('openLink gives the link to a ticked person', R(`openLink('sita', 'sheet', 'diesel log').url`) === 'https://docs.google.com/spreadsheets/d/BBB/edit');
t('openLink refuses someone not ticked', throws(() => R(`openLink('sita', 'sheet', 'Stock Register')`), /do not have access/));
t('openLink refuses an unknown kind', throws(() => R(`openLink('sita', 'video', 'x')`), /Unknown item/));

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
