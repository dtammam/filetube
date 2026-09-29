# Generates the iPod true-up payload: 27 new CSS role blocks, their ui-exceptions entries, the registry block,
# the blurbs, and the colorways table. Inputs: the nanochromatic.com reference hexes (below, verbatim).
import colorsys, json, math
NEW = [ # id, line, gen, year, color, site hex, wheel style
 ('ipod-nano3-silver','nano',3,'2007','Silver','#B6BABD','white'),
 ('ipod-nano3-blue','nano',3,'2007','Blue','#78B0B4','white'),
 ('ipod-nano3-green','nano',3,'2007','Green','#80B28A','white'),
 ('ipod-nano3-red','nano',3,'2007','Red','#86273C','white'),
 ('ipod-nano4-blue','nano',4,'2008','Blue','#3A83B8','white'),
 ('ipod-nano4-orange','nano',4,'2008','Orange','#E7A452','white'),
 ('ipod-nano5-green','nano',5,'2009','Green','#408E52','white'),
 ('ipod-nano5-orange','nano',5,'2009','Orange','#E58D3E','white'),
 ('ipod-nano5-pink','nano',5,'2009','Pink','#D54487','white'),
 ('ipod-nano6-green','nano',6,'2010','Green','#C7DB6D','dark'),
 ('ipod-nano6-orange','nano',6,'2010','Orange','#E3B44E','dark'),
 ('ipod-nano6-pink','nano',6,'2010','Pink','#E581C3','dark'),
 ('ipod-nano7-pink','nano',7,'2012','Pink','#E9807F','white'),
 ('ipod-nano7-yellow','nano',7,'2012','Yellow','#E3E064','white'),
 ('ipod-nano7-green','nano',7,'2012','Green','#88CDA1','white'),
 ('ipod-nano7-purple','nano',7,'2012','Purple','#D196CA','white'),
 ('ipod-nano7-slate','nano',7,'2012','Slate','#4E535D','dark'),
 ('ipod-nano7-red','nano',7,'2012','Red','#E95555','white'),
 ('ipod-nano7-spacegray','nano',7,'2013','Space Gray','#9A999C','dark'),
 ('ipod-nano7-blue','nano',7,'2015','Blue','#3C67AA','white'),
 ('ipod-nano7-gold','nano',7,'2015','Gold','#EEE2CB','white'),
 ('ipod-shuffle2-purple','shuffle',2,'2007','Purple','#7978A8','tonal'),
 ('ipod-shuffle2-green','shuffle',2,'2008','Green','#7DB048','tonal'),
 ('ipod-shuffle2-gold','shuffle',2,'2009','Gold','#E1C581','tonal'),
 ('ipod-shuffle3-pink','shuffle',3,'2009','Pink','#D25B86','tonal'),
 ('ipod-shuffle3-blue','shuffle',3,'2009','Blue','#48A0B7','tonal'),
 ('ipod-shuffle4-blue','shuffle',4,'2010','Blue','#8FB4DC','tonal'),
]
def rgb(h): return tuple(int(h[i:i+2],16)/255 for i in (1,3,5))
def hx(r,g,b): return '#%02x%02x%02x' % tuple(max(0,min(255,round(c*255))) for c in (r,g,b))
def shift(h, dl):
    h = h.lower()  # move HLS lightness by dl (absolute, 0..1)
    hh,l,s = colorsys.rgb_to_hls(*rgb(h)); return hx(*colorsys.hls_to_rgb(hh, max(0.0,min(1.0,l+dl)), s))
def trip(h): return ','.join(str(round(c*255)) for c in rgb(h))
def mix(h, w, t): a,b = rgb(h), rgb(w); return hx(*[a[i]+(b[i]-a[i])*t for i in range(3)])
LINE = {'classic':'Classic','mini':'Mini','nano':'Nano','shuffle':'Shuffle'}
def label(n): return f"{LINE[n[1]]} {n[2]}G {n[4]} ({n[3]})"
blocks=[]; exc=[]
STYLE_NOTE = {'white':'the white wheel, grey labels, the center the body color (the nano face)',
              'dark':'a dark wheel, light labels, the center the body color (a black front)',
              'tonal':'a tonal wheel a shade lighter than the body, pale labels, a darker center (the shuffle control ring)'}
