const vm = require('vm'), fs = require('fs');
const ctx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array });
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', '..', 'main hub app', 'Code.js'), 'utf8'), ctx);
const st = { grid: [['Username','App','Local ID','Wanted','Status','Message','Last Sync','Hash']], writes: 0, logs: [], pushes: [], appUp: true,
             users: [{ username: 'ramesh.k', name: 'Ramesh', phone: '9829011111', email: '', active: true }, { username: 'gone.u', name: 'Gone', phone: '', email: '', active: true }] };
ctx.ST = st;
vm.runInContext(`
  const APP = { id: 'INDENT', fields: ['role'], matchBy: 'username' };
  connectedApps_ = () => [APP];
  listsMap_ = () => ({});
  accessMap_ = () => ({ 'ramesh.k': { INDENT: { on: true, role: 'STORE' } }, 'gone.u': { INDENT: { on: true, role: 'USER' } } });
  allUsers_ = () => ST.users;
  getLocalLogin_ = () => ({ local: 'SAME.ID' });
  writeAccessStatus_ = () => {};
  hashOf_ = o => JSON.stringify(o);
  log_ = (u, a) => ST.logs.push(u + ':' + a);
  callAppsParallel_ = jobs => jobs.map(j => { ST.pushes.push(...j.data.users.map(w => w.username + (w.active ? '+' : '-')));
    return ST.appUp ? { ok: true, data: j.data.users.map(w => ({ username: w.username, ok: true, msg: 'ok' })) } : { ok: false, error: 'down' }; });
  sheet_ = () => ({
    getDataRange: () => ({ getValues: () => ST.grid.map(r => r.slice()) }),
    getLastRow: () => ST.grid.length,
    getRange: (r, c, nr, nc) => ({ clearContent: () => { ST.grid.length = 1; }, setValues: v => { ST.writes++; ST.grid.length = 1; v.forEach(x => ST.grid.push(x.slice())); } })
  });`, ctx);
vm.runInContext('syncUsers_()', ctx);
const blocked = st.grid.filter(r => r[4] === 'BLOCKED' && /also used by/.test(r[5])).length;
console.log(st.pushes.length === 0 && blocked === 2 ? 'PASS shared app id: both rows blocked, nothing pushed' : 'FAIL ' + JSON.stringify(st.grid));
