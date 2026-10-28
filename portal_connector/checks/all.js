// Runs every portal self-check. Works from any folder:  node portal_connector/checks/all.js
const { spawnSync } = require('child_process'), path = require('path');
let failed = 0;
for (const f of ['tokens', 'inject', 'checklists', 'sync', 'sync_twins', 'indent', 'hub', 'jaipur', 'v2', 'dup', 'import', 'dual', 'desig', 'indent_speed', 'assets', 'fuel_history', 'photos', 'bigupload']) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f + '.js')], { encoding: 'utf8' });
  const out = (r.stdout + r.stderr).trim();
  const bad = r.status !== 0 || /FAIL/.test(out);
  if (bad) failed++;
  console.log((bad ? 'FAIL ' : 'ok   ') + f.padEnd(11) + (out.split('\n').pop() || ''));
  if (bad) console.log(out.split('\n').filter(l => /FAIL|Error/.test(l)).join('\n'));
}
console.log(failed ? failed + ' check file(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