for n in NEW:
    i,line,gen,year,color,base,style = n
    base = base.lower()
    stops = [shift(base,.05), base, shift(base,-.05), shift(base,-.11), shift(base,-.17)]
    edge = shift(base,-.34)
    glow = shift(base,.12); core = mix(glow,'#ffffff',.6)
    props = [
      ('--pk-c-body', 'linear-gradient(180deg, rgba(255,255,255,.3) 0, var(--mms-ipod-sheen-0) 1.6%),\n      linear-gradient(90deg, rgba(0,0,0,.24) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.24) 100%),\n      linear-gradient(180deg, ' + ', '.join(f'{c} {p}%' for c,p in zip(stops,(0,30,60,85,100))) + ')'),
      ('--pk-c-body-edge', edge)]
    if style=='white':
        props += [('--pk-c-wheel-1','#f3f4f3'),('--pk-c-wheel-2','#e3e5e4'),('--pk-c-wheel-sheen','var(--mms-ipod-sheen-d)'),('--pk-c-wheel-oy','40%'),
                  ('--pk-c-wheel-label','#b0b3b8'),('--pk-c-center-1',shift(base,-.02)),('--pk-c-center-2',shift(base,-.12))]
    elif style=='dark':
        props += [('--pk-c-wheel-1','#343434'),('--pk-c-wheel-2','#262626'),('--pk-c-wheel-sheen','rgba(255,255,255,.3)'),('--pk-c-wheel-oy','40%'),
                  ('--pk-c-wheel-label','#e4e4e6'),('--pk-c-center-1',base),('--pk-c-center-2',shift(base,-.1))]
    else:
        props += [('--pk-c-wheel-1',shift(base,.1)),('--pk-c-wheel-2',shift(base,.04)),('--pk-c-wheel-sheen','var(--mms-ipod-sheen-d)'),('--pk-c-wheel-oy','40%'),
                  ('--pk-c-wheel-label',mix(base,'#ffffff',.72)),('--pk-c-center-1',shift(base,-.06)),('--pk-c-center-2',shift(base,-.14))]
    props += [('--pk-c-center-oy','38%'),
              ('--pk-c-lit-band','rgba(255,255,255,.16)'),('--pk-c-lit-band2','rgba(255,255,255,.09)'),
              ('--pk-c-lits-band','rgba(255,255,255,.24)'),('--pk-c-lits-band2','rgba(255,255,255,.13)'),('--pk-c-lits-core','rgba(255,255,255,.36)'),
              ('--pk-c-lita-glow',trip(glow)),('--pk-c-lita-core',trip(core))]
    P = dict(props)
    g = lambda *ks: ' '.join(f'{k}:{P[k]};' for k in ks)
    body = '\n'.join([
      f"    --pk-c-body:{P['--pk-c-body']};",
      f"    --pk-c-body-edge:{P['--pk-c-body-edge']};",
      '    ' + g('--pk-c-wheel-1','--pk-c-wheel-2','--pk-c-wheel-sheen','--pk-c-wheel-oy'),
      '    ' + g('--pk-c-wheel-label'),
      '    ' + g('--pk-c-center-1','--pk-c-center-2','--pk-c-center-oy'),
      '    ' + g('--pk-c-lit-band','--pk-c-lit-band2'),
      '    ' + g('--pk-c-lits-band','--pk-c-lits-band2','--pk-c-lits-core'),
      '    ' + g('--pk-c-lita-glow','--pk-c-lita-core') + ' }'])
    blocks.append(f"  /* {label(n)} (iPod true-up, 2026-09-29): nanochromatic.com reference {base}; {STYLE_NOTE[style]}.\n     Generated by the plan's formula, not photo-sampled. */\n  :where(html.is-phone, html.mms-popout, .skin-grid) .mms-{i}{{\n{body}")
    for k,v in props:
        if '#' in v or 'rgba(' in v:
            exc.append({"key":f"public/css/style.css|.mms-{i}|{k}","count":1,"reason":"Pocket/whcal skin art (D10.4 carve-out): the device palette and the controls painted as part of it","added":"<build date>"})
