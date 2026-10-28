"""
safe_push.py - the only way an Apps Script app in this folder gets deployed.

    python portal_connector/safe_push.py <app folder> "main app N" <deploymentId> [<deploymentId> ...]
    python portal_connector/safe_push.py <app folder> "main app N" <ids...> --ack <code>

Why: in Oct 2026 two pushes were built from local copies older than what was live,
and silently dropped working features (Assets transfer logic, Indent IMS push).
A push replaces the WHOLE project, so before anything is sent this script:

  1. pulls the editor copy (HEAD) and the NEWEST saved version into a scratch folder
  2. refuses if any file or function in either of them is missing locally
  3. lists every line of code that exists in the newest version / HEAD but would be
     gone after this push, and refuses until those exact lines are acknowledged
     with --ack <code> (the code is printed; it changes whenever the list changes,
     so an old acknowledgement can never wave through a new loss)
  4. runs every automated check (portal_connector/checks/all.js)
  5. pushes, creates the version "<description>", points each deployment at it
     (same URLs), and shows the deployments.
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # clasp prints box-drawing characters
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CODE_EXT = ('.js', '.gs', '.html')


def run(cmd, cwd=None, check=True):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace', shell=(os.name == 'nt'))
    if check and p.returncode != 0:
        sys.exit('FAILED: %s\n%s%s' % (' '.join(cmd), p.stdout, p.stderr))
    return p.stdout + p.stderr


def pull(app_dir, dest, version=None):
    os.makedirs(dest, exist_ok=True)
    shutil.copy(os.path.join(app_dir, '.clasp.json'), dest)
    cmd = ['clasp', 'pull'] + (['--versionNumber', str(version)] if version else [])
    out = run(cmd, cwd=dest, check=False)
    if 'invalid_grant' in out or 'invalid_rapt' in out:
        sys.exit('clasp is signed out. Run:  clasp login   then try again.')
    return dest


def code_files(d):
    return sorted(f for f in os.listdir(d) if f.endswith(CODE_EXT))


def norm_lines(path):
    """Code lines only: no blank lines, no comment-only lines, whitespace collapsed."""
    out = []
    with open(path, encoding='utf-8', errors='replace') as fh:
        in_block = False
        for raw in fh:
            s = re.sub(r'\s+', ' ', raw).strip()
            if in_block:
                if '*/' in s:
                    in_block = False
                continue
            if not s or s.startswith('//') or s.startswith('*'):
                continue
            if s.startswith('/*'):
                in_block = '*/' not in s
                continue
            if s.startswith('<!--') and s.endswith('-->'):
                continue
            out.append(s)
    return out


def functions(d):
    names = set()
    for f in code_files(d):
        with open(os.path.join(d, f), encoding='utf-8', errors='replace') as fh:
            for m in re.finditer(r'function\s+([A-Za-z0-9_$]+)', fh.read()):
                names.add(m.group(1).rstrip('_'))
    return names


def main():
    args = sys.argv[1:]
    ack = None
    if '--ack' in args:
        i = args.index('--ack'); ack = args[i + 1]; del args[i:i + 2]
    if len(args) < 3:
        sys.exit(__doc__)
    app, desc, deployments = args[0], args[1], args[2:]
    app_dir = app if os.path.isabs(app) else os.path.join(ROOT, app)
    if not os.path.isfile(os.path.join(app_dir, '.clasp.json')):
        sys.exit('No .clasp.json in ' + app_dir)

    scratch = tempfile.mkdtemp(prefix='safe_push_')
    head = pull(app_dir, os.path.join(scratch, 'head'))
    m = re.search(r'Found (\d+) versions', run(['clasp', 'versions'], cwd=app_dir))
    newest_no = int(m.group(1)) if m else None
    newest = pull(app_dir, os.path.join(scratch, 'v%s' % newest_no), newest_no) if newest_no else None
    print('Compared against: editor copy (HEAD)' + (' and newest version %d' % newest_no if newest else ''))

    problems = []
    lost_lines = []
    local_fns = functions(app_dir)
    for label, d in [('HEAD', head)] + ([('version %d' % newest_no, newest)] if newest else []):
        for f in code_files(d):
            if not os.path.exists(os.path.join(app_dir, f)):
                problems.append('%s has file %s, which is missing locally' % (label, f))
        gone = sorted(functions(d) - local_fns)
        if gone:
            problems.append('%s has functions missing locally: %s' % (label, ', '.join(gone)))
        for f in code_files(d):
            lp = os.path.join(app_dir, f)
            if not os.path.exists(lp):
                continue
            have = set(norm_lines(lp))
            for line in norm_lines(os.path.join(d, f)):
                if line not in have:
                    lost_lines.append((label, f, line))

    if problems:
        print('\nREFUSED - this push would lose work:')
        for p in problems:
            print('  - ' + p)
        sys.exit('\nMerge those into the local folder first (pulled copies are in %s).' % scratch)

    uniq = sorted(set((f, l) for _, f, l in lost_lines))
    code = hashlib.sha1(json.dumps(uniq).encode('utf-8')).hexdigest()[:8]
    if uniq and ack != code:
        print('\n%d line(s) of code exist live but would be GONE after this push:\n' % len(uniq))
        for f, l in uniq:
            print('  %-18s %s' % (f, l[:150]))
        print('\nRead every line above. If each one is meant to change, run again with:  --ack %s' % code)
        sys.exit(2)

    print('\nRunning all checks...')
    out = run(['node', os.path.join(ROOT, 'portal_connector', 'checks', 'all.js')], check=False)
    print(out.strip().splitlines()[-1] if out.strip() else '')
    if 'all checks passed' not in out:
        sys.exit('REFUSED - checks failed:\n' + out)

    print(run(['clasp', 'push', '-f'], cwd=app_dir).strip().splitlines()[-1])

    # A .claspignore allow-list once kept a new server file (hub Photos.js) out of the push
    # without a word, so the live hub lacked its functions. Every local .js/.gs must arrive.
    after = pull(app_dir, os.path.join(scratch, 'after'))
    pushed = set(code_files(after))
    skipped = [f for f in code_files(app_dir) if f not in pushed]
    for f in skipped:
        print('  note: %s was not pushed (excluded by .claspignore)' % f)
    lost_js = [f for f in skipped if f.endswith(('.js', '.gs'))]
    if lost_js:
        sys.exit('REFUSED - server file(s) %s did not reach Apps Script (check .claspignore). '
                 'Nothing was versioned or deployed.' % ', '.join(lost_js))

    vout = run(['clasp', 'version', desc], cwd=app_dir)
    v = re.search(r'Created version (\d+)', vout)
    if not v:
        sys.exit('Could not create the version:\n' + vout)
    v = v.group(1)
    for dep in deployments:
        print(run(['clasp', 'redeploy', dep, '-V', v, '-d', desc], cwd=app_dir).strip().splitlines()[-1])
    print('\nDeployed version %s as "%s".' % (v, desc))
    shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    main()
