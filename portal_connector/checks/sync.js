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
  getLocalLogin_ = () => ({});
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
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const run = () => vm.runInContext('syncUsers_()', ctx);
run(); t('first run pushes both users', st.pushes.join() === 'ramesh.k+,gone.u+');
st.pushes = []; const w = st.writes; run(); t('second run: nothing pushed, no sheet write', st.pushes.length === 0 && st.writes === w);
st.users = st.users.filter(u => u.username !== 'gone.u'); st.pushes = []; run();
t('deleted user switched off once', st.pushes.join() === 'gone.u-' && st.grid.some(r => r[0] === 'gone.u' && r[4] === 'REMOVED'));
st.pushes = []; run(); t('deleted user not pushed again', st.pushes.length === 0);
st.appUp = false; st.users[0].name = 'Ramesh Kumar'; st.pushes = []; run(); run(); run();
t('app down: retried each run', st.pushes.length === 3);
t('app down: logged only once', st.logs.filter(l => l === 'ramesh.k:SYNC_FAIL').length === 1);
st.appUp = true; st.pushes = []; run(); t('app back: pushed and OK', st.pushes.join() === 'ramesh.k+' && st.grid.some(r => r[0] === 'ramesh.k' && r[4] === 'OK'));
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