open('payload-roles.css','w').write('\n'.join(blocks)+'\n')
json.dump(exc,open('payload-ui-exceptions.json','w'),indent=2)
BLURB_STYLE={'white':'a white wheel and a {c} center','dark':'a dark wheel and a {c} center','tonal':'a tonal {c} wheel with pale lettering'}
blurbs={n[0]: f"Anodized {n[4].lower()}, " + BLURB_STYLE[n[6]].format(c=n[4].lower()) + '.' for n in NEW}
json.dump(blurbs,open('payload-blurbs.json','w'),indent=2)
print(len(blocks),'blocks',len(exc),'exception entries'); print(blocks[1]); print(blocks[21])

# ---- the Gold retune (Dean, 2026-09-29): ipod-gold becomes the real Mini 1G Gold (2004), champagne #e2d6a3,
# with the Mini 1G wheel exactly as its siblings (Click (Sky)'s tokens: grey wheel, grey labels, grey center).
def mini1_block(i, lbl, base):
    stops = [shift(base,.05), base, shift(base,-.05), shift(base,-.11), shift(base,-.17)]
    glow = shift(base,.08); core = mix(glow,'#ffffff',.6)
    return (f"  /* {lbl} (iPod true-up, 2026-09-29, Dean: retuned from the antique-gold photo to the real Mini 1G):\n"
      f"     nanochromatic.com reference {base}; the Mini 1G wheel exactly as Click (Sky)'s (grey wheel, grey labels, grey center). */\n"
      f"  :where(html.is-phone, html.mms-popout, .skin-grid) .mms-{i}{{\n"
      "    --pk-c-body:linear-gradient(180deg, rgba(255,255,255,.28) 0, var(--mms-ipod-sheen-0) 1.6%),\n"
      "      linear-gradient(90deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.06) 12%, var(--mms-ipod-clear) 26%, var(--mms-ipod-clear) 74%, rgba(0,0,0,.06) 88%, rgba(0,0,0,.28) 100%),\n"
      "      linear-gradient(180deg, " + ', '.join(f'{c} {p}%' for c,p in zip(stops,(0,25,50,75,100))) + ");\n"
      f"    --pk-c-body-edge:{shift(base,-.34)};\n"
      "    --pk-c-wheel-1:#d3d3d2; --pk-c-wheel-2:#c4c4c2; --pk-c-wheel-sheen:var(--mms-ipod-sheen-d); --pk-c-wheel-oy:40%;\n"
      "    --pk-c-wheel-label:#86898c;\n"
      "    --pk-c-center-1:#d3d3d2; --pk-c-center-2:#c4c4c2; --pk-c-center-oy:38%;\n"
      "    --pk-c-lit-band:rgba(255,255,255,.16); --pk-c-lit-band2:rgba(255,255,255,.09);\n"
      "    --pk-c-lits-band:rgba(255,255,255,.24); --pk-c-lits-band2:rgba(255,255,255,.13); --pk-c-lits-core:rgba(255,255,255,.36);\n"
      f"    --pk-c-lita-glow:{trip(glow)}; --pk-c-lita-core:{trip(core)}; }}")
open('payload-role-gold.css','w').write(mini1_block('ipod-gold','Mini 1G Gold (2004)','#e2d6a3')+'\n')

