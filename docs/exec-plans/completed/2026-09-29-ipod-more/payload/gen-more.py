# iPod skins batch 2 (v1.346.0): every remaining distinct nanochromatic.com card becomes a skin.
# Run ONCE from the repo root:  python3 docs/exec-plans/active/2026-09-29-ipod-more/payload/gen-more.py YYYY-MM-DD
# Reads site-cards.json + batch1-table.md (the 52 shipped skins), APPENDS to public/js/music-skins.js (registry),
# public/css/style.css (role blocks), docs/ui-exceptions.json and public/js/setup.js (blurbs). Refuses to run twice.
import colorsys, json, math, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
DATE = sys.argv[1] if len(sys.argv) == 2 and re.fullmatch(r'\d{4}-\d{2}-\d{2}', sys.argv[1]) else sys.exit('usage: gen-more.py YYYY-MM-DD')
rd = lambda p: open(p, encoding='utf8').read()
cards = json.load(open(os.path.join(HERE, 'site-cards.json')))
LINEKEY = {'iPod classic': 'classic', 'iPod mini': 'mini', 'iPod nano': 'nano', 'iPod shuffle': 'shuffle', 'iPod touch': 'touch'}
LINE = {'classic': 'Classic', 'mini': 'Mini', 'nano': 'Nano', 'shuffle': 'Shuffle', 'touch': 'Touch'}
# ---- what already ships (batch 1): hexes per line+gen, ids, and (line,gen,color,year) labels
have_hex, have_ids, have_lab = {}, set(), set()
for l in open(os.path.join(HERE, 'batch1-table.md'), encoding='utf8'):
    r = l.split('|')
    if l.startswith('| ') and l[2].isdigit():
        have_hex.setdefault((r[4].strip(), r[5].strip()), set()).add(r[8].strip('` ').lower()); have_ids.add(r[2].strip('` '))
        have_lab.add((r[4].strip(), r[5].strip(), r[7].strip(), re.search(r'\((\d{4})\)', r[3]).group(1)))
have_ids |= {'apple', 'spotify', 'ipod-original'}
# ---- decisions (Architect, 2026-09-29; Dean: "all of the colorways from all of the generations")
NAME = {'PRODUCT(RED)': 'Red', '(PRODUCT)RED': 'Red', 'PRODUCT(RED) (yes, it looks kinda pink)': 'Red',
        'Blue (yes, it looks teal)': 'Teal', 'Special Edition (Stainless Steel)': 'Stainless Steel'}
HEXNAME = {'#89bb93': 'Light Green'}  # Shuffle 2G Sept 2007: the same name AND year as Jan 2007's Green
SKIP_LINE = {'classic'}  # Classic cards are exact duplicates of shipped skins (photo / 1G-3G White = 4G White; 5G U2 = Encore, batch 1 D2)
GENNUM = lambda g: int(g[0])
year_of = lambda d: re.search(r'(20\d\d)', d).group(1)
new, seen = [], set()
for x in cards:
    ln = LINEKEY[x['line']]
    if ln in SKIP_LINE: continue
    g = GENNUM(x['gen']); hx = x['hex'].lower()
    if hx in have_hex.get((ln, str(g)), set()) or (ln, g, hx) in seen: continue
    seen.add((ln, g, hx))
    color = HEXNAME.get(hx) or NAME.get(x['color'], x['color'])
    new.append(dict(line=ln, gen=g, year=year_of(x['date']), color=color, hex=hx))
# ---- ids: ipod-<line><gen>-<slug>, plus -<year> when that id already exists or repeats
slug = lambda c: re.sub(r'[^a-z0-9]', '', c.lower())
used = set(have_ids)
for n in new:
    i = f"ipod-{n['line']}{n['gen']}-{slug(n['color'])}"
    if i in used: i += '-' + n['year']
    assert i not in used, i
    used.add(i); n['id'] = i
    assert (n['line'], str(n['gen']), n['color'], n['year']) not in have_lab, ('label collides with a shipped skin', n)
labs = {}
for n in new: labs.setdefault((n['line'], n['gen'], n['color'], n['year']), []).append(n['id'])
dups = {k: v for k, v in labs.items() if len(v) > 1}
assert not dups, dups
GEN_YEAR = {('nano', 1): '2005', ('nano', 2): '2006', ('shuffle', 1): '2005', ('shuffle', 2): '2006', ('shuffle', 3): '2009', ('shuffle', 4): '2010',
            ('touch', 1): '2007', ('touch', 4): '2010', ('touch', 5): '2012', ('touch', 6): '2015', ('mini', 2): '2005', ('nano', 3): '2007', ('nano', 4): '2008',
            ('nano', 5): '2009', ('nano', 6): '2010', ('nano', 7): '2012'}
