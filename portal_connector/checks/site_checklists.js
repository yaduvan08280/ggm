// Staff Dashboard: a doer name starting "JPR -", "NEWAI -" or "TONK -" also puts the person on that
// site's checklist Doer List; any other prefix stays Staff Dashboard only.
const vm = require('vm'), fs = require('fs'), path = require('path');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

const JPR = '15KTN4Ptp_K1iRPt3fmssGjC39ttKJx-MFMWOj-SjADg', NEWAI = '1s51ECvMoG-H3wgUsQhGOEmhFjlH_N4ZH4N8-iH1QoJU',
      TONK = '1FT2ZCdzMIpqw2LQjs5l5zbCX6d1ir5mpm6Bux3dlA3Q', DEL = '1tEUckPww1GiD-PgP7yxMxt70W1Q-ueoUGXdI8_-Aq8A';
const head = ['Name', 'Department', 'Email Address', 'Username', 'Password'];
const books = {
  [JPR]: [head, ['VIPIN GOYAL', 'NEWAI PLANT HEAD', '', 9672483000, '123456'], ['RAJPAL', 'HR', 'hr@x.com', 9928225809, '123456']],
  [NEWAI]: [head, ['DEEPAK SHARMA', 'STORE', '', 9799019943, '1']],
  [TONK]: [head, ['SHOJI RAM', 'DRIVER', '', 1111111111, '1']],
  [DEL]: [['Name', 'Number', 'Email', 'Full']]
};
const sheet = id => ({
  getLastRow: () => books[id].length,
  getRange: (r, c, nr, nc) => ({ getValues: () => books[id].slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }),
  appendRow: row => books[id].push(row.slice())
});
const opened = {};
const ctx = vm.createContext({ console, String, Object, Array, JSON, Math, Date,
  ROUTINE_SHEET_ID: JPR, NEWAI_ROUTINE_SHEET_ID: NEWAI, DELEGATED_SHEET_ID: DEL,
  SpreadsheetApp: { openById: id => (opened[id] = (opened[id] || 0) + 1, { getSheetByName: n => (n === 'Doer List' && books[id] ? sheet(id) : null) }) },
  Utilities: { getUuid: () => 'abcdef12-3456-7890-abcd-ef1234567890' },
  Logger: { log: () => {} },
  _loadDelegated: () => ({ doers: books[DEL].slice(1).map(r => r[3]) }), _invalidate: () => {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'Staff_dashboard', 'PortalApp.js'), 'utf8'), ctx);
const R = c => vm.runInContext(c, ctx);
const last = id => books[id][books[id].length - 1];

const p = R(`staffDoerParts_('JPR - SANIYA (INTERN) - 8302684274', '')`);
t('doer name is read: site, name, department, mobile', p.site === 'JPR' && p.name === 'SANIYA' && p.dept === 'INTERN' && p.mobile === '8302684274');
const q = R(`staffDoerParts_('TONK- RAJESH JI', '+91 96025 86065')`);
t('"TONK- NAME" without a space and the mobile from the phone field', q.site === 'TONK' && q.name === 'RAJESH JI' && q.dept === '' && q.mobile === '9602586065');

let msg = R(`portalStaffProvision_({ active: true, doer: 'JPR - SANIYA (INTERN) - 8302684274', phone: '8302684274', email: 's@x.com' })`);
const row = last(JPR);
t('JPR person: added to the Staff Doer List and the Jaipur checklist', /added to Doer List; added to the Jaipur checklist/.test(msg) && row[0] === 'SANIYA' && row[1] === 'INTERN' && row[2] === 's@x.com' && row[3] === '8302684274');
t('...with a random password, never blank', row[4] && row[4] !== '123456' && row[4].length === 12);
const n = books[JPR].length;
msg = R(`portalStaffProvision_({ active: true, doer: 'JPR - SANIYA (INTERN) - 8302684274', phone: '8302684274' })`);
t('second sync: not added twice', books[JPR].length === n && /on the Jaipur checklist/.test(msg));
R(`portalStaffProvision_({ active: true, doer: 'NEWAI - ABDUL KHAN', phone: '7230008889' })`);
t('NEWAI person goes to the Newai checklist only', last(NEWAI)[0] === 'ABDUL KHAN' && !books[JPR].some(r => r[0] === 'ABDUL KHAN') && !books[TONK].some(r => r[0] === 'ABDUL KHAN'));
R(`portalStaffProvision_({ active: true, doer: 'TONK - LALIT MEENA (MINES MANAGER)', phone: '8696463535' })`);
t('TONK person goes to the Tonk checklist', last(TONK)[0] === 'LALIT MEENA' && last(TONK)[1] === 'MINES MANAGER');
const before = JSON.stringify([books[JPR].length, books[NEWAI].length, books[TONK].length]);
msg = R(`portalStaffProvision_({ active: true, doer: 'KACHOLA - RAMESH (STORE)', phone: '9000000000' })`);
t('any other prefix: Staff Dashboard only', JSON.stringify([books[JPR].length, books[NEWAI].length, books[TONK].length]) === before && msg === 'added to Doer List');
R(`portalStaffProvision_({ active: true, doer: 'JPR - VIPIN', phone: '' })`);
R(`portalStaffProvision_({ active: true, doer: 'TONK - SHOJI RAM JI', phone: '' })`);
t('already there under a longer name / with "JI": no duplicate', books[JPR].filter(r => /^VIPIN/.test(r[0])).length === 1 && books[TONK].filter(r => /^SHOJI/.test(r[0])).length === 1);
t('a signed-out person is not added anywhere', R(`portalStaffProvision_({ active: false, doer: 'JPR - NEW GUY', phone: '9111111111' })`) === 'signed out' && !books[JPR].some(r => r[0] === 'NEW GUY'));

t('each checklist is opened once per run, however many people', opened[JPR] === 1 && opened[TONK] === 1 && opened[NEWAI] === 1);

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