# ---- the master table: every iPod colorway in display order (line, gen, then the site's order in that gen)
EXIST = [ # id, line, gen, year, color, site hex, wheel style (existing: kept as-is; gold retuned)
 ('ipod-2004','classic',4,'2004','White','#eff2f1','keep'),('ipod-encore','classic',4,'2004','Special Edition','#c92e2c','keep'),
 ('ipod','classic',5,'2005','White','#fdfdfd','keep'),('ipod-black','classic',5,'2005','Black','#000201','keep'),
 ('ipod-silver','classic',6,'2007','Silver','#e4e4e4','keep'),('ipod-charcoal','classic',6,'2007','Black','#33343a','keep'),('ipod-matte','classic',6,'2008','Black','#7a777a','keep'),
 ('ipod-frost','mini',1,'2004','Silver','#d6d6d6','keep'),('ipod-gold','mini',1,'2004','Gold','#e2d6a3','retune'),('ipod-sky','mini',1,'2004','Blue','#c1dee6','keep'),('ipod-blush','mini',1,'2004','Pink','#e8c7d9','keep'),('ipod-olive','mini',1,'2004','Green','#dfe4ac','keep'),
 ('ipod-blue','mini',2,'2005','Blue','#6ac2e2','keep'),('ipod-green','mini',2,'2005','Green','#b0c36b','keep'),('ipod-pink','mini',2,'2005','Pink','#dca6c1','keep'),
 ('ipod-lime','nano',2,'2006','Green','#a0c15a','keep'),('ipod-cobalt','nano',2,'2006','Blue','#4193bb','keep'),('ipod-magenta','nano',2,'2006','Pink','#c1518b','keep'),('ipod-red','nano',2,'2006','Red','#c83a43','keep'),
 ('ipod-raspberry','nano',3,'2008','Pink','#bf5e91','keep'),('ipod-violet','nano',4,'2008','Purple','#6858a0','keep'),('ipod-yellow','nano',4,'2008','Yellow','#e2cc47','keep'),
]
SITE_ORDER = {('nano',2):['Silver','Green','Blue','Pink','Black','Red'],('nano',3):['Silver','Black','Blue','Green','Red','Pink'],
 ('nano',4):['Silver','Blue','Purple','Green','Orange','Yellow','Pink','Black','Red'],('nano',5):['Silver','Blue','Purple','Green','Orange','Yellow','Pink','Black','Red'],
 ('nano',6):['Silver','Graphite','Blue','Green','Orange','Pink','Red'],('nano',7):['Pink','Yellow','Blue','Green','Purple','Silver','Slate','Red','Space Gray','Gold'],
 ('shuffle',2):['Purple','Green','Gold'],('shuffle',3):['Pink','Blue'],('shuffle',4):['Blue']}
LINES = ['classic','mini','nano','shuffle']
ALL = [e for e in EXIST] + [n for n in NEW]
def key(r):
    o = SITE_ORDER.get((r[1],r[2]))
    pos = o.index(r[4]) if o and r[4] in o else ORIG.index(r)
    return (LINES.index(r[1]), r[2], pos, r[3])
ORIG = list(ALL)
ALL.sort(key=key)
GENYEAR = {('classic',4):'2004',('classic',5):'2005',('classic',6):'2007',('mini',1):'2004',('mini',2):'2005',('nano',2):'2006',('nano',3):'2007',('nano',4):'2008',('nano',5):'2009',('nano',6):'2010',('nano',7):'2012',('shuffle',2):'2006',('shuffle',3):'2009',('shuffle',4):'2010'}
reg = ["  var SKINS = [",
 "    { id: 'apple', label: 'Cider', renderFull: renderApple },",
 "    { id: 'spotify', label: 'Nordic', renderFull: renderSpotify },"]
for r in ALL:
    i,l,g_,y,c = r[:5]
    base = '' if i=='ipod' else " base: 'ipod',"
    render = "{ id: '%s', label: '%s', line: '%s', gen: %d, year: '%s', color: '%s',%s menus: 'click', renderFull: renderIpod }," % (i, label(r), l, g_, y, c, base)
    reg.append('    ' + render)
reg.append("    { id: 'ipod-original', label: 'Click (Original)', base: 'ipod', look: 'original', menus: 'click', renderFull: renderIpod },")
reg.append("  ];")
open('payload-registry.js','w').write('\n'.join(reg)+'\n')
# the table for the plan
rows = ['| # | id | label (full name) | line | gen | gen year | color | site hex | status | wheel style |','|---|---|---|---|---|---|---|---|---|---|']
for k,r in enumerate(ALL,1):
    st = {'keep':'KEEP (label + fields only)','retune':'RETUNE (label, fields, CSS block)'}.get(r[6],'NEW')
    ws = {'keep':'existing','retune':'Mini 1G (Sky tokens)','white':'nano-white','dark':'dark','tonal':'tonal'}[r[6]]
    rows.append(f"| {k} | `{r[0]}` | {label(r)} | {r[1]} | {r[2]} | {GENYEAR[(r[1],r[2])]} | {r[4]} | `{r[5].lower()}` | {st} | {ws} |")
open('payload-table.md','w').write('\n'.join(rows)+'\n')
EXIST_BLURB_GOLD = 'Pale anodized champagne gold with grey lettering on the wheel.'
json.dump({**blurbs, 'ipod-gold': EXIST_BLURB_GOLD}, open('payload-blurbs.json','w'), indent=2)
print('registry entries', len(reg)-2, 'table rows', len(rows)-2)