GEN_SPAN = {('touch', 1): '1G-3G', ('touch', 6): '6G-7G'}
gname = lambda ln, g: GEN_SPAN.get((ln, g), f'{g}G')
label = lambda n: f"{LINE[n['line']]} {gname(n['line'], n['gen'])} {n['color']} ({n['year']})"
# ---- wheel styles
def rgb(h): return tuple(int(h[i:i+2],16)/255 for i in (1,3,5))
def hx(r,g,b): return '#%02x%02x%02x' % tuple(max(0,min(255,round(c*255))) for c in (r,g,b))
def shift(h, dl):
    hh,l,s = colorsys.rgb_to_hls(*rgb(h.lower())); return hx(*colorsys.hls_to_rgb(hh, max(0.0,min(1.0,l+dl)), s))
def trip(h): return ','.join(str(round(c*255)) for c in rgb(h))
def mix(h, w, t): a,b = rgb(h), rgb(w); return hx(*[a[i]+(b[i]-a[i])*t for i in range(3)])
lum = lambda h: 0.2126*rgb(h)[0] + 0.7152*rgb(h)[1] + 0.0722*rgb(h)[2]
def style(n):
    if n['line'] == 'shuffle': return 'tonal'
    if n['line'] == 'mini': return 'mini'
    if n['line'] == 'nano' and n['gen'] == 6: return 'dark'
    return 'dark' if lum(n['hex']) < 0.35 else 'white'
for n in new: n['style'] = style(n)
STYLE_NOTE = {'white': 'the white wheel, grey labels, the center the body color',
              'dark': 'a dark wheel, light labels, the center the body color',
              'tonal': 'a tonal wheel a shade lighter than the body, pale labels, a darker center',
              'mini': "the Mini 1G wheel exactly as Click (Sky)'s (grey wheel, grey labels, grey center)"}
def block(n):
    i, base, st = n['id'], n['hex'], n['style']
    stops = [shift(base,.05), base, shift(base,-.05), shift(base,-.11), shift(base,-.17)]
    glow = shift(base,.12); core = mix(glow,'#ffffff',.6)
    P = {'--pk-c-body': 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%),\n      linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%),\n      linear-gradient(180deg, ' + ', '.join(f'{c} {p}%' for c,p in zip(stops,(0,30,60,85,100))) + ')',
         '--pk-c-body-edge': shift(base,-.34)}
    if st == 'white': P.update({'--pk-c-wheel-1':'#f3f4f3','--pk-c-wheel-2':'#e3e5e4','--pk-c-wheel-sheen':'var(--mms-ipod-sheen-d)','--pk-c-wheel-oy':'40%','--pk-c-wheel-label':'#b0b3b8','--pk-c-center-1':shift(base,-.02),'--pk-c-center-2':shift(base,-.12)})
    elif st == 'dark': P.update({'--pk-c-wheel-1':'#343434','--pk-c-wheel-2':'#262626','--pk-c-wheel-sheen':'rgba(255,255,255,.3)','--pk-c-wheel-oy':'40%','--pk-c-wheel-label':'#e4e4e6','--pk-c-center-1':base,'--pk-c-center-2':shift(base,-.1)})
    elif st == 'mini': P.update({'--pk-c-wheel-1':'#d3d3d2','--pk-c-wheel-2':'#c4c4c2','--pk-c-wheel-sheen':'var(--mms-ipod-sheen-d)','--pk-c-wheel-oy':'40%','--pk-c-wheel-label':'#86898c','--pk-c-center-1':'#d3d3d2','--pk-c-center-2':'#c4c4c2'})
    else: P.update({'--pk-c-wheel-1':shift(base,.1),'--pk-c-wheel-2':shift(base,.04),'--pk-c-wheel-sheen':'var(--mms-ipod-sheen-d)','--pk-c-wheel-oy':'40%','--pk-c-wheel-label':mix(base,'#ffffff',.72),'--pk-c-center-1':shift(base,-.06),'--pk-c-center-2':shift(base,-.14)})
    P.update({'--pk-c-center-oy':'38%','--pk-c-lit-band':'rgba(255,255,255,.16)','--pk-c-lit-band2':'rgba(255,255,255,.09)','--pk-c-lits-band':'rgba(255,255,255,.24)','--pk-c-lits-band2':'rgba(255,255,255,.13)','--pk-c-lits-core':'rgba(255,255,255,.36)','--pk-c-lita-glow':trip(glow),'--pk-c-lita-core':trip(core)})
    g = lambda *ks: ' '.join(f'{k}:{P[k]};' for k in ks)
    body = '\n'.join([f"    --pk-c-body:{P['--pk-c-body']};", f"    --pk-c-body-edge:{P['--pk-c-body-edge']};",
      '    ' + g('--pk-c-wheel-1','--pk-c-wheel-2','--pk-c-wheel-sheen','--pk-c-wheel-oy'), '    ' + g('--pk-c-wheel-label'),
      '    ' + g('--pk-c-center-1','--pk-c-center-2','--pk-c-center-oy'), '    ' + g('--pk-c-lit-band','--pk-c-lit-band2'),
      '    ' + g('--pk-c-lits-band','--pk-c-lits-band2','--pk-c-lits-core'), '    ' + g('--pk-c-lita-glow','--pk-c-lita-core') + ' }'])
    exc = [{"key": f"public/css/style.css|.mms-{i}|{k}", "count": 1, "reason": "Pocket/whcal skin art (D10.4 carve-out): the device palette and the controls painted as part of it", "added": DATE}
           for k, v in P.items() if '#' in v or 'rgba(' in v]
    return (f"  /* {label(n)} (iPod colors batch 2, {DATE}): nanochromatic.com reference {base}; {STYLE_NOTE[st]}.\n     Generated by the plan's formula, not photo-sampled. */\n  :where(html.is-phone, html.mms-popout, .skin-grid) .mms-{i}{{\n{body}", exc)
