const vm = require('vm'), fs = require('fs'), crypto = require('crypto');
const toSigned = buf => Array.from(buf).map(b => b > 127 ? b - 256 : b);
const toBuf = x => Buffer.isBuffer(x) ? x : typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(b => b & 255));
const Utilities = {
  Charset: { UTF_8: 'utf8' },
  base64EncodeWebSafe: (x) => toBuf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64DecodeWebSafe: (s) => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
  computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
  newBlob: (x) => ({ getDataAsString: () => toBuf(x).toString('utf8'), getBytes: () => toSigned(toBuf(x)) }),
  getUuid: () => crypto.randomUUID()
};
const props = {};
const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, getProperties: () => Object.assign({}, props), setProperty: (k, v) => { props[k] = v; } }) };
const ctx = vm.createContext({ Utilities, PropertiesService, console, JSON, Math, Date, String, Number, Object, Array, Buffer });
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', '..', 'main hub app', 'Code.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', '..', 'portal_connector/Portal.js'), 'utf8'), ctx);
const r = (code) => vm.runInContext(code, ctx);
let ok = 0, bad = 0; const t = (name, cond) => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

r(`var SECRET = 'abc123secret'; var now = Math.floor(Date.now()/1000);`);
t('hub pass -> app reads it', r(`var tok = signToken_({t:'l',a:'INDENT',u:'ramesh.k',n:'Ramesh Kumar — ₹ test',exp:now+90}, SECRET); var p = portalRead_(tok, SECRET); p && p.u==='ramesh.k' && p.n==='Ramesh Kumar — ₹ test'`));
t('app message -> hub reads it', r(`var p2 = readToken_(portalSign_({t:'a',a:'FUEL',op:'verify',data:{id:'x'},exp:now+60}, SECRET), SECRET); p2 && p2.op==='verify' && p2.data.id==='x'`));
t('wrong secret rejected', r(`portalRead_(signToken_({t:'l',exp:now+90}, SECRET), 'other') === null`));
t('tampered body rejected', r(`var tk = signToken_({t:'l',u:'a',exp:now+90}, SECRET).split('.'); var forged = Utilities.base64EncodeWebSafe(JSON.stringify({t:'l',u:'boss',exp:now+90})).replace(/=+$/,'') + '.' + tk[1]; portalRead_(forged, SECRET) === null`));
t('expired pass rejected', r(`portalRead_(signToken_({t:'l',exp:now-1}, SECRET), SECRET) === null`));
t('portalEnabled_ false without secret', r(`portalEnabled_() === false`));
r(`PropertiesService.getScriptProperties().setProperty('PORTAL_SECRET','s'); PORTAL_P_ = null;`);
t('portalEnabled_ true with secret', r(`portalEnabled_() === true && portalOnly_() === false`));
t('colLetter_', r(`colLetter_(1)==='A' && colLetter_(26)==='Z' && colLetter_(27)==='AA' && colLetter_(53)==='BA'`));
t('suggestUsername_', r(`suggestUsername_('JPR-Ramesh Kumar (Store)')==='ramesh.k' && suggestUsername_('Mohan')==='mohan'`));
t('maskEmail_', r(`maskEmail_('ramesh.k@ggminerals.com')==='r•••••@ggminerals.com'`));
t('access layout: new 2-row header', r(`var LAY = accessLayout_([['USER','','INDENT','','','FUEL','STAFF','','SYNC'],['Username','Name','✓','Role','Site','✓','✓','Doer name','Status'],['ramesh.k','R',true,'STORE','TONK',false,true,'JPR-R','']]); LAY.apps.INDENT.tick===2 && LAY.apps.INDENT.role===3 && LAY.apps.INDENT.site===4 && LAY.apps.FUEL.tick===5 && LAY.apps.STAFF.doer===7 && LAY.status===8 && LAY.dataStart===2`));
t('access layout: old 1-row header migrates', r(`var O = accessLayout_([['Username','Name','INDENT','FUEL'],['ramesh.k','R',true,false]]); O.old && O.dataStart===1 && O.apps.FUEL.tick===3`));
console.log(ok + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
