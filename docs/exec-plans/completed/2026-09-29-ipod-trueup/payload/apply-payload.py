#!/usr/bin/env python3
"""iPod true-up, plan Step 2: apply the payload to the repo ONCE, deterministically.

Run from the repo root:  python3 docs/exec-plans/active/2026-09-29-ipod-trueup/payload/apply-payload.py YYYY-MM-DD
(the date is today's, stamped on the new ui-exceptions entries). It edits exactly four files:
  public/js/music-skins.js    the SKINS array is replaced by registry.js
  public/css/style.css        the Click (Gold) comment+rule is replaced by role-gold.css; roles-new.css is
                              inserted immediately before the "/* Click (Original) (v1.335" comment
  docs/ui-exceptions.json     ui-exceptions-add.json appended to rules.no-raw-values (sorted by key)
  public/js/setup.js          MUSIC_SKIN_BLURB: ipod-gold replaced, the 27 new ids inserted before ipod-original
Every anchor must match EXACTLY once or it stops without writing anything. It refuses to run twice.
Proven on a clean archive of d1b9ca0d on 2026-09-29: ui-lint OK (the live debt equals the file, TOTAL 2260).
"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
if len(sys.argv) != 2 or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', sys.argv[1]):
    sys.exit('usage: apply-payload.py YYYY-MM-DD')
DATE = sys.argv[1]
rd = lambda p: open(p, encoding='utf8').read()
pay = lambda n: rd(os.path.join(HERE, n))
def once(s, needle, what):
    n = s.count(needle)
    if n != 1: sys.exit(f'STOP: anchor for {what} matched {n} times (expected 1): {needle[:60]!r}')
    return s.index(needle)
out = {}
# 1. registry
p = 'public/js/music-skins.js'; s = rd(p)
if 'ipod-nano3-blue' in s: sys.exit('STOP: the payload is already applied (ipod-nano3-blue is in the registry)')
a = once(s, '  var SKINS = [', 'the SKINS array start'); b = s.index('  ];\n', a) + len('  ];\n')
out[p] = s[:a] + pay('registry.js') + s[b:]
# 2. css
p = 'public/css/style.css'; s = rd(p)
ga = once(s, '  /* Click (Gold) (D8)', 'the Click (Gold) comment'); gr = once(s, '.mms-ipod-gold{', 'the Click (Gold) rule')
gb = s.index('}', gr) + 1
s = s[:ga] + pay('role-gold.css').rstrip('\n') + s[gb:]
oa = once(s, '  /* Click (Original) (v1.335', 'the Click (Original) comment')
out[p] = s[:oa] + pay('roles-new.css') + s[oa:]
# 3. ui-exceptions
p = 'docs/ui-exceptions.json'; d = json.loads(rd(p)); add = json.loads(pay('ui-exceptions-add.json'))
have = {e['key'] for e in d['rules']['no-raw-values']}
dup = [e['key'] for e in add if e['key'] in have]
if dup: sys.exit(f'STOP: {len(dup)} exception keys already exist, e.g. {dup[0]}')
for e in add: e['added'] = DATE
d['rules']['no-raw-values'].extend(add); d['rules']['no-raw-values'].sort(key=lambda e: e['key'])
out[p] = json.dumps(d, indent=2, ensure_ascii=False) + '\n'
# 4. blurbs
p = 'public/js/setup.js'; s = rd(p); bl = json.loads(pay('blurbs.json'))
g = re.findall(r"  'ipod-gold': '[^']*',\n", s)
if len(g) != 1: sys.exit(f'STOP: the ipod-gold blurb matched {len(g)} times')
s = s.replace(g[0], "  'ipod-gold': '%s',\n" % bl['ipod-gold'])
o = once(s, "  'ipod-original': 'The first one", 'the ipod-original blurb')
s = s[:o] + ''.join("  '%s': '%s',\n" % (k, v) for k, v in bl.items() if k != 'ipod-gold') + s[o:]
out[p] = s
for p, t in out.items(): open(p, 'w', encoding='utf8').write(t)
print('applied: ' + ', '.join(out))
print('next: node -e "const s=require(\'./public/js/music-skins.js\'); console.log(s.IDS.length, s.clickColorways().length)"   -> 52 50')
print('      npm run lint:ui   -> ui-lint: OK - the live debt equals docs/ui-exceptions.json')