art = lambda w: 'an' if w[0] in 'aeiou' else 'a'
def blurb(n):
    c = n['color'].lower()
    return {'white': f"Anodized {c}, a white wheel and {art(c)} {c} center.", 'dark': f"Anodized {c}, a dark wheel and {art(c)} {c} center.",
            'tonal': f"Anodized {c}, a tonal {c} wheel with pale lettering.", 'mini': f"Anodized {c}, a grey wheel with grey lettering and center."}[n['style']]
# ---- apply (every anchor exactly once; nothing written unless all match)
out = {}
p = 'public/js/music-skins.js'; s = rd(p)
if new[0]['id'] in s: sys.exit('STOP: batch 2 is already applied')
lines = s.split('\n'); a = next(k for k, l in enumerate(lines) if l.startswith('  var SKINS = ['))
b = next(k for k in range(a, len(lines)) if lines[k] == '  ];')
reg = lines[a:b]
def entry(n): return "    { id: '%s', label: '%s', line: '%s', gen: %d, year: '%s', color: '%s', base: 'ipod', menus: 'click', renderFull: renderIpod }," % (n['id'], label(n), n['line'], n['gen'], n['year'], n['color'])
for n in new:
    grp = [k for k, l in enumerate(reg) if ("line: '%s', gen: %d," % (n['line'], n['gen'])) in l]
    at = (grp[-1] + 1) if grp else next(k for k, l in enumerate(reg) if "id: 'ipod-original'" in l)
    reg.insert(at, entry(n))
out[p] = '\n'.join(lines[:a] + reg + lines[b:])
p = 'public/css/style.css'; s = rd(p); anchor = '  /* Click (Original) (v1.335'
assert s.count(anchor) == 1, 'the Click (Original) comment'
blocks, exc = zip(*[block(n) for n in new])
out[p] = s.replace(anchor, '\n'.join(blocks) + '\n' + anchor)
p = 'docs/ui-exceptions.json'; d = json.loads(rd(p)); have = {e['key'] for e in d['rules']['no-raw-values']}
add = [e for es in exc for e in es]; assert not [e for e in add if e['key'] in have]
d['rules']['no-raw-values'].extend(add); d['rules']['no-raw-values'].sort(key=lambda e: e['key'])
out[p] = json.dumps(d, indent=2, ensure_ascii=False) + '\n'
p = 'public/js/setup.js'; s = rd(p); anchor = "  'ipod-original': 'The first one"; assert s.count(anchor) == 1, 'the ipod-original blurb'
out[p] = s.replace(anchor, ''.join("  '%s': '%s',\n" % (n['id'], blurb(n)) for n in new) + anchor)
for p, t in out.items(): open(p, 'w', encoding='utf8').write(t)
json.dump(new, open(os.path.join(HERE, 'batch2-skins.json'), 'w'), indent=1)
open(os.path.join(HERE, 'batch2-table.md'), 'w').write('| id | label | line | gen | year | color | hex | wheel |\n|---|---|---|---|---|---|---|---|\n' + ''.join(f"| `{n['id']}` | {label(n)} | {n['line']} | {n['gen']} | {n['year']} | {n['color']} | `{n['hex']}` | {n['style']} |\n" for n in new))
print('applied', len(new), 'skins;', len(add), 'exception entries; per line:', {k: sum(1 for n in new if n['line'] == k) for k in LINE if k != 'classic'})
